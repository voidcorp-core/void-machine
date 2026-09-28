// tdd-cover: e2e packages/void-machine/test/presentation-core.test.ts
/**
 * Where a delegated run is shown, and under which name. Pure. A surface is only a view of a
 * native session: choosing, labelling or placing one never decides anything about the run.
 */

export const SURFACE_KINDS = ['herdr', 'cmux', 'tmux'] as const;
export type SurfaceKind = typeof SURFACE_KINDS[number];
export type SurfaceRole = 'work' | 'review';

export const PRESENTATION_LIMITS = {
  /** The whole open, every multiplexer call included, after which the run stays without a view. */
  openMs: 10_000,
  closeMs: 5_000,
  inspectMs: 2_000,
  /** Surfaces one status call inspects; the others read as unknown. */
  inspectionsPerStatus: 16,
  /** Panes of one crew tab before the next run opens a new tab. */
  crewGrid: 4,
} as const;

export interface DetectionFacts {
  /** Whether the path is a Unix socket the current user owns. */
  socketReady(path: string): boolean;
}

type Environment = Readonly<Record<string, string | undefined>>;

function absolute(value: string | undefined): string | undefined {
  return value?.startsWith('/') === true ? value : undefined;
}

/** The cmux socket, as its CLI resolves it: the canonical variable first. */
export function cmuxSocket(env: Environment): string | undefined {
  return absolute(env['CMUX_SOCKET_PATH'] || env['CMUX_SOCKET']);
}

/** The tmux server socket: the first field of `TMUX` (socket,pid,session). */
export function tmuxSocket(env: Environment): string | undefined {
  return absolute(env['TMUX']?.split(',')[0]);
}

/** herdr, then cmux, then tmux, else nothing: the innermost host a person is looking at first. */
export function detectSurface(env: Environment, facts: DetectionFacts): SurfaceKind | 'none' {
  if (env['HERDR_ENV'] === '1') return 'herdr';
  const socket = cmuxSocket(env);
  if (socket !== undefined && facts.socketReady(socket)) return 'cmux';
  if (tmuxSocket(env) !== undefined) return 'tmux';
  return 'none';
}

const LABEL = /^(WORK|REVIEW)-([1-9]\d{0,5})$/;

export function surfaceLabelRole(label: string): SurfaceRole | undefined {
  const prefix = LABEL.exec(label)?.[1];
  return prefix === undefined ? undefined : prefix === 'WORK' ? 'work' : 'review';
}

/** `WORK-n` or `REVIEW-n`, after the highest label of that role already shown. */
export function nextLabel(role: SurfaceRole, taken: readonly string[]): string {
  const prefix = role === 'work' ? 'WORK' : 'REVIEW';
  const highest = taken.reduce((max, label) => {
    const match = LABEL.exec(label);
    return match?.[1] === prefix ? Math.max(max, Number(match[2])) : max;
  }, 0);
  return `${prefix}-${String(highest + 1)}`;
}

/** Work and review runs live in separate tabs: the team that codes is not buried under reviews. */
export function crewFamily(role: SurfaceRole): 'crew' | 'review' {
  return role === 'work' ? 'crew' : 'review';
}

const TICKET = /^[A-Z][A-Z0-9]{0,9}-\d{1,9}$/;

export function ticketToken(ticket: string): string | undefined {
  return TICKET.test(ticket) ? `ticket=${ticket}` : undefined;
}

const PLAIN = /^[A-Za-z0-9_./:@%+=,-]+$/;

/**
 * The display command as a line typed into an interactive shell, or undefined. Nothing is quoted:
 * an argument that would need quoting is refused, so no shell ever sees a character it expands.
 */
export function displayLine(argv: readonly string[]): string | undefined {
  const [command] = argv;
  if (command === undefined || /^[-%]/.test(command)) return undefined;
  const plain = argv.every((argument) => PLAIN.test(argument) && !/^[=~]/.test(argument));
  return plain ? argv.join(' ') : undefined;
}

export interface Placement {
  readonly target: string;
  readonly direction: 'right' | 'down';
}

/** Beside the caller first, then each new surface below the last one opened. */
export function stackPlacement(caller: string, delegated: readonly string[]): Placement {
  const last = delegated[delegated.length - 1];
  return last === undefined ? { target: caller, direction: 'right' } : { target: last, direction: 'down' };
}

export type TabPlacement = { readonly kind: 'new-tab' } | ({ readonly kind: 'split' } & Placement);

/** The first family tab with room, filled as a grid (1 | 2, then each column split), else a new tab. */
export function tabPlacement(tabs: readonly { readonly tab: string; readonly panes: readonly string[] }[])
  : TabPlacement {
  const open = tabs.find((tab) => tab.panes.length > 0 && tab.panes.length < PRESENTATION_LIMITS.crewGrid);
  const [first, second] = open?.panes ?? [];
  if (open === undefined || first === undefined) return { kind: 'new-tab' };
  if (open.panes.length === 1) return { kind: 'split', target: first, direction: 'right' };
  if (open.panes.length === 2 || second === undefined) return { kind: 'split', target: first, direction: 'down' };
  return { kind: 'split', target: second, direction: 'down' };
}

export type SurfaceCauseCode = 'not-detected' | 'no-display-command' | 'not-representable' | 'unreachable'
  | 'timeout' | 'deadline' | 'exit-nonzero' | 'parse-failed' | 'output-overflow' | 'needs-reconciliation'
  | 'identity-mismatch' | 'own-pane' | 'record-corrupt' | 'kind-unavailable';

export interface SurfaceCause {
  readonly code: SurfaceCauseCode;
  readonly step?: string;
  readonly detail?: string;
}

const EXCERPT_CHARS = 400;

/** A cause fit to persist: control characters removed, the excerpt bounded. */
export function surfaceCause(code: SurfaceCauseCode, step?: string, detail?: string): SurfaceCause {
  const printable = [...(detail ?? '').slice(0, EXCERPT_CHARS * 4)]
    .map((character) => { const code = character.charCodeAt(0); return code < 32 || code === 127 ? ' ' : character; })
    .join('');
  // Terminal colour sequences lose their escape above and would otherwise read as `[31m`.
  const clean = printable.replace(/ \[[0-9;]*[A-Za-z]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS);
  return { code, ...(step === undefined ? {} : { step }), ...(clean === '' ? {} : { detail: clean }) };
}
