import { describe, expect, it } from 'vitest';
import { COMMAND_CENTER_HTML } from './page.js';

describe('COMMAND_CENTER_HTML', () => {
  it('renders the generic program projection', () => {
    expect(COMMAND_CENTER_HTML).toContain('project.program.program');
    expect(COMMAND_CENTER_HTML).toContain('project.program.unitCount');
    expect(COMMAND_CENTER_HTML).not.toContain('project.activeProgram');
    expect(COMMAND_CENTER_HTML).not.toContain("+ ' tickets)'");
  });
});
