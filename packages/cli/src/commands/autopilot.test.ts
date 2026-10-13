import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type AutopilotCommandContext, readsStdin, runAutopilotCommand, SUBCOMMANDS } from './autopilot.js';

const NOW = '2026-09-24T12:00:00.000Z';

function context(): AutopilotCommandContext {
  const root = mkdtempSync(join(tmpdir(), 'vh-autopilot-command-'));
  const refuse = (): string => {
    throw new Error('this boundary test reaches no runner');
  };
  return { root, now: NOW, gh: refuse, git: refuse };
}

describe('runAutopilotCommand boundary', () => {
  it('refuses invocation-scoped merge authority', () => {
    const result = runAutopilotCommand(['next', '--auto-merge'], '{}', context());

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/--auto-merge[\s\S]*autopilot merges --by-human/i);
  });

  it.each([
    [[], /without a subcommand/],
    [['teleport'], /teleport/],
    // The cluster engine's subcommands are gone, not silently rerouted.
    [['plan'], /no 'plan' subcommand/],
    [['reconcile'], /no 'reconcile' subcommand/],
  ])('refuses an unroutable argv %j', (argv, message) => {
    const result = runAutopilotCommand(argv, '', context());

    expect(result).toMatchObject({ exitCode: 2, stdout: '' });
    expect(result.stderr).toMatch(message);
  });

  it('prints usage without reading stdin', () => {
    const result = runAutopilotCommand(['--help'], 'not json');

    expect(result).toMatchObject({ exitCode: 0, stderr: '' });
    expect(result.stdout).toContain('autopilot next');
  });

  it('needs an execution context for every command that reads the checkout', () => {
    expect(runAutopilotCommand(['next'], '{}').stderr).toMatch(/project root and a clock/);
    expect(runAutopilotCommand(['judgment', 'conflict-class'], 'not json').stderr).toMatch(/not valid JSON/);
  });

  it('names the complete command surface when routing fails', () => {
    const result = runAutopilotCommand(['nonesuch'], '', context());

    for (const name of Object.keys(SUBCOMMANDS)) expect(result.stderr).toContain(name);
  });

  it('marks as reading a pipe exactly the commands that parse one', () => {
    const readers = Object.entries(SUBCOMMANDS).filter(([, mode]) => mode === 'reads-stdin').map(([name]) => name);
    expect(readers.sort()).toEqual(['judgment', 'next']);
    for (const name of readers) expect(readsStdin([name])).toBe(true);
  });
});
