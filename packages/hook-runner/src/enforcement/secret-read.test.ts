import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { evaluateRule } from './runner.js';

const root = mkdtempSync(join(tmpdir(), 'secret-read-'));
mkdirSync(join(root, 'src'));
writeFileSync(join(root, '.env'), 'SYNTHETIC_FIXTURE_ONLY=not-a-credential');
writeFileSync(join(root, 'src/code.ts'), 'export const code = 1;');
symlinkSync(join(root, '.env'), join(root, '.env.example'));
writeFileSync(join(root, '.env.sample'), 'SAFE_EXAMPLE_ONLY');
symlinkSync(join(root, '.env'), join(root, 'src/.env.sample'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const check = (tool: string, input: Record<string, unknown>) => evaluateRule('protected-file',
  { tool_name: tool, tool_input: input, cwd: root },
  { root, env: { VOID_MACHINE_ALLOW_SECRET_EDIT: '1' } });

describe('secret reads are refused before execution, independently of edit overrides', () => {
  it.each(['Bash', 'shell', 'shell_command', 'exec_command'])('refuses the incident via %s', (tool) => {
    expect(check(tool, { command: 'grep -n PATTERN .env*', cmd: 'grep -n PATTERN .env*' }))
      .toMatchObject({ allow: false, code: 'SECRET_FILE_READ' });
  });
  it.each([
    ['Read', { file_path: '.env.local' }], ['Read', { path: '/tmp/project/.env' }],
    ['Grep', { pattern: 'PATTERN', path: '.env' }],
    ['Grep', { pattern: 'PATTERN', glob: '.env*' }],
    ['Bash', { command: 'cat README.md .env' }],
    ['Bash', { command: "head -n 2 '/tmp/project/.env.production'" }],
    ['Bash', { command: 'tail -n2 .env' }],
    ['Bash', { command: "sed -n '1p' .env" }],
    ['Bash', { command: 'rg --regexp PATTERN -- .env*' }],
    ['Bash', { command: 'wc -l <.env' }],
    ['Bash', { command: 'cat README.md; grep -n PATTERN .env*' }],
    ['Bash', { command: 'echo ok && /usr/bin/cat .env' }],
    ['Bash', { command: 'cat .env | unsupported --flag' }],
    ['exec_command', { cmd: 'cat .env', workdir: root }],
    ['Read', { file_path: '.env.example.local' }],
    ['Read', { file_path: '.env.example' }],
    ['Bash', { command: 'cat .env.example' }],
    ['read_file', { path: '.env' }],
    ['Bash', { command: 'rg --hidden -g !.env* -g *.ts PATTERN .' }],
    ['Grep', { pattern: 'PATTERN', glob: '*.ts', path: 'src' }],
    ['Bash', { command: "rg '|' .env" }],
    ['Bash', { command: "grep ';' .env" }],
    ['Bash', { command: 'grep -c PATTERN .env' }],
    ['Bash', { command: 'rg -c PATTERN .env' }],
    ['Bash', { command: 'grep --color PATTERN .env' }],
  ] satisfies [string, Record<string, unknown>][])('refuses %s %# without echoing contents', (tool, input) => {
    const verdict = check(tool, input);
    expect(verdict.allow).toBe(false);
    expect(JSON.stringify(verdict)).not.toContain('PATTERN');
    expect(JSON.stringify(verdict)).not.toContain('SYNTHETIC_FIXTURE_ONLY');
  });
  it.each([
    ['Read', { file_path: '.env.local.example' }], ['Read', { path: '.env.sample' }],
    ['Read', { file_path: '.env.template' }], ['Read', { file_path: '.env.dist' }],
    ['Read', { file_path: 'pnpm-lock.yaml' }], ['Read', { file_path: '.void/hooks/_void-hook.mjs' }],
    ['Read', { file_path: 'src/code.ts' }],
    ['Grep', { pattern: '.env', path: 'src/code.ts' }],
    ['Grep', { pattern: 'PATTERN', path: 'src' }],
    ['Bash', { command: "rg '.env' src" }],
    ['Bash', { command: 'grep -n .env src/code.ts' }],
    ['Bash', { command: 'echo .env' }],
    ['Bash', { command: 'printf "%s" .env' }],
    ['Bash', { command: "cat '.env.local.example'" }],
    ['Bash', { command: 'rg PATTERN .' }],
    ['Glob', { pattern: '.env*' }],
    ['Bash', { command: 'rg --files --hidden -g .env*' }],
    ['Grep', { pattern: 'PATTERN', glob: '*.ts', path: 'src/code.ts' }],
    ['Bash', { command: 'rg --hidden PATTERN src/code.ts' }],
    ['Bash', { command: "echo '|' cat .env" }],
    ['Bash', { command: 'grep -c .env src/code.ts' }],
  ] satisfies [string, Record<string, unknown>][])('allows %s %#', (tool, input) => {
    expect(check(tool, input).allow).toBe(true);
  });
  it.each(['grep -r PATTERN .', 'grep -R PATTERN src', 'rg --hidden PATTERN .', 'rg -uu PATTERN'])
    ('refuses recursive search that includes hidden environments: %s', (command) => {
      expect(check('Bash', { command }).code).toBe('SECRET_READ_SCOPE');
    });
  it.each(["grep -r --exclude='.env*' PATTERN .", "rg --hidden -g '!.env*' PATTERN ."])
    ('allows explicit recursive environment exclusion: %s', (command) => {
      expect(check('Bash', { command }).allow).toBe(true);
    });
  it('bounds metadata work for oversized read operand sets', () => {
    const command = `cat ${Array.from({ length: 129 }, (_, index) => `file-${index}`).join(' ')}`;
    expect(check('Bash', { command }).code).toBe('SECRET_READ_SCOPE');
  });
  it.each([
    { cwd: join(root, 'src'), tool_name: 'Read', tool_input: { file_path: '.env.sample' } },
    { cwd: root, tool_name: 'exec_command', tool_input: { cmd: 'cat .env.sample', workdir: 'src' } },
    { cwd: join(root, 'src'), tool_name: 'Bash', tool_input: { command: 'cat .env.sample', cwd: root } },
    { cwd: root, tool_name: 'Read', tool_input: { file_path: join(root, 'src/.env.sample') } },
  ])('resolves symlink metadata from the effective cwd: %#', (payload) => {
    const verdict = evaluateRule('protected-file', payload, { root, env: {} });
    expect(verdict.allow).toBe(payload.tool_input.cwd === root);
  });
});
