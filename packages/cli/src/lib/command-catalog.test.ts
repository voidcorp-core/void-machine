import { describe, expect, it, vi } from 'vitest';
import { COMMAND_CATALOG, commandName } from './command-catalog.js';
import { printHelp } from '../commands/help.js';
import { asksForHelp } from '../main.js';

describe('canonical CLI command metadata', () => {
  it('resolves every documented command and alias to one command', () => {
    const names = Object.entries(COMMAND_CATALOG).flatMap(([name, command]) => [name, ...command.aliases]);
    expect(new Set(names).size).toBe(names.length);
    for (const [name, command] of Object.entries(COMMAND_CATALOG)) {
      expect(commandName(name)).toBe(name);
      for (const alias of command.aliases) expect(commandName(alias)).toBe(name);
    }
    expect(commandName('missing-command')).toBeUndefined();
    expect(commandName(undefined)).toBe('help');
  });
  it('renders each declared signature in help and retains non-mutating help routing', () => {
    let output = '';
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { output += String(chunk); return true; });
    try { printHelp(); } finally { spy.mockRestore(); }
    for (const command of Object.values(COMMAND_CATALOG)) {
      for (const row of command.help) expect(output).toContain(row.signature);
    }
    expect(asksForHelp('init', ['--help'])).toBe(true);
    expect(asksForHelp('mission', ['--help'])).toBe(false);
  });
});
