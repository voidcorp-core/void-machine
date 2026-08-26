import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resume } from './resume.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resume command', () => {
  it('renders the canonical program with generic work units', async () => {
    const root = mkdtempSync(join(tmpdir(), 'void-resume-command-'));
    mkdirSync(join(root, '.void'), { recursive: true });
    writeFileSync(join(root, '.void', 'config.json'), '{}\n');
    writeFileSync(
      join(root, '.void', 'program.md'),
      '---\nschemaVersion: 1\nstatus: executing\nprogram: demo\nplan: docs/plans/demo.md\nspec: docs/specs/demo.md\nprogress:\n  provider: jira\n  scope: ACME\n  order: [X-1, X-2]\n  states:\n    ready: [Todo]\n    started: [Doing]\n    review: [Review]\n    done: [Done]\nautopilot:\n  schemaVersion: 1\n  enabled: false\n  mergeGate: human\n---\n',
    );
    let written = '';
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written += String(chunk);
      return true;
    });

    await resume([]);

    expect(written).toContain('demo (2 units)');
    expect(written).not.toContain('tickets');
    rmSync(root, { recursive: true, force: true });
  });
});
