import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSkill(name: string): string {
  const path = new URL(`../../packages/core/skills/${name}/SKILL.md`, import.meta.url);
  return existsSync(path) ? readFileSync(path, 'utf8').replace(/\s+/g, ' ').toLowerCase() : '';
}

const motion = readSkill('void-interface-motion');
const frontend = readSkill('void-frontend-design');

describe('contextual interface motion contract', () => {
  it('classifies the interaction by its outcome, including a form within a landing', () => {
    expect(motion).toMatch(/per interaction|each interaction/);
    expect(motion).toMatch(/functional.{0,180}(feedback|state change)/);
    expect(motion).toMatch(/expressive.{0,220}(narrative|story)/);
    expect(motion).toMatch(/(landing.{0,180}form|form.{0,180}landing).{0,180}functional/);
    expect(motion).toMatch(/no motion/);
  });

  it('keeps reduced motion informative and content available without playback', () => {
    expect(motion).toMatch(/both.{0,80}(context|mode)/);
    expect(motion).toContain('prefers-reduced-motion');
    expect(motion).toMatch(/(preserv|retain).{0,100}(information|meaning)/);
    expect(motion).toMatch(/(static|instant).{0,100}(narrative|order|sequence)/);
    expect(motion).toMatch(/(visible|available).{0,100}without animation/);
    expect(frontend).toMatch(/already.visible default/);
    expect(frontend).toMatch(/never gate content visibility/);
  });

  it('keeps non-compositable properties out of hot animation paths', () => {
    expect(motion).toMatch(/(never|no|forbid).{0,100}non.composit.{0,100}hot/);
    expect(motion).toContain('transform');
    expect(motion).toContain('opacity');
    expect(motion).toMatch(/(measure|profil|trace)/);
  });

  it('requires pause controls under all three WCAG automatic movement conditions', () => {
    expect(motion).toContain('2.2.2');
    expect(motion).toMatch(/automatic.{0,180}(more than five|>\s*5).{0,120}(alongside|parallel)/);
    expect(motion).toMatch(/pause.{0,25}stop.{0,25}hide/);
    expect(motion).toMatch(/unless.{0,60}essential/);
    expect(motion).toMatch(/reduced.motion.{0,100}(not replace|not a substitute)/);
  });

  it('states the flash frequency and general/red thresholds independently of pausing', () => {
    expect(motion).toContain('2.3.1');
    expect(motion).toMatch(/three.{0,60}(one.second|1.second)/);
    expect(motion).toMatch(/general.{0,40}red.{0,40}threshold/);
    expect(motion).toMatch(/(pause|stop).{0,80}(unsafe|unsafe.{0,20}flash)/);
  });

  it('delegates detailed motion procedure without retaining an absolute duration ban', () => {
    expect(frontend).toContain('void-interface-motion');
    expect(frontend).toMatch(/functional.{0,100}<\s*250\s*ms/);
    expect(frontend).toContain('expressive');
    expect(frontend).not.toMatch(/motion communicates state change[.,] not entertainment/);
    expect(frontend).not.toContain('keep only state-change communication');
    expect(frontend).not.toContain('decorative animations longer than 250ms');
    expect(frontend).not.toContain('animations longer than 250ms unless documented');
    expect(frontend).not.toContain('looping decorative animations');
    const durationAssertions = frontend.match(/[^.!?]*250\s*ms[^.!?]*/g) ?? [];
    expect(durationAssertions.length).toBeGreaterThan(0);
    for (const assertion of durationAssertions) expect(assertion).toContain('functional');
    expect(frontend).not.toMatch(/first,? last,? invert,? play/);
  });

  it('teaches orchestration and continuity without a library or video pipeline mandate', () => {
    expect(motion).toMatch(/timeline|orchestrat/);
    expect(motion).toContain('easing');
    expect(motion).toContain('flip');
    expect(motion).toMatch(/temporal hierarchy/);
    expect(motion).not.toMatch(/gsap|greensock|hyperframes|remotion/);
  });
});
