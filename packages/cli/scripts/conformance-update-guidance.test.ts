// @test-resource filesystem
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { assertUpdatedPrGuidance } from './conformance-update.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const SKILLS = ['void-autopilot', 'void-implement'] as const;
const RUNTIMES = ['.agents', '.claude'];

// Actual public acquisition, truthful previous-package receipts and doctrine
// preservation belong to conformance-update's packed current/all/ownership phases.
// These small fixtures prove that their shared assertions reject stale guidance.
function fixture(transform: (source: string) => string = source => source) {
  const root = mkdtempSync(join(tmpdir(), 'void-draft-pr-guidance-'));
  const expected = new Map(SKILLS.map(name => [name,
    transform(readFileSync(join(ROOT, 'packages/core/skills', name, 'SKILL.md'), 'utf8'))]));
  for (const runtime of RUNTIMES) {
    for (const [name, text] of [...expected, ['private', '# private user skill\n'] as const]) {
      const directory = join(root, runtime, 'skills', name);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'SKILL.md'), text);
    }
  }
  return { root, expected, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

it('accepts exact current guidance and preserved private skills in both runtimes', async () => {
  const project = fixture();
  try { await assertUpdatedPrGuidance(project.root, RUNTIMES, project.expected); }
  finally { project.dispose(); }
});

it.each(['ready for review rather than as a draft', 'worker pushes its own branch and opens the PR'])(
  'refuses obsolete guidance even when the candidate contains it: %s', async forbidden => {
    const project = fixture(source => `${source}\n${forbidden}\n`);
    try { await expect(assertUpdatedPrGuidance(project.root, RUNTIMES, project.expected)).rejects.toThrow(/retained/); }
    finally { project.dispose(); }
  });

it.each(['coordinator may create or reuse a draft pull request', 'mark the same pull request ready', 'commit-only'])(
  'refuses missing required guidance even when the candidate omits it: %s', async required => {
    const project = fixture(source => source.replaceAll(required, 'removed fixture instruction'));
    try { await expect(assertUpdatedPrGuidance(project.root, RUNTIMES, project.expected)).rejects.toThrow(/missing/); }
    finally { project.dispose(); }
  });

it.each(['void-implement', 'private'])(
  'refuses changed %s bytes independently of the other runtime', async name => {
    const project = fixture();
    try {
      writeFileSync(join(project.root, '.claude/skills', name, 'SKILL.md'), 'changed fixture bytes');
      await expect(assertUpdatedPrGuidance(project.root, RUNTIMES, project.expected)).rejects.toThrow();
    } finally { project.dispose(); }
  });
