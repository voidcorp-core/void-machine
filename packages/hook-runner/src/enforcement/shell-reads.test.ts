import { describe, expect, it } from 'vitest';
import { shellReadTargets } from './shell-reads.js';

describe('bounded direct shell reads', () => {
  it.each([
    ['grep -n .env src/code.ts', ['src/code.ts']],
    ['grep -f .env src/code.ts', ['.env', 'src/code.ts']],
    ['rg -e.env src/code.ts', ['src/code.ts']],
    ['sed -e "1p" .env', ['.env']],
    ['echo "cat .env"', []],
    ["cat '.env' > output.txt", ['.env']],
    ['cat .env; unsupported --flag', ['.env']],
    ['unsupported < .env', ['.env']],
    ["rg '|' .env", ['.env']],
    ["grep ';' .env", ['.env']],
    ['rg \\| .env', ['.env']],
    ['grep \\; .env', ['.env']],
    ["echo '|' cat .env", []],
    ['echo \\; cat .env', []],
    ["grep '<' .env", ['.env']],
    ['cat .env | head -n 1', ['.env']],
    ['grep -c PATTERN .env', ['.env']],
    ['rg -c PATTERN .env', ['.env']],
    ['grep --color PATTERN .env', ['.env']],
    ['grep --color=auto PATTERN .env', ['.env']],
    ['rg --color auto PATTERN .env', ['.env']],
    ['cat -e .env', ['.env']],
    ['cat -n .env', ['.env']],
    ['tail -f .env', ['.env']],
    ['head -c 2 .env', ['.env']],
    ['tail --bytes 2 .env', ['.env']],
    ['grep -c .env src/code.ts', ['src/code.ts']],
    ['rg --color auto .env src/code.ts', ['src/code.ts']],
  ])('identifies read operands, not patterns or text: %s', (command, paths) => {
    expect(shellReadTargets(command).paths).toEqual(paths);
  });
  it('keeps ignore overrides distinct from hidden-file traversal', () => {
    expect(shellReadTargets('rg -u PATTERN .').unsafeSearch).toBe(false);
    expect(shellReadTargets('rg -uu PATTERN .').unsafeSearch).toBe(true);
    expect(shellReadTargets('rg -u -u PATTERN .').unsafeSearch).toBe(true);
  });
  it.each([
    "grep -r --exclude='.env*' --include='*.ts' PATTERN .",
    'grep --directories=recurse PATTERN .',
    "rg --follow -g '!.env*' PATTERN .",
    "grep -R --exclude='.env*' PATTERN .",
  ])('refuses traversal whose flags restore hidden files or symlink aliases: %s', (command) => {
    expect(shellReadTargets(command).unsafeSearch).toBe(true);
  });
});
