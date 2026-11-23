import { describe, expect, it } from 'vitest';
import {
  assessUiQuality,
  type UiQualityInput,
} from './quality-gate.js';

const INPUT_HASH = `sha256:${'a'.repeat(64)}`;
const DIFF_HASH = `sha256:${'b'.repeat(64)}`;
const STALE_HASH = `sha256:${'c'.repeat(64)}`;

function validInput(overrides: Partial<UiQualityInput> = {}): UiQualityInput {
  return {
    schemaVersion: 1,
    applicable: true,
    currentInputHash: INPUT_HASH,
    currentDiffHash: DIFF_HASH,
    interactive: true,
    requiredStates: ['default', 'error'],
    requiredTestKinds: ['component', 'accessibility', 'keyboard', 'ui-state'],
    browser: { available: true },
    prebuild: {
      specialistId: 'core:experience-designer',
      contextId: 'ctx_experience_001',
      inputHash: INPUT_HASH,
      verdict: 'pass',
    },
    postbuild: {
      specialistId: 'core:visual-craft-director',
      contextId: 'ctx_visual_001',
      diffHash: DIFF_HASH,
      verdict: 'pass',
      scores: {
        hierarchy: 9,
        'information-architecture': 8,
        'interaction-states': 9,
        'responsive-intent': 8,
        distinctiveness: 8,
        accessibility: 9,
      },
    },
    screenshots: [
      { path: 'artifacts/default-mobile.png', viewport: 'mobile', state: 'default', diffHash: DIFF_HASH },
      { path: 'artifacts/default-desktop.png', viewport: 'desktop', state: 'default', diffHash: DIFF_HASH },
      { path: 'artifacts/error-mobile.png', viewport: 'mobile', state: 'error', diffHash: DIFF_HASH },
      { path: 'artifacts/error-desktop.png', viewport: 'desktop', state: 'error', diffHash: DIFF_HASH },
    ],
    tests: [
      { kind: 'component', path: 'src/Menu.test.tsx', status: 'passed', diffHash: DIFF_HASH },
      { kind: 'accessibility', path: 'src/Menu.test.tsx', status: 'passed', diffHash: DIFF_HASH },
      { kind: 'keyboard', path: 'src/Menu.test.tsx', status: 'passed', diffHash: DIFF_HASH },
      { kind: 'ui-state', path: 'src/Menu.test.tsx', status: 'passed', diffHash: DIFF_HASH },
    ],
    ...overrides,
  };
}

describe('UI quality gate', () => {
  it('passes only with two fresh specialist passes and deterministic current-diff proof', () => {
    expect(assessUiQuality(validInput())).toEqual({
      status: 'passed',
      reasons: [],
      staleScreenshots: [],
      missingScreenshotCoverage: [],
      missingTestKinds: [],
    });
  });

  it('blocks implementation until the experience designer has completed the current input', () => {
    const missing = assessUiQuality(validInput({ prebuild: undefined }));
    const stale = assessUiQuality(validInput({
      prebuild: {
        specialistId: 'core:experience-designer',
        contextId: 'ctx_experience_001',
        inputHash: STALE_HASH,
        verdict: 'pass',
      },
    }));

    expect(missing.reasons).toContain('prebuild-missing');
    expect(stale.reasons).toContain('prebuild-stale');
  });

  it('requires a fresh-context craft verdict regardless of optional legacy ratings', () => {
    const original = validInput().postbuild;
    if (!original?.scores) throw new Error('Expected legacy rating fixture.');
    const reused = assessUiQuality(validInput({
      postbuild: {
        ...original,
        contextId: 'ctx_experience_001',
      },
    }));
    const weak = assessUiQuality(validInput({
      postbuild: {
        ...original,
        scores: { ...original.scores, distinctiveness: 7 },
      },
    }));

    expect(reused.reasons).toContain('specialist-context-reused');
    expect(weak.status).toBe('passed');
    const blocked = assessUiQuality(validInput({
      postbuild: { ...original, verdict: 'changes-requested' },
    }));
    expect(blocked.reasons).toContain('postbuild-not-passed');
  });

  it('accepts a current independent verdict without a subjective rating', () => {
    const input = validInput();
    if (!input.postbuild) throw new Error('Expected independent verdict fixture.');
    const { scores: _legacyScores, ...postbuild } = input.postbuild;
    expect(assessUiQuality({ ...input, postbuild }).status).toBe('passed');
  });

  it('blocks missing browser proof and mobile/desktop coverage for every applicable state', () => {
    const noBrowser = assessUiQuality(validInput({ browser: { available: false } }));
    const partial = assessUiQuality(validInput({
      screenshots: validInput().screenshots.filter((shot) =>
        !(shot.viewport === 'mobile' && shot.state === 'error')
      ),
    }));

    expect(noBrowser.reasons).toContain('browser-unavailable');
    expect(partial.reasons).toContain('screenshot-coverage-missing');
    expect(partial.missingScreenshotCoverage).toEqual(['error:mobile']);
  });

  it('invalidates screenshots and tests when the current diff changes', () => {
    const result = assessUiQuality(validInput({
      screenshots: validInput().screenshots.map((shot) => ({ ...shot, diffHash: STALE_HASH })),
      tests: validInput().tests.map((test) => ({ ...test, diffHash: STALE_HASH })),
    }));

    expect(result.reasons).toEqual(expect.arrayContaining([
      'screenshot-stale',
      'test-evidence-stale',
    ]));
    expect(result.staleScreenshots).toHaveLength(4);
  });

  it('rejects LLM-only visual approval and catches an interactive keyboard gap before E2E', () => {
    const result = assessUiQuality(validInput({
      tests: validInput().tests.filter((test) => test.kind !== 'keyboard'),
    }));

    expect(result.status).toBe('blocked');
    expect(result.reasons).toContain('keyboard-proof-missing');
    expect(result.missingTestKinds).toEqual(['keyboard']);

    const modelOnly = assessUiQuality(validInput({
      interactive: false,
      requiredStates: [],
      requiredTestKinds: [],
      screenshots: [],
      tests: [],
    }));
    expect(modelOnly.reasons).toEqual(expect.arrayContaining([
      'screenshot-coverage-missing',
      'test-evidence-missing',
    ]));
  });

  it('does not demand UI evidence when the pass is not applicable', () => {
    expect(assessUiQuality(validInput({
      applicable: false,
      browser: { available: false },
      prebuild: undefined,
      postbuild: undefined,
      screenshots: [],
      tests: [],
    }))).toEqual({
      status: 'not-applicable',
      reasons: [],
      staleScreenshots: [],
      missingScreenshotCoverage: [],
      missingTestKinds: [],
    });
  });
});
