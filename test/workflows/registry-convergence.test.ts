import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RELEASE = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
const INTEGRITY = `sha512-${Buffer.alloc(64, 7).toString('base64')}`;
const MATCHING = JSON.stringify({
  integrity: INTEGRITY,
  attestations: {
    url: 'https://registry.npmjs.org/-/npm/v1/attestations/voidmachine@4.0.0',
    provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
  },
});

function runRegistry(scenario: string, visibleAfter = 360) {
  const root = mkdtempSync(join(tmpdir(), 'void-registry-convergence-'));
  for (const name of ['elapsed', 'published', 'output']) writeFileSync(join(root, name), '');
  const step = RELEASE.split('        id: registry\n')[1]?.split('\n  # This job')[0];
  const source = step?.split('        run: |\n')[1];
  if (!source) throw new Error('Registry step is missing');
  const limits = Object.fromEntries(
    [...RELEASE.matchAll(/^      (MAX_\w+): (\d+)$/gm)].map((match) => [match[1], match[2]]),
  );
  const result = spawnSync('bash', ['-c', `
    sleep() { echo "$(( $(cat "$CASE_ROOT/elapsed") + $1 ))" > "$CASE_ROOT/elapsed"; }
    npm() {
      if [[ "$1" == publish ]]; then echo publish >> "$CASE_ROOT/published"; return; fi
      if [[ "$1" != view ]]; then return 90; fi
      elapsed=$(cat "$CASE_ROOT/elapsed")
      if [[ "$SCENARIO" == existing ]]; then echo "$MATCHING"; return; fi
      if [[ ! -s "$CASE_ROOT/published" ]]; then
        echo '{"error":{"code":"E404"}}'; return 1
      fi
      case "$SCENARIO" in
        conflict) echo '{"integrity":"sha512-other-bytes"}'; return ;;
        auth) echo '{"error":{"code":"E403"}}'; return 1 ;;
        malformed) echo 'not json'; return ;;
      esac
      if (( elapsed >= VISIBLE_AFTER )); then echo "$MATCHING"; return; fi
      if [[ "$SCENARIO" == provenance ]]; then
        echo "$DELAYED"
      else
        echo '{"error":{"code":"E404"}}'; return 1
      fi
    }
    ${source.split('\n').map((line) => line.slice(10)).join('\n')}
  `], {
    encoding: 'utf8',
    timeout: 8_000,
    env: {
      ...process.env, ...limits, CASE_ROOT: root, SCENARIO: scenario,
      VISIBLE_AFTER: String(visibleAfter), MATCHING, DELAYED: JSON.stringify({ integrity: INTEGRITY }),
      EXPECTED_INTEGRITY: INTEGRITY,
      EXPECTED_PACKAGE: 'voidmachine', RELEASE_VERSION: '4.0.0', TARBALL_PATH: 'fixture.tgz',
      REGISTRY_RESPONSE: join(root, 'response'), REGISTRY_ERROR: join(root, 'error'),
      GITHUB_OUTPUT: join(root, 'output'),
    },
  });
  return {
    ...result,
    elapsed: Number(readFileSync(join(root, 'elapsed'), 'utf8')),
    published: readFileSync(join(root, 'published'), 'utf8'),
    output: readFileSync(join(root, 'output'), 'utf8'),
  };
}

describe('registry convergence in the publishing workflow', () => {
  it.each(['absent', 'provenance'])('waits for six-minute %s propagation after one publish', (state) => {
    const result = runRegistry(state);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.elapsed).toBe(360);
    expect(result.published).toBe('publish\n');
    expect(result.output).toBe('state=new\n');
  });

  it('accepts the final observation at twice the measured six-minute propagation', () => {
    const result = runRegistry('absent', 720);
    expect(result.status, result.stderr).toBe(0);
    expect(result.elapsed).toBe(720);
    expect(result.output).toBe('state=new\n');
  });

  it('fails closed beyond the bound and tells the operator to rerun the job', () => {
    const result = runRegistry('absent', 730);
    expect(result.status).toBe(1);
    expect(result.elapsed).toBe(720);
    expect(result.stderr).toMatch(/73 observations.*absent/);
    expect(result.stderr).toMatch(/rerun.*publish.*job/i);
    expect(result.output).toBe('');
    expect(result.published).toBe('publish\n');
  });

  it('recovers an already attested version without publishing it again', () => {
    const result = runRegistry('existing');
    expect(result.status, result.stderr).toBe(0);
    expect(result.elapsed).toBe(0);
    expect(result.published).toBe('');
    expect(result.output).toBe('state=existing\n');
  });

  it.each(['conflict', 'auth', 'malformed'])('rejects %s immediately after publishing', (state) => {
    const result = runRegistry(state);
    expect(result.status).not.toBe(0);
    expect(result.elapsed).toBe(0);
    expect(result.output).toBe('');
    expect(result.published).toBe('publish\n');
    expect(result.stderr).toMatch(/registry classification:/);
  });
});
