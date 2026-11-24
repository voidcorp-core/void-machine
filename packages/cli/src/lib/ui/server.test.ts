import { execFileSync } from 'node:child_process';
import type { Server } from 'node:http';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMMAND_CENTER_HTML } from './page.js';
import { readProjectsPayload } from './payload.js';
import { corsFor, startCommandCenter } from './server.js';

/**
 * The parity test is the point of this file: the served route and the CLI must
 * return the SAME object for the same question. Without it, the server slowly
 * becomes a third implementation beside the Core and the CLI, and the three
 * disagree about what a project's state is with no way to tell which is right.
 *
 * The rest asserts the posture: loopback, process-local token, read-only.
 */

let park: string;
let globalDir: string;
let server: Server | undefined;
let base: string;
const TOKEN = 'launch-token-for-tests';

function repo(name: string): string {
  const dir = join(park, name);
  mkdirSync(join(dir, '.void'), { recursive: true });
  writeFileSync(join(dir, '.void', 'config.json'), JSON.stringify({ packs: {} }));
  for (const args of [
    ['init', '-q'],
    ['config', 'user.email', 't@t.io'],
    ['config', 'user.name', 'T'],
    ['config', 'commit.gpgsign', 'false'],
  ]) {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  }
  writeFileSync(join(dir, 'README.md'), '# hi\n');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir, stdio: 'ignore' });
  return dir;
}

async function start(): Promise<void> {
  await new Promise<void>((resolve) => {
    server = startCommandCenter({
      // Port 0 lets the OS choose, so a test never fights a real server.
      port: 0,
      launchToken: TOKEN,
      read: () => readProjectsPayload({ globalDir, cwd: park }),
      html: COMMAND_CENTER_HTML,
      onListening: (port) => {
        base = `http://127.0.0.1:${String(port)}`;
        resolve();
      },
    });
  });
}

/** Perform the launch exchange and return the session cookie. */
async function authorize(): Promise<string> {
  const response = await fetch(`${base}/auth?token=${TOKEN}`, { redirect: 'manual' });
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

beforeEach(() => {
  park = realpathSync(mkdtempSync(join(tmpdir(), 'void-srv-park-')));
  globalDir = realpathSync(mkdtempSync(join(tmpdir(), 'void-srv-global-')));
  writeFileSync(join(globalDir, 'discovery.json'), JSON.stringify({ roots: [park] }));
});
afterEach(async () => {
  if (server !== undefined) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
  rmSync(park, { recursive: true, force: true });
  rmSync(globalDir, { recursive: true, force: true });
});

describe('command centre server', () => {
  it('serves the same payload the CLI composes', async () => {
    repo('alpha');
    repo('bravo');
    await start();
    const cookie = await authorize();

    const served = await (await fetch(`${base}/api/projects`, { headers: { cookie } })).json();
    const direct = readProjectsPayload({ globalDir, cwd: park });

    // `readAt` is the one field that legitimately differs between two reads.
    expect({ ...served, readAt: '' }).toEqual(
      JSON.parse(JSON.stringify({ ...direct, readAt: '' })),
    );
  });

  it('serves the page shell at the root', async () => {
    await start();
    const cookie = await authorize();

    const body = await (await fetch(base, { headers: { cookie } })).text();

    expect(body).toContain('Void projects');
    // Offline by construction: nothing may be fetched from another host.
    expect(body).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
  });

  it('refuses every request without the session cookie', async () => {
    await start();

    expect((await fetch(`${base}/api/projects`)).status).toBe(403);
    expect((await fetch(base)).status).toBe(403);
  });

  it('refuses a wrong launch token', async () => {
    await start();

    expect((await fetch(`${base}/auth?token=wrong`, { redirect: 'manual' })).status).toBe(403);
  });

  // The token stays valid for the life of the process. A dashboard is opened again and again — second
  // browser, second screen, after clearing cookies — and a one-shot link turns
  // each of those into "restart the command". The secret is printed on the
  // owner's own terminal and dies with the process; anyone who can read that
  // scrollback can already read the files being summarised.
  it('accepts the launch token more than once, for the life of the process', async () => {
    await start();
    const first = await authorize();
    const second = await authorize();

    expect(first).not.toBe('');
    expect(second).not.toBe('');
    const response = await fetch(`${base}/api/projects`, { headers: { cookie: second } });
    expect(response.status).toBe(200);
  });

  it('keeps an earlier session valid after a second exchange', async () => {
    await start();
    const first = await authorize();
    await authorize();

    expect((await fetch(`${base}/api/projects`, { headers: { cookie: first } })).status).toBe(200);
  });

  it('offers no way to mutate anything', async () => {
    await start();
    const cookie = await authorize();

    const response = await fetch(`${base}/api/projects`, { method: 'POST', headers: { cookie } });

    expect(response.status).toBe(405);
  });

  it('answers 404 on an unknown path rather than leaking the page', async () => {
    await start();
    const cookie = await authorize();

    expect((await fetch(`${base}/../etc/passwd`, { headers: { cookie } })).status).toBe(404);
  });

  it('sends headers that refuse framing and caching', async () => {
    await start();
    const cookie = await authorize();

    const response = await fetch(base, { headers: { cookie } });

    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('reads on every request rather than once at startup', async () => {
    await start();
    const cookie = await authorize();
    const before = await (await fetch(`${base}/api/projects`, { headers: { cookie } })).json();

    repo('appeared-later');
    const after = await (await fetch(`${base}/api/projects`, { headers: { cookie } })).json();

    expect((before as { projects: unknown[] }).projects).toHaveLength(0);
    expect((after as { projects: unknown[] }).projects).toHaveLength(1);
  });
});

describe('corsFor', () => {
  it('reflects a localhost origin for an authorized local browser', () => {
    expect(corsFor('http://localhost:5173')).toEqual({
      'Access-Control-Allow-Origin': 'http://localhost:5173',
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin',
    });
    expect(corsFor('http://127.0.0.1:4317')['Access-Control-Allow-Origin']).toBe('http://127.0.0.1:4317');
  });

  it('sends NO cors header for a foreign origin (a website cannot read the local data)', () => {
    expect(corsFor('https://evil.example.com')).toEqual({});
    expect(corsFor('https://localhost.evil.com')).toEqual({});
  });

  it('sends no cors header when there is no Origin (same-origin / curl)', () => {
    expect(corsFor(undefined)).toEqual({});
  });
});
