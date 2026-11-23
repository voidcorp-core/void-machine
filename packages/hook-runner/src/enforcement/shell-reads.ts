import { basename } from 'node:path';

export interface ReadTargets {
  readonly paths: readonly string[];
  readonly unsafeSearch: boolean;
  readonly searchPaths: readonly string[];
}

export function isShellTool(tool: string): boolean {
  return ['Bash', 'shell', 'shell_command', 'exec_command'].includes(tool);
}

// A bounded lexical subset, not a shell interpreter. Preserve argument roles:
// grep's pattern and echo's text are not file reads. Never execute or expand input.
interface ShellWord {
  readonly value: string;
  readonly control: boolean;
}

function words(command: string): ShellWord[] {
  return (command.match(/(?:"(?:\\.|[^"\\])*"|'[^']*'|\\.|[^\s;|&<>"'\\])+|[;|&<>]+|\n/g) ?? [])
    .map((word) => ({
      control: /^[;|&<>]+$|^\n$/.test(word),
      value: word.replace(/"((?:\\.|[^"\\])*)"|'([^']*)'|\\(.)/g,
      (_match, double: string | undefined, single: string | undefined, escaped: string | undefined) =>
        double ?? single ?? escaped ?? ''),
    }));
}

const READERS = new Set(['cat', 'head', 'tail', 'sed', 'grep', 'rg']);
// Arity belongs to the reader: grep/rg -c counts matches, cat -n numbers lines,
// and grep --color accepts only an attached optional value. None consume a pattern.
const VALUE_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  head: ['-n', '-c', '--lines', '--bytes'],
  tail: ['-n', '-c', '--lines', '--bytes'],
  grep: ['-A', '-B', '-C', '--after-context', '--before-context', '--context',
    '-m', '--max-count', '--exclude-dir', '-d', '--directories'],
  rg: ['-A', '-B', '-C', '--after-context', '--before-context', '--context',
    '-m', '--max-count', '--encoding', '--max-depth', '--maxdepth', '-t', '--type',
    '-T', '--type-not', '--color', '--colors'],
};

function readArguments(command: string, args: readonly string[]): ReadTargets {
  if (command === 'rg' && args.includes('--files')) {
    return { paths: [], unsafeSearch: false, searchPaths: [] };
  }
  const paths: string[] = [];
  const searchPaths: string[] = [];
  const patternReader = ['grep', 'rg', 'sed'].includes(command);
  let pattern = !patternReader;
  let options = true;
  let hidden = false;
  let excluded = false;
  let followsLinks = false;
  let unrestricted = 0;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    if (options && arg === '--') { options = false; continue; }
    if (options && arg.startsWith('-')) {
      const [flag = '', attached] = arg.split(/=(.*)/s);
      const value = attached ?? args[i + 1] ?? '';
      if (command === 'rg' && (flag === '--follow' || /^-[^-]*L/.test(flag))) followsLinks = true;
      if (command === 'grep' && (flag === '--dereference-recursive' || /^-[^-]*R/.test(flag))) {
        followsLinks = true;
      }
      if (patternReader && ['-e', '--regexp', '--expression'].includes(flag)) {
        pattern = true;
        if (attached === undefined) i += 1;
      } else if (patternReader && ['-f', '--file'].includes(flag)) {
        paths.push(value);
        pattern = true;
        if (attached === undefined) i += 1;
      } else if (['-g', '--glob', '--iglob', '--exclude', '--include'].includes(flag)) {
        if (flag === '--exclude') excluded ||= value === '.env*';
        else {
          if (!value.startsWith('!')) { paths.push(value); hidden = true; excluded = false; }
          if (value === '!.env*') excluded = true;
        }
        if (attached === undefined) i += 1;
      } else if (command === 'rg' && (flag === '--hidden' || /^-[^-]*u/.test(flag))) {
        unrestricted += [...flag].filter((letter) => letter === 'u').length;
        hidden ||= flag === '--hidden' || unrestricted >= 2;
      } else if (command === 'grep' && (flag === '--recursive' || /^-[^-]*[rR]/.test(flag)
        || (['-d', '--directories'].includes(flag) && value === 'recurse'))) {
        hidden = true;
        if (flag === '-d' || (flag === '--directories' && attached === undefined)) i += 1;
      } else if (VALUE_OPTIONS[command]?.includes(flag)) {
        if (attached === undefined) i += 1;
      } else if (patternReader && /^-(?:e|f|g).+/.test(flag)) {
        const value = flag.slice(2);
        if (flag[1] === 'f') { paths.push(value); pattern = true; }
        if (flag[1] === 'e') pattern = true;
        if (flag[1] === 'g') {
          if (!value.startsWith('!')) { paths.push(value); hidden = true; excluded = false; }
          if (value === '!.env*') excluded = true;
        }
      }
      continue;
    }
    if (!pattern) { pattern = true; continue; }
    if (arg !== '-') { paths.push(arg); searchPaths.push(arg); }
  }
  const unsafeSearch = (hidden && !excluded) || followsLinks;
  return { paths, unsafeSearch, searchPaths: unsafeSearch ? searchPaths.length ? searchPaths : ['.'] : [] };
}

export function shellReadTargets(command: string): ReadTargets {
  const paths: string[] = [];
  const searchPaths: string[] = [];
  let unsafeSearch = false;
  let segment: string[] = [];
  const inspect = (): void => {
    const name = basename(segment[0] ?? '');
    if (READERS.has(name)) {
      const read = readArguments(name, segment.slice(1));
      paths.push(...read.paths);
      searchPaths.push(...read.searchPaths);
      unsafeSearch ||= read.unsafeSearch;
    }
    segment = [];
  };
  const tokens = words(command);
  for (let i = 0; i < tokens.length; i += 1) {
    const word = tokens[i];
    if (word === undefined) continue;
    const token = word.value;
    if (!word.control) { segment.push(token); continue; }
    if (/^[;|&]+$|^\n$/.test(token)) { inspect(); continue; }
    if (token === '<') { paths.push(tokens[i + 1]?.value ?? ''); i += 1; continue; }
    if (/^[<>]+$/.test(token)) { i += 1; continue; }
    segment.push(token);
  }
  inspect();
  return { paths, unsafeSearch, searchPaths };
}
