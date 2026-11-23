"""Bounded integration checks against real Alloy; no native/model calls or dependencies."""
import copy
import http.server
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import urllib.parse

HERE = Path(__file__).resolve().parent
ALLOY = os.environ['ALLOY_BIN']
CANARY = 'private-canary@example.invalid'


def post(data, path='/v1/metrics'):
    request = urllib.request.Request('http://127.0.0.1:14318' + path,
                                    json.dumps(data).encode(),
                                    {'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            return response.status
    except urllib.error.HTTPError as error:
        code = error.code
        error.close()
        return code


def fixture(runtime):
    data = json.loads((HERE / 'fixtures' / (runtime + '.json')).read_text())
    for resource in data['resourceMetrics']:
        for scope in resource['scopeMetrics']:
            for metric in scope['metrics']:
                for point in metric.get('sum', metric.get('histogram', {}))['dataPoints']:
                    point['startTimeUnixNano'] = str(time.time_ns() - 1_000_000_000)
                    point['timeUnixNano'] = str(time.time_ns())
    return data


def metrics(data):
    return [m for r in data.get('resourceMetrics', [])
            for s in r.get('scopeMetrics', []) for m in s.get('metrics', [])]


class Sink(http.server.BaseHTTPRequestHandler):
    payloads = []
    mode = 'ok'

    def log_message(self, *_args):
        pass

    def do_POST(self):
        data = self.rfile.read(int(self.headers['Content-Length']))
        if self.mode == 'timeout':
            time.sleep(2)
        elif self.mode == 'ok':
            self.payloads.append(json.loads(data))
        self.send_response(503 if self.mode == 'error' else 200)
        self.end_headers()
        try:
            self.wfile.write(b'{}')
        except (BrokenPipeError, ConnectionResetError):
            pass  # Expected when exercising the exporter's shorter timeout.


class Pipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='observability-test-')
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 14319), Sink)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.log = open(Path(cls.temp.name) / 'alloy.log', 'w+')
        cls.process = subprocess.Popen([
            ALLOY, 'run', str(HERE / 'config.alloy'), '--disable-reporting',
            '--server.http.listen-addr=127.0.0.1:14320',
            '--feature.component-shutdown-deadline=5s',
            '--storage.path=' + cls.temp.name,
        ], stdout=cls.log, stderr=cls.log)
        for _ in range(50):
            if cls.process.poll() is not None:
                cls.log.seek(0)
                raise AssertionError(cls.log.read())
            try:
                urllib.request.urlopen('http://127.0.0.1:14320/-/ready', timeout=.2).close()
                return
            except urllib.error.URLError:
                time.sleep(.1)
        raise AssertionError('Alloy not ready within 5 seconds')

    @classmethod
    def tearDownClass(cls):
        start = time.monotonic()
        cls.process.terminate()
        cls.process.wait(timeout=8)
        print('Alloy shutdown seconds:', round(time.monotonic() - start, 3))
        cls.server.shutdown()
        cls.server.server_close()
        cls.log.seek(0)
        errors = cls.log.read()
        if errors:
            print('Expected failure log lines:', len(errors.splitlines()))
        cls.log.close()
        cls.temp.cleanup()

    def setUp(self):
        Sink.mode = 'ok'
        Sink.payloads.clear()

    def receive(self):
        for _ in range(30):
            if Sink.payloads:
                return [m for data in Sink.payloads for m in metrics(data)]
            time.sleep(.05)
        self.fail('No mapped metrics exported within 1.5 seconds')

    def test_native_shapes_units_and_values(self):
        self.assertEqual(post(fixture('claude')), 200)
        self.assertEqual(post(fixture('codex')), 200)
        time.sleep(.3)
        result = {m['name']: m for m in self.receive()}
        self.assertEqual(set(result), {
            'claude_code.token.usage.delta', 'claude_code.cost.usage.delta',
            'claude_code.active_time.total.delta', 'claude_code.session.count.delta',
            'codex.turn.token_usage.delta', 'codex.turn.e2e_duration_ms.delta_sum',
            'codex.turn.e2e_duration_ms.delta_count'})
        self.assertEqual(result['claude_code.token.usage.delta']['unit'], 'tokens')
        self.assertEqual(result['codex.turn.token_usage.delta'].get('unit', ''), '')
        self.assertEqual(result['codex.turn.e2e_duration_ms.delta_sum']['unit'], 'ms')
        self.assertEqual(result['codex.turn.e2e_duration_ms.delta_count'].get('unit', ''), '')
        points = result['codex.turn.token_usage.delta']['gauge']['dataPoints']
        self.assertEqual(sorted(float(p.get('asDouble', p.get('asInt'))) for p in points),
                         [0, 5, 13440, 26340, 26345])

    def test_content_identity_and_colliding_dimensions(self):
        data = fixture('claude')
        data['resourceMetrics'] = [data['resourceMetrics'][2]]
        resource = data['resourceMetrics'][0]
        resource['schemaUrl'] = CANARY
        resource['resource']['attributes'].append({'key':'user.email','value':{'stringValue':CANARY}})
        scope = resource['scopeMetrics'][0]
        scope['schemaUrl'] = CANARY
        scope['scope'] = {'name':CANARY,'version':CANARY,'attributes':[{'key':'prompt','value':{'stringValue':CANARY}}]}
        metric = scope['metrics'][0]
        metric['description'] = CANARY
        metric['metadata'] = [{'key':'private','value':{'stringValue':CANARY}}]
        points = metric['sum']['dataPoints']
        for point in points:
            point['attributes'].append({'key':'session.id','value':{'stringValue':CANARY}})
        with_exemplar = copy.deepcopy(points[0])
        with_exemplar['exemplars'] = [{'filteredAttributes':[{'key':'response','value':{'stringValue':CANARY}}], 'asDouble':1}]
        points.append(with_exemplar)
        duplicate = copy.deepcopy(points[0])
        duplicate['attributes'][-1]['value']['stringValue'] = 'another-private-session'
        points.append(duplicate)
        self.assertEqual(post(data), 200)
        mapped = self.receive()
        self.assertNotIn(CANARY, json.dumps(Sink.payloads))
        self.assertNotIn('another-private-session', json.dumps(Sink.payloads))
        output = mapped[0]['gauge']['dataPoints']
        inputs = [p for p in output if any(a['key']=='type' and a['value'].get('stringValue')=='input' for a in p['attributes'])]
        self.assertEqual(len(inputs), 1)
        self.assertEqual(float(inputs[0].get('asDouble', inputs[0].get('asInt'))), 4)
        for p in output:
            self.assertLessEqual({a['key'] for a in p['attributes']}, {'runtime','runtime_version','source','type'})

    def test_unbounded_category_on_noncategory_metrics_is_removed(self):
        data = fixture('claude')
        data['resourceMetrics'] = [data['resourceMetrics'][0], data['resourceMetrics'][1]]
        for r in data['resourceMetrics']:
            for m in metrics({'resourceMetrics':[r]}):
                m['sum']['dataPoints'][0]['attributes'].append({'key':'type','value':{'stringValue':CANARY}})
        self.assertEqual(post(data), 200)
        self.receive()
        self.assertNotIn(CANARY, json.dumps(Sink.payloads))

    def test_unexpected_and_missing_are_not_zero(self):
        cases = []
        data = fixture('claude'); data['resourceMetrics'][0]['resource']['attributes'][1]['value']['stringValue']=CANARY; cases.append(data['resourceMetrics'][0])
        data = fixture('claude'); data['resourceMetrics'][0]['scopeMetrics'][0]['metrics'][0]['sum']['aggregationTemporality']=2; cases.append(data['resourceMetrics'][0])
        data = fixture('claude'); data['resourceMetrics'][0]['scopeMetrics'][0]['metrics'][0]['name']=CANARY; cases.append(data['resourceMetrics'][0])
        data = fixture('codex'); r=data['resourceMetrics'][1]
        for p in r['scopeMetrics'][0]['metrics'][0]['histogram']['dataPoints']: p.pop('sum')
        cases.append(r)
        self.assertEqual(post({'resourceMetrics': cases}), 200)
        time.sleep(.3)
        self.assertEqual(Sink.payloads, [])
        self.assertEqual(post({'resourceMetrics': 'invalid'}), 400)
        self.assertEqual(Sink.payloads, [])
        self.assertNotEqual(post({'resourceLogs':[]}, '/v1/logs'), 200)
        self.assertNotEqual(post({'resourceSpans':[]}, '/v1/traces'), 200)

    @unittest.skipUnless(os.environ.get('PROMETHEUS_BIN'), 'Set PROMETHEUS_BIN for query proof')
    def test_queries_use_actual_converted_names(self):
        self.assertEqual(post(fixture('claude')), 200)
        self.assertEqual(post(fixture('codex')), 200)
        time.sleep(.3)
        self.receive()
        payloads = list(Sink.payloads)
        evaluation_seconds = int(time.time())
        source_seconds = evaluation_seconds - 120
        for data in payloads:
            for metric in metrics(data):
                for point in metric['gauge']['dataPoints']:
                    point['startTimeUnixNano'] = str((source_seconds - 1) * 1_000_000_000)
                    point['timeUnixNano'] = str(source_seconds * 1_000_000_000)
        with tempfile.TemporaryDirectory(prefix='observability-prometheus-') as directory:
            temp = Path(directory)
            config = temp / 'prometheus.yml'
            config.write_text('global:\n  scrape_interval: 60s\notlp:\n'
                              '  translation_strategy: UnderscoreEscapingWithSuffixes\n')
            with open(temp / 'prometheus.log', 'w+') as logfile:
                process = subprocess.Popen([
                    os.environ['PROMETHEUS_BIN'], '--config.file=' + str(config),
                    '--storage.tsdb.path=' + str(temp / 'data'),
                    '--storage.tsdb.retention.time=1h', '--storage.tsdb.retention.size=32MB',
                    '--web.listen-address=127.0.0.1:14321', '--web.enable-otlp-receiver',
                ], stdout=logfile, stderr=logfile)
                try:
                    for _ in range(50):
                        if process.poll() is not None:
                            logfile.seek(0)
                            self.fail(logfile.read())
                        try:
                            urllib.request.urlopen('http://127.0.0.1:14321/-/ready', timeout=.2).close()
                            break
                        except urllib.error.URLError:
                            time.sleep(.1)
                    for data in payloads:
                        request = urllib.request.Request(
                            'http://127.0.0.1:14321/api/v1/otlp/v1/metrics',
                            json.dumps(data).encode(), {'Content-Type': 'application/json'})
                        with urllib.request.urlopen(request, timeout=2) as response:
                            self.assertEqual(response.status, 200)
                    queries = re.findall(r'```promql\n(.*?)\n```', (HERE / 'queries.md').read_text(), re.S)
                    self.assertEqual(len(queries), 7)
                    for index, query in enumerate(queries):
                        url = 'http://127.0.0.1:14321/api/v1/query?' + urllib.parse.urlencode({'query': query, 'time': evaluation_seconds})
                        try:
                            with urllib.request.urlopen(url, timeout=2) as response:
                                result = json.load(response)
                        except urllib.error.HTTPError as error:
                            with error:
                                self.fail('Query ' + str(index + 1) + ': ' + error.read().decode())
                        self.assertEqual(result['status'], 'success')
                        rows = result['data']['result']
                        self.assertEqual(len(rows), [4, 5, 1, 1, 1, 14, 14][index])
                        if index == 4:
                            self.assertEqual(float(rows[0]['value'][1]), 3513)
                        if index in (5, 6):
                            expected = source_seconds * 1000 if index == 5 else 120
                            with self.subTest(query=index + 1):
                                self.assertEqual([float(row['value'][1]) for row in rows],
                                                 [expected] * 14)
                                labels = {json.dumps(row['metric'], sort_keys=True) for row in rows}
                                self.assertEqual(len(labels), 14)
                    print('Queried 7 Grafana expressions; checked timestamps and age for all 14 series')
                finally:
                    process.terminate()
                    process.wait(timeout=5)

    def test_z_timeout_overflow_and_shutdown(self):
        Sink.mode = 'timeout'
        start = time.monotonic()
        codes = [post(fixture('claude')) for _ in range(30)]
        elapsed = time.monotonic() - start
        self.assertIn(503, codes)
        self.assertLess(elapsed, 5)
        print('Overflow refusals:', codes.count(503), 'submission seconds:', round(elapsed, 3))
        time.sleep(4)
        self.assertEqual(Sink.payloads, [])
        with urllib.request.urlopen('http://127.0.0.1:14320/metrics', timeout=1) as response:
            internal = response.read().decode()
        self.assertTrue('otelcol_exporter_send_failed_metric_points' in internal, 'Exporter failed-points counter missing')
        Sink.mode = 'error'
        self.assertEqual(post(fixture('claude')), 200)


if __name__ == '__main__':
    unittest.main(verbosity=2)
