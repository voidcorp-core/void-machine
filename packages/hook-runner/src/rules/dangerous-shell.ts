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
    if (!quote && char === '$' && next === "'") return result(i, true);
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
