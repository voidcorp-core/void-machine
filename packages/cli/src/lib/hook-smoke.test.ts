import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  dirname,
  join,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { smokeInstalledHook } from './hook-smoke.js';

const roots: string[] = [];

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'void-hook-smoke-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('smokeInstalledHook', () => {
  it('executes a non-executable portable Node runner directly', async () => {
    const root = scratch();
    const hook = join(root, '_void-hook.mjs');
    const here = dirname(fileURLToPath(import.meta.url));
    copyFileSync(
      resolve(here, '..', '..', '..', 'core', 'dist', 'hooks', '_void-hook.mjs'),
      hook,
    );
    chmodSync(hook, 0o644);

    await expect(smokeInstalledHook(hook, 'codex')).resolves.toMatchObject({
      fired: true,
    });
  });

  it('requires the executable to emit the expected canonical event', async () => {
    const root = scratch();
    const hook = join(root, 'hook.sh');
    writeFileSync(hook, '#!/bin/sh\nexit 0\n');
    chmodSync(hook, 0o755);

    const result = await smokeInstalledHook(hook, 'codex');

    expect(result).toMatchObject({
      fired: false,
      detail: expect.stringContaining('no matching event'),
    });
  });

  it('reports a non-executable installed hook without trying a shell fallback', async () => {
    const root = scratch();
    const hook = join(root, 'hook.sh');
    writeFileSync(hook, '#!/bin/sh\nexit 0\n');
    chmodSync(hook, 0o644);

    const result = await smokeInstalledHook(hook, 'codex');

    expect(result).toEqual({
      fired: false,
      detail: 'hook is not executable',
    });
  });

  it('passes no ambient secrets to the isolated hook process', async () => {
    const root = scratch();
    const hook = join(root, 'hook.sh');
    writeFileSync(hook, [
      '#!/bin/sh',
      'if [ -n "$' + '{VOID_SMOKE_TEST_SECRET:-}" ]; then exit 9; fi',
      'dir="$VOID_PROJECT_ROOT/.void/runs/$VOID_MISSION_ID"',
      'mkdir -p "$dir"',
      'printf \'{"schemaVersion":1,"seq":1,"eventId":"evt_doctor_smoke","missionId":"%s","ts":"2026-07-24T00:00:00.000Z","source":"runtime:codex","kind":"runtime.tool.started","subject":"tool:Read","correlationId":"%s","payload":{}}\\n\' "$VOID_MISSION_ID" "$VOID_MISSION_ID" > "$dir/events.jsonl"',
    ].join('\n'));
    chmodSync(hook, 0o755);
    const previous = process.env.VOID_SMOKE_TEST_SECRET;
    process.env.VOID_SMOKE_TEST_SECRET = 'must-not-cross-the-probe-boundary';
    try {
      await expect(smokeInstalledHook(hook, 'codex')).resolves.toMatchObject({
        fired: true,
      });
    } finally {
      if (previous === undefined) delete process.env.VOID_SMOKE_TEST_SECRET;
      else process.env.VOID_SMOKE_TEST_SECRET = previous;
    }
  });
});
