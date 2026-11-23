/**
 * Tests for the plugin-cache health helpers (#68): the hooks a plugin.json
 * wires must exist and be executable in the installed cache.
 */

import { describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hookHealthIssues, locatePluginDir, wiredHooks } from './plugin-cache.js';

// Real manifest commands carry a literal ${CLAUDE_PLUGIN_ROOT} prefix; build it
// by concatenation so biome's noTemplateCurlyInString does not flag the fixture.
const ROOT = '$' + '{CLAUDE_PLUGIN_ROOT}';
const MANIFEST = {
  hooks: {
    PreToolUse: [
      {
        hooks: [
          { command: `node ${ROOT}/hooks/_void-hook.mjs enforce secret-content` },
          { command: 'bash hooks/secret-in-content.sh' },
        ],
      },
    ],
    SessionStart: [{ hooks: [{ command: `${ROOT}/hooks/sessionstart-context.sh` }] }],
  },
};

describe('wiredHooks', () => {
  it('extracts distinct shell and Node hook assets, sorted', () => {
    expect(wiredHooks(MANIFEST)).toEqual([
      'hooks/_void-hook.mjs',
      'hooks/secret-in-content.sh',
      'hooks/sessionstart-context.sh',
    ]);
  });

  it('returns nothing for a manifest with no hooks', () => {
    expect(wiredHooks({})).toEqual([]);
  });
});

function pluginFixture(hooks: Record<string, { exec: boolean }>): string {
  const dir = mkdtempSync(join(tmpdir(), 'plugin-cache-'));
  mkdirSync(join(dir, 'hooks'), { recursive: true });
  for (const [name, { exec }] of Object.entries(hooks)) {
    const abs = join(dir, 'hooks', name);
    writeFileSync(abs, '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(abs, exec ? 0o755 : 0o644);
  }
  return dir;
}

describe('hookHealthIssues', () => {
  it('reports nothing when every wired hook exists and is executable', () => {
    const dir = pluginFixture({
      '_void-hook.mjs': { exec: false },
      'secret-in-content.sh': { exec: true },
      'sessionstart-context.sh': { exec: true },
    });
    try {
      expect(hookHealthIssues(dir, MANIFEST)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flags a missing wired hook', () => {
    const dir = pluginFixture({ '_void-hook.mjs': { exec: false }, 'sessionstart-context.sh': { exec: true } });
    try {
      const issues = hookHealthIssues(dir, MANIFEST);
      expect(issues.some((i) => i.includes('secret-in-content.sh') && i.includes('missing'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('flags a present-but-non-executable hook', () => {
    const dir = pluginFixture({
      '_void-hook.mjs': { exec: false },
      'secret-in-content.sh': { exec: true },
      'sessionstart-context.sh': { exec: false },
    });
    try {
      const issues = hookHealthIssues(dir, MANIFEST);
      expect(issues.some((i) => i.includes('sessionstart-context.sh') && i.includes('not executable'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('locatePluginDir', () => {
  it('returns undefined when the cache root does not exist', () => {
    expect(locatePluginDir(join(tmpdir(), 'no-such-cache-xyz'), 'harness')).toBeUndefined();
  });

  it('finds the plugin dir carrying a plugin.json whose path includes the name', () => {
    const cache = mkdtempSync(join(tmpdir(), 'cache-root-'));
    const pluginDir = join(cache, 'voidcorp', 'harness', '0.15.0');
    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
    writeFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), '{"name":"harness"}');
    try {
      expect(locatePluginDir(cache, 'harness')).toBe(pluginDir);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });
});
