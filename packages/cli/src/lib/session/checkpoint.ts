// `.void/machine/checkpoint.md` — what was happening just before the stop.
//
// Pure. Callers read the file; this interprets it.
//
// TOLERANT ON PURPOSE. The checkpoint is prose written by an agent at the end
// of a session, often under time pressure. A parser that rejected an imperfect
// file would throw away the only record of where the work stood, which is the
// exact opposite of the point. So: take the sections you recognise, ignore the
// rest, never throw.
//
// It holds only what NO other artefact holds. Execution state belongs to the
// tracker, what the code does belongs to the diff, durable rules belong to
// doctrine — see the `checkpoint` skill, which owns that routing. A
// checkpoint that grew long has failed its triage, not its format.

export interface Checkpoint {
  /** What this session was for. One line. */
  readonly objective?: string;
  /** Where that sits in the larger arc — the "how much is left" question. */
  readonly position?: string;
  /** What is actually done and proven, and against which commit. */
  readonly state?: string;
  /** Exactly one, exact enough to execute. */
  readonly nextAction?: string;
  readonly openLoops: readonly string[];
  readonly deadEnds: readonly string[];
  readonly assumptions: readonly string[];
  readonly workingSet: readonly string[];
  readonly branch?: string;
  readonly head?: string;
  readonly date?: string;
  /** The single most useful sentence, for a project card. */
  readonly resumeLine?: string;
  /** True when nothing usable was found, so callers can say so plainly. */
  readonly isEmpty: boolean;
}

/** Section titles, normalised. Anything else is ignored rather than rejected. */
const PROSE_SECTIONS: Readonly<Record<string, 'objective' | 'position' | 'state' | 'nextAction'>> =
  {
    objective: 'objective',
    position: 'position',
    state: 'state',
    'where you are': 'state',
    'next action': 'nextAction',
    next: 'nextAction',
  };

const LIST_SECTIONS: Readonly<
  Record<string, 'openLoops' | 'deadEnds' | 'assumptions' | 'workingSet'>
> = {
  'open loops': 'openLoops',
  open: 'openLoops',
  'dead ends': 'deadEnds',
  assumptions: 'assumptions',
  'working set': 'workingSet',
  files: 'workingSet',
};

const MAX_INPUT = 500_000;
const MAX_LINE = 200;
const MAX_ITEMS = 20;

function clamp(text: string): string {
  const flat = [...text]
    .filter((ch) => {
      const point = ch.codePointAt(0) ?? 0;
      return point >= 0x20 || ch === '\n' || ch === '\t';
    })
    .join('')
    .trim();
  return flat.length <= MAX_LINE ? flat : `${flat.slice(0, MAX_LINE - 1)}…`;
}

function frontmatterField(raw: string, key: string): string | undefined {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)?.[1];
  if (block === undefined) return undefined;
  // Read line by line rather than parsing YAML: a malformed block must cost the
  // two fields it carries, not the whole checkpoint.
  for (const line of block.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    if (line.slice(0, separator).trim().toLowerCase() !== key) continue;
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    return value === '' ? undefined : clamp(value);
  }
  return undefined;
}

function bodyOf(raw: string): string {
  return /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n([\s\S]*))?$/.exec(raw)?.[1] ?? raw;
}

interface Section {
  readonly title: string;
  readonly lines: readonly string[];
}

function sectionsOf(body: string): readonly Section[] {
  const found: { title: string; lines: string[] }[] = [];
  for (const line of body.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line) ?? undefined;
    if (heading !== undefined) {
      found.push({ title: (heading[1] ?? '').toLowerCase().replace(/\s+/g, ' ').trim(), lines: [] });
      continue;
    }
    found[found.length - 1]?.lines.push(line);
  }
  return found;
}

function prose(lines: readonly string[]): string | undefined {
  const text = lines.join('\n').trim();
  return text === '' ? undefined : text;
}

/**
 * Bullets, including the ones that wrap.
 *
 * A continuation line is joined into the item above it. Found by reading a real
 * checkpoint back: an item wrapped onto a second line silently lost its tail,
 * which is data loss dressed up as a formatting detail. A blank line ends the
 * item, so two bullets separated by one do not merge.
 */
function bullets(lines: readonly string[]): readonly string[] {
  const items: string[] = [];
  let open = false;
  for (const line of lines) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)?.[1];
    if (bullet !== undefined) {
      items.push(bullet);
      open = true;
      continue;
    }
    if (line.trim() === '') {
      open = false;
      continue;
    }
    if (open && items.length > 0) {
      items[items.length - 1] = `${items[items.length - 1] ?? ''} ${line.trim()}`;
    }
  }
  return items
    .map((item) => clamp(item))
    .filter((item) => item !== '')
    .slice(0, MAX_ITEMS);
}

/** Interpret a checkpoint file. Never throws. */
export function parseCheckpoint(raw: string): Checkpoint {
  const bounded = raw.length > MAX_INPUT ? raw.slice(0, MAX_INPUT) : raw;
  const proseFields: Record<string, string | undefined> = {};
  const listFields: Record<string, readonly string[]> = {
    openLoops: [],
    deadEnds: [],
    assumptions: [],
    workingSet: [],
  };

  for (const section of sectionsOf(bodyOf(bounded))) {
    const proseKey = PROSE_SECTIONS[section.title];
    if (proseKey !== undefined) {
      const text = prose(section.lines);
      if (text !== undefined) proseFields[proseKey] = text;
      continue;
    }
    const listKey = LIST_SECTIONS[section.title];
    if (listKey !== undefined) listFields[listKey] = bullets(section.lines);
  }

  const objective = proseFields.objective;
  const nextAction = proseFields.nextAction;
  // The objective first: a card should say what the work IS, and fall back to
  // what to do next only when the session never named its subject.
  const resumeSource = objective ?? nextAction;
  const resumeLine = resumeSource === undefined ? undefined : clamp(resumeSource.split('\n')[0] ?? '');

  const branch = frontmatterField(bounded, 'branch');
  const head = frontmatterField(bounded, 'head');
  const date = frontmatterField(bounded, 'date');
  const isEmpty =
    objective === undefined
    && nextAction === undefined
    && proseFields.state === undefined
    && proseFields.position === undefined
    && Object.values(listFields).every((items) => items.length === 0);

  return {
    ...(objective === undefined ? {} : { objective }),
    ...(proseFields.position === undefined ? {} : { position: proseFields.position }),
    ...(proseFields.state === undefined ? {} : { state: proseFields.state }),
    ...(nextAction === undefined ? {} : { nextAction }),
    openLoops: listFields.openLoops ?? [],
    deadEnds: listFields.deadEnds ?? [],
    assumptions: listFields.assumptions ?? [],
    workingSet: listFields.workingSet ?? [],
    ...(branch === undefined ? {} : { branch }),
    ...(head === undefined ? {} : { head }),
    ...(date === undefined ? {} : { date }),
    ...(resumeLine === undefined || resumeLine === '' ? {} : { resumeLine }),
    isEmpty,
  };
}
