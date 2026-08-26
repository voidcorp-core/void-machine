// The help text is the CLI's front door. The audit (issue #69) found it named
// the core plugin `void` (real: `harness`) and listed 2 of 6 packs. These
// invariants keep it honest against the single source of truth in packs.ts.

import { describe, expect, it, vi } from 'vitest';
import { printHelp } from './help.js';
import { CORE_PLUGIN_NAME, PACKS } from '../lib/packs.js';

function capture(): string {
  let out = '';
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  printHelp();
  spy.mockRestore();
  return out;
}

describe('printHelp', () => {
  it('names the core plugin harness, never the stale `void`', () => {
    const out = capture();
    expect(out).toContain(CORE_PLUGIN_NAME);
    // The core row must not be labelled `void ` (the pre-#69 bug).
    expect(out).not.toMatch(/^\s*void\s+core/m);
  });

  it('lists every real pack from packs.ts', () => {
    const out = capture();
    for (const pack of PACKS) {
      expect(out).toContain(pack.name);
    }
  });

  it('leads with the public account-free npx install (supersedes marketplace-only, 2026-07-21)', () => {
    // Distribution is now public MIT, npx-primary; the CLI is the consumer entry point.
    expect(capture()).toContain('npx voidharness init');
  });

  it('points at the self-hosted marketplace repo as the optional secondary channel', () => {
    expect(capture()).toContain('voidcorp-core/void-harness');
  });

  it('exposes conflict-free decision authoring', () => {
    expect(capture()).toContain('decisions <sub>');
  });

  it('exposes the local mission evidence lifecycle', () => {
    expect(capture()).toContain('mission <sub>');
  });

  it('exposes isolated source dogfooding', () => {
    expect(capture()).toContain('self-host <sync|doctor>');
  });

  it('exposes autopilot, and only under its canonical name', () => {
    const out = capture();
    expect(out).toContain('autopilot [sub]');
    // The retired name is a signpost reachable by typing it, not an entry in
    // the reference — listing it would advertise a command that always fails.
    expect(out).not.toContain('backlog-autopilot');
  });

  it('says autopilot resumes on its own, because that is what makes it usable', () => {
    expect(capture()).toContain('.void/program.md');
  });
});
