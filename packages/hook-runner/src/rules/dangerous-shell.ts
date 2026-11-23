// A bounded lexical view for the destructive-operation guard, never an interpreter.
export interface ShellToken {
  readonly value: string;
  readonly control: boolean;
}

export interface ShellScan {
  readonly tokens: ShellToken[];
  readonly substitutions: ShellScan[];
  readonly end: number;
  readonly unsupported: boolean;
}

// ANSI-C quotes produce one literal word: decoding never re-enters shell scanning.
function ansiWord(source: string) {
  const match = /^\$'((?:\\[\s\S]|[^'\\])*)'/.exec(source);
  if (!match) return undefined;
  const escapes: Readonly<Record<string, string>> = {
    a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r',
    t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?',
  };
  let supported = true;
  const value = (match[1] ?? '').replace(
    /\\([0-7]{1,3}|x[\da-fA-F]{1,2}|u[\da-fA-F]{1,4}|U[\da-fA-F]{1,8}|c[\s\S]|[\s\S])/g,
    (raw: string, sequence: string) => {
      if (escapes[sequence] !== undefined) return escapes[sequence];
      if (sequence[0] === 'c') return String.fromCharCode(
        sequence[1] === '?' ? 127 : (sequence.toUpperCase().charCodeAt(1) & 31));
      if (!/^(?:[0-7]|[xuU][\da-fA-F])/.test(sequence)) return raw;
      const octal = /^[0-7]/.test(sequence);
      const code = Number.parseInt(octal ? sequence : sequence.slice(1), octal ? 8 : 16);
      if (code > 0x10ffff) { supported = false; return ''; }
      return String.fromCodePoint(octal ? code & 255 : code);
    },
  );
  // Bash cannot carry NUL in a word; the ANSI-C fragment ends at its first NUL.
  return supported ? { value: value.split('\0', 1)[0] ?? '', length: match[0].length } : undefined;
}

function heredoc(source: string, start: number) {
  const header = /^<<(-?)[ \t]*('[^']+'|"[^"]+"|[\w]+)[ \t]*\n/.exec(source.slice(start));
  if (!header) return undefined;
  const raw = header[2] ?? '';
  const delimiter = raw.replace(/['"]/g, '');
  const bodyStart = start + header[0].length;
  let end = bodyStart;
  while (end <= source.length) {
    const next = source.indexOf('\n', end);
    const line = source.slice(end, next < 0 ? source.length : next);
    if ((header[1] ? line.replace(/^\t+/, '') : line) === delimiter) {
      return { body: source.slice(bodyStart, end), end: next < 0 ? source.length : next,
        expands: !/['"]/.test(raw) };
    }
    if (next < 0) break;
    end = next + 1;
  }
  return undefined;
}

export function scanShell(source: string, start = 0, closing = '', depth = 0, text = false): ShellScan {
  const tokens: ShellToken[] = [];
  const substitutions: ShellScan[] = [];
  let value = '';
  let started = false;
  let quote = text ? '"' : '';
  let groups = 0;
  const flush = (): void => {
    if (started) tokens.push({ value, control: false });
    value = ''; started = false;
  };
  const result = (end: number, unsupported: boolean): ShellScan => {
    flush(); return { tokens, substitutions, end, unsupported };
  };
  if (depth > 8) return result(source.length, true);
  for (let i = start; i < source.length; i += 1) {
    const char = source[i] ?? '';
    const next = source[i + 1] ?? '';
    if (!quote && char === closing && (closing !== ')' || groups === 0)) return result(i, false);
    if (!quote && /[()]/.test(char)) groups += char === '(' ? 1 : -1;
    if (quote === "'") {
      if (char === quote) quote = ''; else value += char;
      continue;
    }
    if (char === '\\' && (!quote || /[$`"\\\n]/.test(next))) {
      if (next !== '\n') { value += next; started = true; }
      i += 1; continue;
    }
    if (!text && ((!quote && char === "'") || char === '"')) {
      quote = quote === char ? '' : char; started = true; continue;
    }
    if ((char === '$' && next === '(') || char === '`'
      || (!quote && /[<>]/.test(char) && next === '(')) {
      const child = scanShell(source, i + (char === '`' ? 1 : 2), char === '`' ? '`' : ')', depth + 1);
      substitutions.push(child); value += '$()'; started = true; i = child.end;
      if (child.unsupported) return result(i, true);
      continue;
    }
    if (!quote && char === '$' && next === "'") {
      const literal = ansiWord(source.slice(i));
      if (!literal) return result(i, true);
      value += literal.value; started = true; i += literal.length - 1; continue;
    }
    if (!quote && source.startsWith('<<', i) && source[i + 2] !== '<') {
      const document = heredoc(source, i);
      if (!document) return result(i, true);
      flush();
      tokens.push({ value: '<<<', control: true }, { value: document.body, control: false });
      if (document.expands) {
        const expanded = scanShell(document.body, 0, '', depth + 1, true);
        if (expanded.unsupported) return result(i, true);
        substitutions.push(...expanded.substitutions);
      }
      i = document.end - 1; continue;
    }
    if (!quote && char === '#' && !started) {
      const newline = source.indexOf('\n', i);
      i = newline < 0 ? source.length : newline - 1; continue;
    }
    if (!quote && (/[\s;|&<>()]/.test(char) || (!started && /[{}]/.test(char)))) {
      flush();
      if (/[^\s]|\n/.test(char)) {
        let operator = char;
        while (/[|&<>]/.test(char) && source[i + 1] === char) { operator += char; i += 1; }
        tokens.push({ value: operator, control: true });
      }
    } else { value += char; started = true; }
  }
  return result(source.length, Boolean((quote && !text) || closing || groups));
}
