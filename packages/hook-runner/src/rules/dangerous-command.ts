import { basename } from 'node:path';
import type { RuleVerdict } from '../enforcement/types.js';
import { scanShell, type ShellScan } from './dangerous-shell.js';
import { allow, block } from './verdict.js';

const BRACED_HOME = `$${'{'}HOME}`;
const ROOT_TARGETS = new Set([
  '/', '/*', '~', '~/', '~/*', '$HOME', '$HOME/', '$HOME/*',
  BRACED_HOME, `${BRACED_HOME}/`, `${BRACED_HOME}/*`, '.', './', './*', '*',
]);
const SQL = /\b(?:drop\s+(?:database|table|schema)|truncate\s+table)\b/i;
const SHELLS = new Set(['sh', 'bash', 'dash', 'zsh', 'ksh']);
const SQL_CLIENTS = new Set(['psql', 'mysql', 'mariadb', 'sqlite3', 'sqlcmd']);
const WRAPPERS = new Set(['sudo', 'env', 'command', 'builtin', 'exec', 'nohup', 'time']);
const WRAPPER_VALUES = new Set(['-u', '-g', '-h', '-p', '-C', '-T', '--user', '--group',
  '--host', '--prompt', '--chdir', '--unset']);

function commandWords(words: readonly string[]): readonly string[] {
  let index = 0;
  while (index < words.length) {
    const word = words[index] ?? '';
    if (/^[A-Za-z_][A-Za-z_0-9]*=/.test(word)
      || ['then', 'do', 'else', 'if', 'while', 'until', '!'].includes(word)) { index += 1; continue; }
    const wrapper = basename(word);
    if (!WRAPPERS.has(wrapper)) break;
    index += 1;
    while (words[index]?.startsWith('-')) {
      const flag = words[index] ?? '';
      if (wrapper === 'env' && (flag === '-S' || /^--split-string(?:=|$)/.test(flag))) {
        const attached = flag.startsWith('--split-string=') ? flag.slice(15) : '';
        return ['eval', attached, ...words.slice(index + 1)];
      }
      if (wrapper === 'sudo' && (/^-[^-]*[si]/.test(flag)
        || flag === '--shell' || flag === '--login')) return ['eval', ...words.slice(index + 1)];
      index += WRAPPER_VALUES.has(flag) ? 2 : 1;
      if (flag === '--') break;
    }
  }
  return words.slice(index);
}

function sqlArguments(name: string, args: readonly string[]): string {
  if (name === 'sqlite3') return args.slice(1).join(' ');
  const short = name === 'psql' ? 'c' : name === 'sqlcmd' ? 'Qq' : 'e';
  const long = name === 'psql' ? '--command' : '--execute';
  return args.flatMap((arg, i) => {
    if (arg === long || (arg.length === 2 && short.includes(arg[1] ?? '') && arg[0] === '-')) {
      return [args[i + 1] ?? ''];
    }
    if (arg.startsWith(`${long}=`)) return [arg.slice(long.length + 1)];
    if (arg[0] === '-' && short.includes(arg[1] ?? '') && arg.length > 2) return [arg.slice(2)];
    return [];
  }).join(' ');
}

function gitViolation(args: readonly string[]): string | undefined {
  let index = 0;
  while (args[index]?.startsWith('-')) {
    index += ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env']
      .includes(args[index] ?? '') ? 2 : 1;
  }
  const operation = args[index];
  const options: string[] = [];
  const values = new Set(operation === 'rebase'
    ? ['--onto', '--strategy', '-s', '--strategy-option', '-X']
    : operation === 'push' ? ['--repo', '--receive-pack', '--exec', '--push-option', '-o']
    : ['--include', '--exclude', '--directory', '--whitespace']);
  for (let i = index + 1; i < args.length && args[i] !== '--'; i += 1) {
    const arg = args[i] ?? '';
    options.push(arg);
    if (values.has(arg)) i += 1;
  }
  if (operation === 'push' && options.some((arg) => arg === '--force' || /^-[^-]*f/.test(arg))
    && !options.some((arg) => /^--force-with-lease(?:=|$)/.test(arg))) {
    return 'git push --force (use --force-with-lease)';
  }
  if (operation === 'rebase' && options.some((arg) => /^--exec(?:=|$)|^-x/.test(arg))) {
    return 'git command-execution flag';
  }
  if (['am', 'apply'].includes(operation ?? '') && options.includes('--unsafe-paths')) {
    return 'git unsafe-path flag';
  }
  return undefined;
}

function operationViolation(words: readonly string[], input: string, depth: number): string | undefined {
  const [executable = '', ...args] = commandWords(words);
  const name = basename(executable);
  if (['rm', 'chmod', 'chown'].includes(name)
    && args.some((arg) => arg === '--recursive' || /^-[A-Za-z]*[rR][A-Za-z]*$/.test(arg))
    && args.some((arg) => ROOT_TARGETS.has(arg))) {
    return name === 'rm' ? 'recursive delete of a root path'
      : 'recursive permission/ownership change on a root path';
  }
  if (/^mkfs(?:\.[a-z0-9]+)?$/i.test(name)) return 'filesystem / raw-device write';
  if (name === 'dd' && args.some((arg) => /^of=\/dev\//.test(arg))) return 'raw-device write';
  if (name === 'git') return gitViolation(args);
  if (SQL_CLIENTS.has(name) && SQL.test(`${input} ${sqlArguments(name, args)}`)) {
    return 'destructive SQL (DROP / TRUNCATE)';
  }
  if (name === 'eval') return violation(args.join(' '), depth + 1);
  if (SHELLS.has(name)) {
    const index = args.findIndex((arg) => /^-[^-]*c/.test(arg));
    if (index >= 0) return violation(args[index + 1] ?? '', depth + 1);
    if (input) return violation(input, depth + 1);
  }
  // Dynamic command names and unsupported executable quoting cannot become literal data.
  if (/[$`]/.test(executable)) return 'unsupported dynamic command';
  return undefined;
}

function scanViolation(scan: ShellScan, depth: number): string | undefined {
  if (scan.unsupported) return 'unsupported executable shell syntax';
  for (const child of scan.substitutions) {
    const found = scanViolation(child, depth + 1);
    if (found) return found;
  }
  let words: string[] = [];
  let input = '';
  const tokens = scan.tokens;
  for (let i = 0; i <= tokens.length; i += 1) {
    const token = tokens[i];
    if (token && !token.control) { words.push(token.value); continue; }
    if (token && /^[<>]/.test(token.value)) {
      const target = tokens[i + 1]?.value ?? '';
      if (token.value.startsWith('>') && /^\/dev\/(sd|nvme|hd|disk)/.test(target)) {
        return 'raw-device write';
      }
      if (token.value === '<<<') input += ` ${target}`;
      i += 1; continue;
    }
    if (words[0] === ':' && token?.value === '(' && tokens[i + 1]?.value === ')'
      && tokens[i + 2]?.value === '{' && tokens[i + 3]?.value === ':'
      && tokens[i + 4]?.value === '|' && tokens[i + 5]?.value === ':') return 'fork bomb';
    const found = operationViolation(words, input, depth);
    if (found) return found;
    input = token?.value === '|' ? `${input} ${words.slice(1).join(' ')}` : '';
    words = [];
  }
  return undefined;
}

function violation(command: string, depth = 0): string | undefined {
  if (depth > 8) return 'shell inspection nesting limit';
  return scanViolation(scanShell(command), depth);
}

export function dangerousCommand(command: string): RuleVerdict {
  const evidence = violation(command);
  return evidence === undefined ? allow() : block(
    'DANGEROUS_COMMAND',
    'refusing a destructive command; use the reviewed one-shot override only when deliberate',
    [evidence],
  );
}
