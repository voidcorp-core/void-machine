import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../../..');
const CLI = join(ROOT, 'packages/cli');
const SKILLS = ['void-autopilot', 'void-implement'] as const;
// The old published handoff wording, not a fabricated prohibition in a hook.
const LEGACY = {
  'void-autopilot': 'When its proofs are green it pushes its own branch, opens one pull request towards the base, ready for review rather than as a draft.',
  'void-implement': 'Under void-autopilot the worker pushes its own branch and opens the PR.',
};

it('updates old managed PR guidance in both installed runtimes without overwriting private rules', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'void-draft-pr-update-'));
  try {
    const legacy = join(fixture, 'previous-package');
    mkdirSync(legacy);
    for (const name of ['bin', 'dist', 'core-assets', 'package.json']) {
      cpSync(join(CLI, name), join(legacy, name), { recursive: true });
    }
    for (const name of SKILLS) {
      writeFileSync(join(legacy, 'core-assets/skills', name, 'SKILL.md'),
        `---\nname: ${name}\ndescription: Previous PR handoff guidance.\n---\n\n${LEGACY[name]}\n`);
    }
    const project = join(fixture, 'consumer');
    mkdirSync(join(project, '.void'), { recursive: true });
    const privateRule = '# Project rules\n\nThis private instruction belongs to the consumer.\n';
    writeFileSync(join(project, '.void/PROJECT-DOCTRINE.md'), privateRule);
    writeFileSync(join(project, 'package.json'), '{"name":"draft-pr-fixture","private":true}\n');
    const env = { PATH: process.env.PATH, HOME: fixture, TMPDIR: tmpdir(),
      VOID_GLOBAL_DIR: join(fixture, 'global'), npm_config_offline: 'true' };
    const run = (bin: string, args: string[]) => {
      const result = spawnSync(process.execPath, [bin, ...args], {
        cwd: project, env, encoding: 'utf8', timeout: 30_000,
      });
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    };
    run(join(legacy, 'bin/void-machine.mjs'), ['init', '--runtime', 'both', '--no-interactive']);
    for (const runtime of ['.agents', '.claude']) {
      for (const name of SKILLS) {
        expect(readFileSync(join(project, runtime, 'skills', name, 'SKILL.md'), 'utf8'))
          .toContain(LEGACY[name]);
      }
      mkdirSync(join(project, runtime, 'skills/private'), { recursive: true });
      writeFileSync(join(project, runtime, 'skills/private/SKILL.md'), privateRule);
    }
    // The actual previous installer produced ownership. Never edit receipts to
    // make update accept an otherwise unowned file, and never use --force.
    run(join(CLI, 'bin/void-machine.mjs'), ['update']);
    for (const runtime of ['.agents', '.claude']) {
      for (const name of SKILLS) {
        const installed = readFileSync(join(project, runtime, 'skills', name, 'SKILL.md'), 'utf8');
        expect(installed).toBe(readFileSync(join(ROOT, 'packages/core/skills', name, 'SKILL.md'), 'utf8'));
        expect(installed).toContain('coordinator may create or reuse a draft pull request');
        expect(installed).toContain('mark the same pull request ready');
        expect(installed).toContain('commit-only');
        expect(installed).not.toContain('ready for review rather than as a draft');
        expect(installed).not.toContain('worker pushes its own branch and opens the PR');
      }
      expect(readFileSync(join(project, runtime, 'skills/private/SKILL.md'), 'utf8')).toBe(privateRule);
    }
    expect(readFileSync(join(project, '.void/PROJECT-DOCTRINE.md'), 'utf8')).toBe(privateRule);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
