import { type Dirent, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { journalFingerprint, readMissionJournals } from './journal.js';
import { RETIRED_SKILLS, wasEverOurs } from './retired-skills.js';
import { voidMachinePath } from './void-layout.js';
import { PRODUCT_COMMAND } from './identity.js';

/**
 * Whether the invocation surface is still reachable, judged from what the
 * harness recorded about itself.
 *
 * The harness is blind to its own refused calls: a `Skill` invocation under an
 * unknown name is rejected by the runtime before the first hook runs, and writes
 * no event at all (measured 2026-08-19, journal unchanged to the byte). So the
 * panne itself is unobservable, and only its traces are: a name that was
 * recorded and no longer resolves, or a silence where activations should be.
 *
 * The reference is the skills actually installed on disk, not a compiled
 * catalogue. The question being asked is "does this name resolve here, now",
 * which is what the directory answers and a model of it only approximates.
 */
export interface ResolutionVerdict {
  readonly ok: boolean;
  /** Retired names the NEWEST run still calls. These, and only these, fail. */
  readonly unresolved: readonly string[];
  /** Every retired name seen in the window, current or not. Informs, never fails. */
  readonly retired: readonly string[];
}

const SKILL_RUNTIME_DIRS = ['.claude', '.agents'] as const;

/** Strip any plugin namespace (`harness:void-tdd` -> `void-tdd`), the form the defect was recorded under. */
function bareName(raw: string): string {
  const colon = raw.lastIndexOf(':');
  return colon >= 0 ? raw.slice(colon + 1) : raw;
}

/** The skills a runtime could actually resolve in this project. */
export function installedSkillNames(root: string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const runtime of SKILL_RUNTIME_DIRS) {
    const skills = join(root, runtime, 'skills');
    let entries: Dirent[];
    try {
      entries = readdirSync(skills, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      // A directory without a SKILL.md resolves to nothing, so it is not a skill
      // however much its name suggests one.
      if (!entry.isDirectory()) continue;
      if (existsSync(join(skills, entry.name, 'SKILL.md'))) names.add(entry.name);
    }
  }
  return names;
}

interface JournalEvent {
  readonly source: string;
  readonly kind: string;
  readonly missionId: string;
  readonly category: string;
  readonly subject: string;
  readonly ts: string;
}

/**
 * Walk a journal body without materialising it.
 *
 * A truncated line is a rotated journal, never a reason to fail a session, so
 * every unreadable line is skipped rather than thrown on.
 */
function eachEvent(body: string, visit: (event: JournalEvent) => void): void {
  for (const line of body.split('\n')) {
    if (line === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const record = parsed as Record<string, unknown>;
    const payload = record['payload'];
    const category =
      typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>)['category']
        : undefined;
    visit({
      source: typeof record['source'] === 'string' ? record['source'] : '',
      kind: typeof record['kind'] === 'string' ? record['kind'] : '',
      missionId: typeof record['missionId'] === 'string' ? record['missionId'] : '',
      category: typeof category === 'string' ? category : '',
      subject: typeof record['subject'] === 'string' ? record['subject'] : '',
      ts: typeof record['ts'] === 'string' ? record['ts'] : '',
    });
  }
}

/**
 * How far back a live defect is judged from.
 *
 * A rename is legitimate, and the journal keeps the old name forever because it
 * records what happened. Judging the whole history makes the alert permanent for
 * a defect already fixed, and an alert nobody can extinguish is an alert they
 * disable -- the same objection this design raised against a threshold on the
 * activation ratio. Thirty days is long enough to catch a rename made this
 * month, short enough that a repaired one goes quiet on its own.
 */
const LIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface ResolutionOptions {
  /** Judge only activations newer than 30 days before this instant. Absent judges everything. */
  readonly nowMs?: number;
}

interface RecordedName {
  readonly name: string;
  readonly missionId: string;
}

/** The mission id of the most recent recorded activation, or `''` when there is none. */
function newestMission(body: string, nowMs?: number): string {
  let latest = '';
  let mission = '';
  eachEvent(body, (event) => {
    if (event.kind !== 'runtime.tool.started') return;
    if (nowMs !== undefined) {
      const at = Date.parse(event.ts);
      if (!Number.isNaN(at) && at < nowMs - LIVE_WINDOW_MS) return;
    }
    if (event.ts > latest) {
      latest = event.ts;
      mission = event.missionId;
    }
  });
  return mission;
}

/** Bare skill names recorded as fired in a journal body, with the run they belong to. */
function recordedSkillNames(body: string, nowMs?: number): RecordedName[] {
  const names: RecordedName[] = [];
  const floor = nowMs === undefined ? undefined : nowMs - LIVE_WINDOW_MS;
  eachEvent(body, (event) => {
    if (event.kind !== 'runtime.tool.started' || event.category !== 'skill') return;
    if (!event.subject.startsWith('skill:')) return;
    if (floor !== undefined) {
      const at = Date.parse(event.ts);
      // An unreadable timestamp is kept: dropping it would let a broken clock
      // hide a live defect, and a false alert costs less than a missed one here.
      if (!Number.isNaN(at) && at < floor) return;
    }
    names.push({ name: bareName(event.subject.slice('skill:'.length)), missionId: event.missionId });
  });
  return names;
}

/**
 * The skill that carries a retired name's work now, when one does.
 *
 * The remedy is the point: "reinstall the harness" is what a renamed skill does
 * not need, and naming its successor is the one sentence that ends the search.
 */
export function replacementFor(name: string): string | undefined {
  return RETIRED_SKILLS[name];
}

/** The names this project recorded that it can no longer resolve. */
export function resolutionVerdict(
  body: string,
  installed: ReadonlySet<string>,
  options: ResolutionOptions = {},
): ResolutionVerdict {
  const recorded = recordedSkillNames(body, options.nowMs);
  // Ours to judge only. A runtime resolves skills from several providers, and a
  // name we never shipped is not a defect of this install: reporting it printed
  // a remedy that could not work, on a line that also carried the real ones.
  const ours = (entry: RecordedName): boolean =>
    !installed.has(entry.name) && wasEverOurs(entry.name);
  const retired = [...new Set(recorded.filter(ours).map((entry) => entry.name))].sort();
  // `doctor` reports the present. A rename nothing calls any more is history, and
  // no action clears it -- the verdict would stay red until a window expired,
  // which is a verdict nobody can satisfy. Only the newest run decides.
  const newest = newestMission(body, options.nowMs);
  const unresolved = [
    ...new Set(recorded.filter((entry) => ours(entry) && entry.missionId === newest).map((entry) => entry.name)),
  ].sort();
  return { ok: unresolved.length === 0, unresolved, retired };
}

/**
 * A retired name rendered with what replaced it: `session-handoff -> checkpoint`.
 *
 * The successor IS the remedy. Told only that a name no longer resolves, the
 * reader goes looking for a missing file; told what took it over, they are done.
 */
export function withSuccessor(name: string): string {
  const replacement = replacementFor(name);
  return replacement === undefined ? name : `${name} -> ${replacement}`;
}

/** How many names the banner spells out before falling back to a count. */
const MAX_NAMED = 5;

/**
 * The block a session opening carries when the surface is broken, or nothing.
 *
 * Silence in the healthy case is the whole design: a banner that speaks every
 * session is a banner nobody reads, and this alert only has to survive until
 * someone acts on it once. Lines rather than one sentence, because the banner
 * already runs long and a run-on clause at its end is what gets skipped.
 *
 * Plain text on purpose: this is injected into the model's context, not printed
 * to a terminal, so ANSI colour would be parasite text rather than colour. The
 * coloured rendering of the same verdicts belongs to `doctor`.
 */
export function invocationAlert(
  resolution: ResolutionVerdict,
  liveness: LivenessVerdict,
): string | undefined {
  if (resolution.ok && liveness.ok && liveness.unobservable.length === 0) return undefined;
  const lines = [`${PRODUCT_COMMAND}, invocation surface:`];
  if (!resolution.ok) {
    const named = resolution.unresolved.slice(0, MAX_NAMED).map(withSuccessor).join(', ');
    const rest = resolution.unresolved.length - MAX_NAMED;
    const tail = rest > 0 ? `, and ${rest} more` : '';
    lines.push(
      `  ${resolution.unresolved.length} skill invocation(s) in this run name a skill that no longer exists: ${named}${tail}`,
    );
  }
  if (!liveness.ok) {
    lines.push(
      `  no skill fired in the last ${liveness.missions} working missions (${liveness.toolCalls} tool calls); runtime:claude`,
    );
  }
  for (const { source, toolCalls } of liveness.unobservable) {
    lines.push(`  skill usage not observable for ${source} (${toolCalls} tool calls); activation count unknown`);
  }
  lines.push(`  run \`${PRODUCT_COMMAND} doctor\` for the detail`);
  return lines.join('\n');
}

/**
 * Whether skills are still being reached at all.
 *
 * A silence proves nothing on its own: a session spent reading code fires no
 * skill and is perfectly healthy. It only means something against missions that
 * demonstrably worked, and work is counted in **tool calls** -- never in hooks,
 * which belong to enforcement and would make this verdict drift the day the
 * floor gains or loses a rule.
 */
export interface LivenessVerdict {
  /** No proven silence on the observable surface; not proof of Codex usage. */
  readonly ok: boolean;
  /** Working missions actually judged, capped at the window. */
  readonly missions: number;
  /** Tool calls across those missions, the evidence that they worked. */
  readonly toolCalls: number;
  /** Skill activations across those missions. Context for `doctor`, never a threshold. */
  readonly skillCalls: number;
  /** Collected calls whose runtime exposes no supported skill-activation signal. */
  readonly unobservable: readonly { readonly source: string; readonly toolCalls: number }[];
}

/** Tool calls below which a mission proves nothing and is not judged. */
const WORKING_MISSION_CALLS = 20;
/** Working missions that must all be silent before the surface is called dead. */
const LIVENESS_WINDOW = 3;

interface MissionTally {
  toolCalls: number;
  skillCalls: number;
  lastTs: string;
}

export function livenessVerdict(body: string): LivenessVerdict {
  const tallies = new Map<string, MissionTally>();
  const unobservable = new Map<string, number>();
  eachEvent(body, (event) => {
    if (event.kind !== 'runtime.tool.started' || event.missionId === '') return;
    // Only Claude's Skill tool makes silence measurable. A SKILL.md shell read
    // is context loading, not an invocation event. Missing/unknown provenance
    // must not be promoted to an observable runtime either.
    if (event.source !== 'runtime:claude') {
      const source = event.source || 'runtime:unknown';
      unobservable.set(source, (unobservable.get(source) ?? 0) + 1);
      return;
    }
    const tally = tallies.get(event.missionId) ?? { toolCalls: 0, skillCalls: 0, lastTs: '' };
    tally.toolCalls += 1;
    if (event.category === 'skill') tally.skillCalls += 1;
    if (event.ts > tally.lastTs) tally.lastTs = event.ts;
    tallies.set(event.missionId, tally);
  });

  const judged = [...tallies.values()]
    .filter((tally) => tally.toolCalls >= WORKING_MISSION_CALLS)
    .sort((a, b) => (a.lastTs < b.lastTs ? 1 : a.lastTs > b.lastTs ? -1 : 0))
    .slice(0, LIVENESS_WINDOW);

  const toolCalls = judged.reduce((total, tally) => total + tally.toolCalls, 0);
  const skillCalls = judged.reduce((total, tally) => total + tally.skillCalls, 0);
  // Under a full window there is no verdict to give: two silent missions are a
  // quiet week, and crying on them is how a guardrail gets turned off.
  const ok = judged.length < LIVENESS_WINDOW || judged.some((tally) => tally.skillCalls > 0);
  return {
    ok, missions: judged.length, toolCalls, skillCalls,
    unobservable: [...unobservable].sort(([a], [b]) => a.localeCompare(b))
      .map(([source, calls]) => ({ source, toolCalls: calls })),
  };
}

/**
 * The verdict, computed once and read at every session opening.
 *
 * Reading the journals costs 49 ms on this repository -- 11 MB for the twelve
 * lines that matter -- and a session start must never wait on work whose answer
 * can be one session old without anyone being worse off. So the banner reads
 * this file, and the refresh happens after stdout, exactly as the version
 * freshness check already does.
 *
 * It is a cache, not a second source of truth: it holds nothing the journals do
 * not, and deleting it costs one stale session.
 */
const VERDICT_VERSION = 2;

interface CachedVerdict {
  readonly version: typeof VERDICT_VERSION;
  readonly fingerprint: string;
  readonly alert?: string;
}

function cachePath(root: string): string {
  return voidMachinePath(root, 'invocation.json');
}

/** The last computed alert, or nothing. Never throws: a session must start. */
export function cachedInvocationAlert(root: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(cachePath(root), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    if ((parsed as Record<string, unknown>)['version'] !== VERDICT_VERSION) return undefined;
    const alert = (parsed as Record<string, unknown>)['alert'];
    return typeof alert === 'string' && alert !== '' ? alert : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Recompute the verdict when the journals moved, and store it.
 *
 * Called after stdout, so its cost is paid by a session that has already
 * started. Every failure is swallowed: an advisory verdict must never be able
 * to break a session.
 */
export function refreshInvocationVerdict(root: string): void {
  try {
    const fingerprint = journalFingerprint(root);
    const path = cachePath(root);
    try {
      const previous: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (
        typeof previous === 'object'
        && previous !== null
        && (previous as Record<string, unknown>)['version'] === VERDICT_VERSION
        && (previous as Record<string, unknown>)['fingerprint'] === fingerprint
      ) return;
    } catch {
      // No usable cache: compute one.
    }
    // Same bounded corpus as doctor: 64 MiB, 10,000 missions per location.
    // Filter runtime before the liveness window so Codex cannot evict Claude.
    const journals = readMissionJournals(root);
    const alert = invocationAlert(
      resolutionVerdict(journals, installedSkillNames(root), { nowMs: Date.now() }),
      livenessVerdict(journals),
    );
    const entry: CachedVerdict = { version: VERDICT_VERSION, fingerprint, ...(alert === undefined ? {} : { alert }) };
    mkdirSync(dirname(path), { recursive: true });
    // Temporary sibling then rename, so a session never reads half a verdict.
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(entry)}\n`);
    renameSync(temporary, path);
  } catch {
    // Advisory: never alter a session because a verdict could not be written.
  }
}
