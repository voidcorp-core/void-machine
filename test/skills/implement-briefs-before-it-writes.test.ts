/**
 * The skill described an order the controller refuses.
 *
 * `void-implement` says, in its "Canonical team orchestration" section, to take
 * every next action from the pure controller. That controller returns
 * `invoke-specialists` at `stage: 'pre-implementation'` as its FIRST action in
 * `team` mode -- probed live on 2026-08-30, mission `mis_c8fafb06`. Its numbered
 * cycle then put TDD at pass 5 and Review at pass 10, so a reader following the
 * prose wrote code first and convened the panel afterwards.
 *
 * Both statements were in the same file and nothing noticed, because prose has
 * no compiler. This is the closest thing it gets: the pass that convenes the
 * panel must be numbered before the pass that writes, and the stage name the
 * controller returns is read from the controller's own module rather than
 * retyped here -- a token this test spelled itself would survive the controller
 * renaming it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SKILL = readFileSync(
  new URL('../../packages/core/skills/void-implement/SKILL.md', import.meta.url),
  'utf8',
);
const CONTROLLER = readFileSync(
  new URL('../../packages/mission-engine/src/orchestration/controller.ts', import.meta.url),
  'utf8',
);

/** One entry per numbered pass, in the order the skill lists them. */
const PASSES = SKILL.split('\n')
  .filter((line) => /^\d+\. \*\*/.test(line))
  .map((line) => ({
    number: Number(line.slice(0, line.indexOf('.'))),
    title: line.slice(line.indexOf('**') + 2, line.indexOf('**', line.indexOf('**') + 2)),
    body: line,
  }));

function passMatching(pattern: RegExp): (typeof PASSES)[number] | undefined {
  return PASSES.find((pass) => pattern.test(pass.body));
}

describe('the implement cycle briefs before it writes', () => {
  it('numbers its passes without a gap, so "before" is a fact and not a reading', () => {
    expect(PASSES.map((pass) => pass.number))
      .toEqual(PASSES.map((_pass, index) => index + 1));
  });

  it('convenes the panel in a numbered pass, not only in the orchestration preamble', () => {
    expect(passMatching(/invoke-specialists|convene/i)).toBeDefined();
  });

  it('puts that pass before the one that writes production code', () => {
    const convene = passMatching(/invoke-specialists|convene/i);
    const write = passMatching(/TDD implementation/);

    expect(convene?.number).toBeDefined();
    expect(write?.number).toBeDefined();
    expect(convene?.number ?? Number.POSITIVE_INFINITY)
      .toBeLessThan(write?.number ?? Number.NEGATIVE_INFINITY);
  });

  it('names the stage the controller actually returns first', () => {
    // Read from the controller rather than spelled here: a token this test wrote
    // itself would outlive the controller renaming the stage.
    expect(CONTROLLER).toContain("'pre-implementation'");
    expect(SKILL).toContain('pre-implementation');
  });

  it('hands the specialist the pack rather than describing one in the abstract', () => {
    // `contextPack` is the envelope field a skill can actually pass. Before the
    // pack existed the prose promised "bounded context pack" and nothing carried
    // one, which is the promise-without-a-mechanism this repository keeps paying for.
    expect(SKILL).toContain('contextPack');
  });

  it('launches each envelope through the delegation kernel, from the envelope alone', () => {
    const convene = passMatching(/invoke-specialists|convene/i)?.body ?? '';
    expect(convene).toMatch(/agents dispatch --role review/);
    // Runtime, type and mission are copied, never chosen: the skill keeps no agent list.
    for (const field of ['agentName', 'runtime', 'missionId']) expect(convene).toContain(field);
  });

  it('never replaces a refused dispatch with a native subagent, nor a full mission with a subset', () => {
    const convene = passMatching(/invoke-specialists|convene/i)?.body ?? '';
    expect(convene).toMatch(/refus[^.]*never[^.]*native subagent/i);
    expect(convene).toMatch(/at most four/i);
  });
});

// The three rules below follow the kernel and the controller as they are, so
// each reads the fact it depends on from the module that owns it.
const DISPATCH = readFileSync(
  new URL('../../packages/mission-engine/src/orchestration/dispatch.ts', import.meta.url), 'utf8');
const DELEGATION = readFileSync(
  new URL('../../packages/void-machine/src/core/delegation.ts', import.meta.url), 'utf8');
const KERNEL = readFileSync(
  new URL('../../packages/void-machine/src/application/agents.ts', import.meta.url), 'utf8');

describe('a kernel run carries the whole envelope contract and follows the run, not the wait', () => {
  const convene = () => (passMatching(/invoke-specialists|convene/i)?.body ?? '').replace(/\s+/g, ' ');

  it('hands a reviewer its subject and scope, which travel beside the pack', () => {
    // Envelope fields outside `contextPack`: a reviewer that never sees them
    // cannot echo the receipt `specialist-event` requires.
    expect(DISPATCH).toMatch(/reviewSubject: input\.reviewSubject[\s\S]*contextPack: compileContextPack/);
    expect(convene()).toMatch(/reviewSubject/);
    expect(convene()).toMatch(/reviewScope/);
    expect(convene()).not.toMatch(/pack is the whole brief/i);
  });

  it('accepts only a run whose turn ended, and never fails a specialist on a wait that timed out', () => {
    // `accept` refuses every state but `turn-ended`; `timed-out` ends an observation, not a run.
    expect(DELEGATION).toMatch(/export function acceptRun\([^{]*\{\s*if \(view\.state !== 'turn-ended'\)/);
    expect(convene()).toMatch(/agents status/);
    expect(convene()).toMatch(/accept[^.]*only[^.]*turn-ended|only[^.]*turn-ended[^.]*accept/i);
    expect(convene()).toMatch(/tim(e|ed)[ -]?out[^.]*never[^.]*failed|never[^.]*failed[^.]*tim(e|ed)[ -]?out/i);
  });

  it('resumes the run an envelope already has before it ever dispatches another', () => {
    // The kernel stores the run and its brief before the runtime launches, so a
    // crash after the acknowledgement still leaves the run to find.
    expect(KERNEL).toMatch(/store\.create\(run[\s\S]*port\.dispatch\(/);
    expect(convene()).toMatch(/before[^.]*dispatch[^.]*(started|existing run|its run)/i);
    expect(convene()).toMatch(/brief/);
    expect(convene()).toMatch(/(uncertain|cannot be matched|unmatched)[^.]*(no|never)[^.]*(launch|dispatch)/i);
  });

  it('records a result already accepted from the run that holds it, without accepting it again', () => {
    // An interruption between `accept` and `completed` leaves a closed run: a
    // second accept is refused, yet its status still returns the collected result.
    expect(DELEGATION).toMatch(/CLOSED[^\n]*'accepted', 'retired'/);
    expect(KERNEL).toMatch(/async function summary[\s\S]*?currentResult\(run, await context\.store\.result\(run\.runId\)\)/);
    expect(convene()).toMatch(/(accepted|retired)[^.]*agents status[^.]*result/i);
    expect(convene()).toMatch(/never[^.]*accept[^.]*again|accept[^.]*never[^.]*twice/i);
    expect(convene()).toMatch(/\b(no|without)\b[^.]*(collected|whole)[^.]*result[^.]*(stop|report)/i);
  });
});

describe('no shipped skill decides how an agent is launched from what displays it', () => {
  const root = new URL('../../packages/core/skills/', import.meta.url);
  const skills = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => [entry.name, readFileSync(new URL(`${entry.name}/SKILL.md`, root), 'utf8')] as const);

  it.each(skills)('%s', (_name, text) => {
    const flat = text.replace(/\s+/g, ' ');
    expect(flat).not.toMatch(/mission-presentation|cockpit presentation|workers are native subagents/i);
    // A multiplexer may be named as a view; it is never the condition of a launch path.
    expect(flat).not.toMatch(/\b(if|when|without|unless)\b[^.]{0,80}\b(multiplexer|herdr|tmux|cmux)\b/i);
  });
});
