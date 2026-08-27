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

import { createHash } from 'node:crypto';

export interface MechanicalContextState {
  readonly schemaVersion: 1;
  readonly objectiveHash: string;
  readonly workRevision: number;
  readonly semanticRevision: number;
  readonly nudgeEmitted: boolean;
  readonly transcriptFingerprint: string;
  readonly transcriptCursorBytes: number;
  readonly lastMeasurementAtMs: number;
  readonly lastUsedTokens: number;
  readonly readFiles: readonly string[];
  readonly modifiedFiles: readonly string[];
  readonly readFilesOverflow: number;
  readonly modifiedFilesOverflow: number;
  readonly clearPending: boolean;
}

export type MechanicalContextBlock =
  | { readonly status: 'absent' }
  | { readonly status: 'invalid'; readonly reason: 'ambiguous' | 'malformed' }
  | { readonly status: 'valid'; readonly state: MechanicalContextState };

export type MergeMechanicalContextResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: 'ambiguous-mechanical-block' };

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
  readonly mechanicalContext?: MechanicalContextState;
  readonly mechanicalBlockStatus: MechanicalContextBlock['status'];
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
const MAX_PATH = 500;
const MECHANICAL_BEGIN = '<!-- void-harness:context-continuity:begin -->';
const MECHANICAL_END = '<!-- void-harness:context-continuity:end -->';

export function hashCheckpointObjective(objective: string | undefined): string {
  return `sha256:${createHash('sha256').update(objective?.trim() ?? '').digest('hex')}`;
}

function markerPositions(raw: string, marker: string): readonly number[] {
  const positions: number[] = [];
  let cursor = 0;
  while (cursor <= raw.length) {
    const found = raw.indexOf(marker, cursor);
    if (found < 0) break;
    positions.push(found);
    cursor = found + marker.length;
  }
  return positions;
}

function mechanicalBounds(raw: string):
  | { readonly status: 'absent' }
  | { readonly status: 'invalid' }
  | { readonly status: 'valid'; readonly begin: number; readonly end: number } {
  const begins = markerPositions(raw, MECHANICAL_BEGIN);
  const ends = markerPositions(raw, MECHANICAL_END);
  if (begins.length === 0 && ends.length === 0) return { status: 'absent' };
  const begin = begins[0];
  const end = ends[0];
  if (begins.length !== 1 || ends.length !== 1 || begin === undefined || end === undefined) {
    return { status: 'invalid' };
  }
  if (end <= begin) return { status: 'invalid' };
  return { status: 'valid', begin, end: end + MECHANICAL_END.length };
}

function semanticMarkdown(raw: string): string {
  const bounds = mechanicalBounds(raw);
  return bounds.status === 'valid'
    ? `${raw.slice(0, bounds.begin)}${raw.slice(bounds.end)}`
    : raw;
}

function scalar(block: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}:\\s*(.*?)\\s*$`, 'm').exec(block)?.[1];
}

function integerScalar(block: string, key: string): number | undefined {
  const value = Number(scalar(block, key));
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function booleanScalar(block: string, key: string): boolean | undefined {
  const value = scalar(block, key);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function pathList(block: string, heading: string): readonly string[] | undefined {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const section = new RegExp(
    `^### ${escaped}\\s*$([\\s\\S]*?)(?=^### |(?![\\s\\S]))`,
    'm',
  ).exec(block)?.[1];
  if (section === undefined) return undefined;
  const paths = section
    .split(/\r?\n/)
    .map((line) => /^- (.+)$/.exec(line)?.[1])
    .filter((path): path is string => path !== undefined);
  if (paths.length > MAX_ITEMS) return undefined;
  if (paths.some((path) => path.length > MAX_PATH || /[\u0000-\u001f]/.test(path))) return undefined;
  return paths;
}

function stateFromMechanicalBody(block: string): MechanicalContextState | undefined {
  const objectiveHash = scalar(block, 'objective_hash');
  const transcriptFingerprint = scalar(block, 'transcript_fingerprint');
  const workRevision = integerScalar(block, 'work_revision');
  const semanticRevision = integerScalar(block, 'semantic_revision');
  const readFiles = pathList(block, 'Read files');
  const modifiedFiles = pathList(block, 'Modified files');
  if (
    scalar(block, 'schema_version') !== '1'
    || objectiveHash === undefined
    || !/^sha256:[a-f0-9]{64}$/.test(objectiveHash)
    || transcriptFingerprint === undefined
    || !/^sha256:[a-f0-9]{64}$/.test(transcriptFingerprint)
    || workRevision === undefined
    || semanticRevision === undefined
    || semanticRevision > workRevision
    || readFiles === undefined
    || modifiedFiles === undefined
  ) return undefined;
  return mechanicalScalars(block, {
    objectiveHash,
    transcriptFingerprint,
    workRevision,
    semanticRevision,
    readFiles,
    modifiedFiles,
  });
}

function mechanicalScalars(
  block: string,
  required: Pick<MechanicalContextState,
    | 'objectiveHash' | 'transcriptFingerprint' | 'workRevision' | 'semanticRevision'
    | 'readFiles' | 'modifiedFiles'>,
): MechanicalContextState | undefined {
  const nudgeEmitted = booleanScalar(block, 'nudge_emitted');
  const clearPending = booleanScalar(block, 'clear_pending');
  const transcriptCursorBytes = integerScalar(block, 'transcript_cursor_bytes');
  const lastMeasurementAtMs = integerScalar(block, 'last_measurement_at_ms');
  const lastUsedTokens = integerScalar(block, 'last_used_tokens');
  const readFilesOverflow = integerScalar(block, 'read_files_overflow');
  const modifiedFilesOverflow = integerScalar(block, 'modified_files_overflow');
  if (
    nudgeEmitted === undefined || clearPending === undefined
    || transcriptCursorBytes === undefined || lastMeasurementAtMs === undefined
    || lastUsedTokens === undefined || readFilesOverflow === undefined
    || modifiedFilesOverflow === undefined
  ) return undefined;
  return {
    schemaVersion: 1,
    ...required,
    nudgeEmitted,
    transcriptCursorBytes,
    lastMeasurementAtMs,
    lastUsedTokens,
    readFilesOverflow,
    modifiedFilesOverflow,
    clearPending,
  };
}

export function parseMechanicalContextBlock(raw: string): MechanicalContextBlock {
  const bounds = mechanicalBounds(raw);
  if (bounds.status === 'absent') return { status: 'absent' };
  if (bounds.status === 'invalid') return { status: 'invalid', reason: 'ambiguous' };
  const body = raw.slice(bounds.begin + MECHANICAL_BEGIN.length, bounds.end - MECHANICAL_END.length);
  const state = stateFromMechanicalBody(body);
  return state === undefined
    ? { status: 'invalid', reason: 'malformed' }
    : { status: 'valid', state };
}

function renderPaths(paths: readonly string[]): string {
  return paths.map((path) => `- ${path}`).join('\n');
}

export function renderMechanicalContextBlock(state: MechanicalContextState): string {
  return [
    MECHANICAL_BEGIN,
    '## Mechanical context',
    '',
    '```yaml',
    'schema_version: 1',
    `objective_hash: ${state.objectiveHash}`,
    `work_revision: ${String(state.workRevision)}`,
    `semantic_revision: ${String(state.semanticRevision)}`,
    `nudge_emitted: ${String(state.nudgeEmitted)}`,
    `transcript_fingerprint: ${state.transcriptFingerprint}`,
    `transcript_cursor_bytes: ${String(state.transcriptCursorBytes)}`,
    `last_measurement_at_ms: ${String(state.lastMeasurementAtMs)}`,
    `last_used_tokens: ${String(state.lastUsedTokens)}`,
    `read_files_overflow: ${String(state.readFilesOverflow)}`,
    `modified_files_overflow: ${String(state.modifiedFilesOverflow)}`,
    `clear_pending: ${String(state.clearPending)}`,
    '```',
    '',
    '### Read files',
    '',
    renderPaths(state.readFiles),
    '',
    '### Modified files',
    '',
    renderPaths(state.modifiedFiles),
    MECHANICAL_END,
  ].join('\n');
}

export function mergeMechanicalContextBlock(
  raw: string,
  state: MechanicalContextState,
): MergeMechanicalContextResult {
  const bounds = mechanicalBounds(raw);
  if (bounds.status === 'invalid') return { ok: false, error: 'ambiguous-mechanical-block' };
  const block = renderMechanicalContextBlock(state);
  if (bounds.status === 'absent') {
    const separator = raw === '' || raw.endsWith('\n\n') ? '' : raw.endsWith('\n') ? '\n' : '\n\n';
    return { ok: true, value: `${raw}${separator}${block}\n` };
  }
  return {
    ok: true,
    value: `${raw.slice(0, bounds.begin)}${block}${raw.slice(bounds.end)}`,
  };
}

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
  const mechanical = parseMechanicalContextBlock(bounded);
  const semantic = semanticMarkdown(bounded);
  const proseFields: Record<string, string | undefined> = {};
  const listFields: Record<string, readonly string[]> = {
    openLoops: [],
    deadEnds: [],
    assumptions: [],
    workingSet: [],
  };

  for (const section of sectionsOf(bodyOf(semantic))) {
    const proseKey = PROSE_SECTIONS[section.title];
    if (proseKey !== undefined) {
      const text = prose(section.lines);
      if (text !== undefined) proseFields[proseKey] = text;
      continue;
    }
    const listKey = LIST_SECTIONS[section.title];
    if (listKey !== undefined) listFields[listKey] = bullets(section.lines);
  }

  const objective = proseFields['objective'];
  const nextAction = proseFields['nextAction'];
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
    && proseFields['state'] === undefined
    && proseFields['position'] === undefined
    && Object.values(listFields).every((items) => items.length === 0)
    && mechanical.status !== 'valid';

  return {
    ...(objective === undefined ? {} : { objective }),
    ...(proseFields['position'] === undefined ? {} : { position: proseFields['position'] }),
    ...(proseFields['state'] === undefined ? {} : { state: proseFields['state'] }),
    ...(nextAction === undefined ? {} : { nextAction }),
    openLoops: listFields['openLoops'] ?? [],
    deadEnds: listFields['deadEnds'] ?? [],
    assumptions: listFields['assumptions'] ?? [],
    workingSet: listFields['workingSet'] ?? [],
    ...(branch === undefined ? {} : { branch }),
    ...(head === undefined ? {} : { head }),
    ...(date === undefined ? {} : { date }),
    ...(resumeLine === undefined || resumeLine === '' ? {} : { resumeLine }),
    ...(mechanical.status === 'valid' ? { mechanicalContext: mechanical.state } : {}),
    mechanicalBlockStatus: mechanical.status,
    isEmpty,
  };
}
