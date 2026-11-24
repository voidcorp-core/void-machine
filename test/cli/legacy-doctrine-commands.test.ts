// @test-resource subprocess
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { add } from '../../packages/cli/src/commands/add.js';
import { init } from '../../packages/cli/src/commands/init.js';
import { remove } from '../../packages/cli/src/commands/remove.js';
import { runtime } from '../../packages/cli/src/commands/runtime.js';
import { INSTALL_RECEIPT_PATH } from '../../packages/cli/src/lib/receipts.js';
import { INSTALL_MANIFEST_PATH } from '../../packages/cli/src/lib/install-manifest.js';

const oldPath = '.void/installed/PHILOSOPHY.md';
const newPath = '.void/PHILOSOPHY.md';
const legacyDoc = `# Instructions\n\n<!-- void-machine:begin -->\n@${oldPath}\n<!-- void-machine:end -->\n\nKeep project guidance.\n`;
let template: string;
let root: string;
let cwd: string;

beforeAll(async () => {
  template = mkdtempSync(join(tmpdir(), 'void-legacy-template-'));
  const previous = process.cwd();
  process.chdir(template);
  try { await init(['--runtime', 'both', '--no-interactive']); }
  finally { process.chdir(previous); }
}, 60_000);
afterAll(() => rmSync(template, { recursive: true, force: true }));
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'void-legacy-command-'));
  cpSync(template, root, { recursive: true });
  cwd = process.cwd();
  process.chdir(root);
  mkdirSync(join(root, '.void/installed'));
  renameSync(join(root, newPath), join(root, oldPath));
  for (const path of [INSTALL_RECEIPT_PATH, INSTALL_MANIFEST_PATH]) {
    writeFileSync(join(root, path), readFileSync(join(root, path), 'utf8').replaceAll(newPath, oldPath));
  }
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(root, { recursive: true, force: true });
});

function keepOnly(target: 'claude' | 'codex'): void {
  rmSync(join(root, target === 'claude' ? '.codex' : '.claude'), { recursive: true });
  rmSync(join(root, target === 'claude' ? 'AGENTS.md' : 'CLAUDE.md'));
  writeFileSync(join(root, target === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'),
    target === 'claude' ? legacyDoc : legacyDoc.replace(`@${oldPath}`, `- \`${oldPath}\``));
}

function expectLegacyReference(): void {
  const common = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  expect(common.match(/@\.void\/(?:installed\/)?PHILOSOPHY\.md/g)).toEqual([`@${oldPath}`]);
  expect(existsSync(join(root, oldPath))).toBe(true);
}

describe('partial commands on legacy doctrine installations', () => {
  it.each([['claude', false], ['codex', false], ['claude', true], ['codex', true]] as const)('adds the other runtime to %s with destination conflict=%s', async (existing, conflict) => {
    keepOnly(existing);
    if (conflict) {
      writeFileSync(join(root, oldPath), 'Modified published doctrine\n');
      writeFileSync(join(root, newPath), 'Unclaimed conflict\n');
    }
    const before = readFileSync(join(root, oldPath), 'utf8');
    await runtime(['add', existing === 'claude' ? 'codex' : 'claude']);
    expectLegacyReference();
    expect(readFileSync(join(root, existing === 'claude' ? 'CLAUDE.md' : 'AGENTS.md'), 'utf8')).toContain('Keep project guidance.');
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toContain('@AGENTS.md');
    expect(readFileSync(join(root, oldPath), 'utf8')).toBe(before);
    expect(existsSync(join(root, newPath))).toBe(conflict);
    if (conflict) expect(readFileSync(join(root, newPath), 'utf8')).toBe('Unclaimed conflict\n');
  });

  it.each(['add', 'remove'] as const)('marketplace %s preserves modified legacy doctrine and a conflicting new destination', async (command) => {
    keepOnly('claude');
    rmSync(join(root, INSTALL_RECEIPT_PATH)); // a cloned marketplace install has no machine-local receipt
    writeFileSync(join(root, oldPath), 'User-edited published doctrine\n');
    writeFileSync(join(root, newPath), 'Unclaimed conflict\n');
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude/settings.json'), JSON.stringify({ enabledPlugins: {
      'harness@voidcorp': true, 'harness-nextjs@voidcorp': command === 'remove',
    } }));
    // No config pin lookup is needed to exercise the marketplace document refresh.
    rmSync(join(root, '.void/config.json'));
    await (command === 'add' ? add : remove)(['harness-nextjs']);
    expectLegacyReference();
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toContain('Keep project guidance.');
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf8')).toContain('@AGENTS.md');
    expect(readFileSync(join(root, oldPath), 'utf8')).toBe('User-edited published doctrine\n');
    expect(readFileSync(join(root, newPath), 'utf8')).toBe('Unclaimed conflict\n');
  });

  it('keeps the old instructions and doctrine when runtime preparation refuses a conflict', async () => {
    keepOnly('codex');
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude/settings.json'), '{broken');
    const before = readFileSync(join(root, oldPath), 'utf8');
    await expect(runtime(['add', 'claude'])).rejects.toThrow('could not be parsed');
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toBe(legacyDoc.replace(`@${oldPath}`, `- \`${oldPath}\``));
    expect(readFileSync(join(root, oldPath), 'utf8')).toBe(before);
    expect(existsSync(join(root, newPath))).toBe(false);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(false);
  });
});
