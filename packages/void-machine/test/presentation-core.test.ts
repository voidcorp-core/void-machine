import { describe, expect, it } from 'vitest';
import {
  type SurfaceKind, cmuxSocket, crewFamily, detectSurface, displayLine, nextLabel, stackPlacement, surfaceCause,
  surfaceLabelRole, tabPlacement, ticketToken, tmuxSocket,
} from '../src/core/presentation.js';

const ready = { socketReady: () => true };
const absent = { socketReady: () => false };

describe('choosing the display surface from the environment', () => {
  it('shows nothing when no multiplexer is present', () => {
    expect(detectSurface({}, ready)).toBe('none');
  });

  it.each([
    ['herdr', { HERDR_ENV: '1' }],
    ['cmux', { CMUX_SOCKET_PATH: '/Users/a/.local/state/cmux/cmux.sock' }],
    ['cmux', { CMUX_SOCKET: '/tmp/cmux.sock' }],
    ['tmux', { TMUX: '/private/tmp/tmux-501/default,4242,0' }],
  ] as const)('detects %s from its own variable', (kind: SurfaceKind, env) => {
    expect(detectSurface(env, ready)).toBe(kind);
  });

  it('prefers herdr, then cmux, then tmux when several are nested', () => {
    const all = { HERDR_ENV: '1', CMUX_SOCKET_PATH: '/s.sock', TMUX: '/t,1,0' };
    expect(detectSurface(all, ready)).toBe('herdr');
    expect(detectSurface({ ...all, HERDR_ENV: undefined }, ready)).toBe('cmux');
    expect(detectSurface({ TMUX: '/t,1,0' }, ready)).toBe('tmux');
  });

  it('takes cmux only when its socket is a live socket, and falls through otherwise', () => {
    const env = { CMUX_SOCKET_PATH: '/Users/a/cmux.sock', TMUX: '/t,1,0' };
    expect(detectSurface(env, absent)).toBe('tmux');
    expect(detectSurface({ CMUX_SOCKET_PATH: '/Users/a/cmux.sock' }, absent)).toBe('none');
  });

  it('ignores empty, relative or foreign values', () => {
    expect(detectSurface({ HERDR_ENV: '0', CMUX_SOCKET_PATH: '', TMUX: '' }, ready)).toBe('none');
    expect(detectSurface({ HERDR_ENV: 'true' }, ready)).toBe('none');
    expect(detectSurface({ CMUX_SOCKET_PATH: 'cmux.sock' }, ready)).toBe('none');
    expect(detectSurface({ TMUX: 'default,1,0' }, ready)).toBe('none');
  });

  it('reads the scope each multiplexer is reached through', () => {
    expect(tmuxSocket({ TMUX: '/private/tmp/tmux-501/default,4242,0' })).toBe('/private/tmp/tmux-501/default');
    expect(cmuxSocket({ CMUX_SOCKET_PATH: '/a.sock', CMUX_SOCKET: '/b.sock' })).toBe('/a.sock');
    expect(cmuxSocket({ CMUX_SOCKET: '/b.sock' })).toBe('/b.sock');
  });
});

describe('labelling a surface', () => {
  it('numbers after the highest label of the same role', () => {
    expect(nextLabel('work', [])).toBe('WORK-1');
    expect(nextLabel('work', ['WORK-1', 'WORK-4', 'REVIEW-9'])).toBe('WORK-5');
    expect(nextLabel('review', ['WORK-2'])).toBe('REVIEW-1');
  });

  it('ignores labels that only resemble a crew label', () => {
    expect(nextLabel('work', ['ORCH', 'WORK-x', 'my WORK-7', 'WORK-07b', 'WORK-3'])).toBe('WORK-4');
  });

  it('reads the role a crew label carries, and the tab family of a role', () => {
    expect(surfaceLabelRole('WORK-3')).toBe('work');
    expect(surfaceLabelRole('REVIEW-12')).toBe('review');
    expect(surfaceLabelRole('RUN')).toBeUndefined();
    expect(crewFamily('work')).toBe('crew');
    expect(crewFamily('review')).toBe('review');
  });

  it('admits only a ticket key as pane metadata', () => {
    expect(ticketToken('DEV-925')).toBe('ticket=DEV-925');
    for (const bad of ['DEV 925', 'DEV-925=x', "DEV-9'", 'DEV-925\n', 'dev-925', '']) {
      expect(ticketToken(bad)).toBeUndefined();
    }
  });
});

describe('the display command typed into a shell', () => {
  it('joins plain arguments with spaces', () => {
    expect(displayLine(['claude', 'attach', '6d5ea8bb'])).toBe('claude attach 6d5ea8bb');
    expect(displayLine(['/usr/local/bin/codex', 'resume', 'th_1', '--remote', 'unix:///tmp/a.sock']))
      .toBe('/usr/local/bin/codex resume th_1 --remote unix:///tmp/a.sock');
  });

  it.each([
    ['an empty command', []],
    ['an empty argument', ['claude', '']],
    ['a space', ['claude', 'attach', 'a b']],
    ['a quote', ['claude', "attach'"]],
    ['a command separator', ['claude', 'attach;rm']],
    ['a substitution', ['claude', '$(id)']],
    ['a newline', ['claude', 'attach\n']],
    ['a glob', ['claude', '*']],
    ['a zsh equals expansion', ['=claude', 'attach']],
    ['a tilde expansion', ['claude', '~root']],
    ['a leading option as the command', ['-claude', 'attach']],
    ['a job reference as the command', ['%1']],
  ] as const)('refuses %s rather than quoting it', (_case, argv) => {
    expect(displayLine(argv)).toBeUndefined();
  });
});

describe('placing a new surface', () => {
  it('stacks beside the caller first, then below the last delegated surface', () => {
    expect(stackPlacement('caller', [])).toEqual({ target: 'caller', direction: 'right' });
    expect(stackPlacement('caller', ['a', 'b'])).toEqual({ target: 'b', direction: 'down' });
  });

  it('fills a crew tab as a grid of four, then opens a new tab', () => {
    expect(tabPlacement([])).toEqual({ kind: 'new-tab' });
    expect(tabPlacement([{ tab: 't1', panes: ['p1'] }])).toEqual({ kind: 'split', target: 'p1', direction: 'right' });
    expect(tabPlacement([{ tab: 't1', panes: ['p1', 'p2'] }])).toEqual({ kind: 'split', target: 'p1', direction: 'down' });
    expect(tabPlacement([{ tab: 't1', panes: ['p1', 'p2', 'p3'] }]))
      .toEqual({ kind: 'split', target: 'p2', direction: 'down' });
    expect(tabPlacement([{ tab: 't1', panes: ['p1', 'p2', 'p3', 'p4'] }])).toEqual({ kind: 'new-tab' });
    expect(tabPlacement([{ tab: 't1', panes: ['p1', 'p2', 'p3', 'p4'] }, { tab: 't2', panes: ['p5'] }]))
      .toEqual({ kind: 'split', target: 'p5', direction: 'right' });
  });

  it('opens a new tab for a tab emptied of panes', () => {
    expect(tabPlacement([{ tab: 't1', panes: [] }])).toEqual({ kind: 'new-tab' });
  });
});

describe('describing a presentation failure', () => {
  it('keeps a bounded, printable excerpt of what the multiplexer said', () => {
    const cause = surfaceCause('exit-nonzero', 'pane split', `boom\u001b[31m\n${'x'.repeat(2_000)}`);
    expect(cause.code).toBe('exit-nonzero');
    expect(cause.step).toBe('pane split');
    expect(cause.detail?.length).toBeLessThanOrEqual(400);
    expect(cause.detail).not.toMatch(/[\u0000-\u001f\u007f]/);
  });

  it('omits an empty excerpt', () => {
    expect(surfaceCause('timeout', 'tree')).toEqual({ code: 'timeout', step: 'tree' });
  });
});
