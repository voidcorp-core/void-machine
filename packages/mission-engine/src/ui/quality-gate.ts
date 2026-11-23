export const UI_DESIGN_DIMENSIONS = Object.freeze([
  'hierarchy',
  'information-architecture',
  'interaction-states',
  'responsive-intent',
  'distinctiveness',
  'accessibility',
] as const);

export type UiDesignDimension = typeof UI_DESIGN_DIMENSIONS[number];
export type UiTestKind =
  | 'component'
  | 'hook'
  | 'store'
  | 'accessibility'
  | 'keyboard'
  | 'ui-state';

export interface UiSpecialistAttestation {
  readonly specialistId:
    | 'core:experience-designer'
    | 'core:visual-craft-director';
  readonly contextId: string;
  readonly verdict: 'pass' | 'changes-requested' | 'blocked' | 'degraded';
}

export interface UiPrebuildAttestation extends UiSpecialistAttestation {
  readonly specialistId: 'core:experience-designer';
  readonly inputHash: string;
}

export interface UiPostbuildAttestation extends UiSpecialistAttestation {
  readonly specialistId: 'core:visual-craft-director';
  readonly diffHash: string;
  /** Legacy input accepted for compatibility; ratings do not establish quality. */
  readonly scores?: Readonly<Record<UiDesignDimension, number>>;
}

export interface UiScreenshotEvidence {
  readonly path: string;
  readonly viewport: 'mobile' | 'desktop';
  readonly state: string;
  readonly diffHash: string;
}

export interface UiTestEvidence {
  readonly kind: UiTestKind;
  readonly path: string;
  readonly status: 'passed' | 'failed';
  readonly diffHash: string;
}

export interface UiQualityInput {
  readonly schemaVersion: 1;
  readonly applicable: boolean;
  readonly currentInputHash: string;
  readonly currentDiffHash: string;
  readonly interactive: boolean;
  readonly requiredStates: readonly string[];
  readonly requiredTestKinds: readonly UiTestKind[];
  readonly browser: { readonly available: boolean };
  readonly prebuild: UiPrebuildAttestation | undefined;
  readonly postbuild: UiPostbuildAttestation | undefined;
  readonly screenshots: readonly UiScreenshotEvidence[];
  readonly tests: readonly UiTestEvidence[];
}

export type UiQualityReason =
  | 'prebuild-missing'
  | 'prebuild-stale'
  | 'prebuild-not-passed'
  | 'postbuild-missing'
  | 'postbuild-stale'
  | 'postbuild-not-passed'
  | 'specialist-context-reused'
  | 'browser-unavailable'
  | 'screenshot-coverage-missing'
  | 'screenshot-stale'
  | 'test-evidence-missing'
  | 'test-evidence-stale'
  | 'keyboard-proof-missing';

export interface UiQualityAssessment {
  readonly status: 'not-applicable' | 'passed' | 'blocked';
  readonly reasons: readonly UiQualityReason[];
  readonly staleScreenshots: readonly string[];
  readonly missingScreenshotCoverage: readonly string[];
  readonly missingTestKinds: readonly UiTestKind[];
}

const VIEWPORTS = Object.freeze(['mobile', 'desktop'] as const);
const TEST_KIND_ORDER = Object.freeze([
  'component',
  'hook',
  'store',
  'accessibility',
  'keyboard',
  'ui-state',
] as const);

function emptyAssessment(status: 'not-applicable' | 'passed'): UiQualityAssessment {
  return Object.freeze({
    status,
    reasons: Object.freeze([]),
    staleScreenshots: Object.freeze([]),
    missingScreenshotCoverage: Object.freeze([]),
    missingTestKinds: Object.freeze([]),
  });
}

function screenshotCoverage(
  input: UiQualityInput,
  fresh: readonly UiScreenshotEvidence[],
): readonly string[] {
  const covered = new Set(fresh.map((shot) => `${shot.state}:${shot.viewport}`));
  const missing: string[] = [];
  for (const state of [...new Set(['default', ...input.requiredStates])].sort()) {
    for (const viewport of VIEWPORTS) {
      const key = `${state}:${viewport}`;
      if (!covered.has(key)) missing.push(key);
    }
  }
  return Object.freeze(missing);
}

function requiredTestKinds(input: UiQualityInput): readonly UiTestKind[] {
  const required = new Set(input.requiredTestKinds);
  if (input.interactive) required.add('keyboard');
  return Object.freeze(TEST_KIND_ORDER.filter((kind) => required.has(kind)));
}

export function assessUiQuality(input: UiQualityInput): UiQualityAssessment {
  if (!input.applicable) return emptyAssessment('not-applicable');

  const reasons: UiQualityReason[] = [];
  if (input.prebuild === undefined) reasons.push('prebuild-missing');
  else {
    if (input.prebuild.inputHash !== input.currentInputHash) reasons.push('prebuild-stale');
    if (input.prebuild.verdict !== 'pass') reasons.push('prebuild-not-passed');
  }

  if (input.postbuild === undefined) reasons.push('postbuild-missing');
  else {
    if (input.postbuild.diffHash !== input.currentDiffHash) reasons.push('postbuild-stale');
    if (input.postbuild.verdict !== 'pass') reasons.push('postbuild-not-passed');
  }
  if (
    input.prebuild !== undefined
    && input.postbuild !== undefined
    && input.prebuild.contextId === input.postbuild.contextId
  ) {
    reasons.push('specialist-context-reused');
  }
  if (!input.browser.available) reasons.push('browser-unavailable');

  const staleScreenshots = Object.freeze(input.screenshots
    .filter((shot) => shot.diffHash !== input.currentDiffHash)
    .map((shot) => shot.path)
    .sort());
  if (staleScreenshots.length > 0) reasons.push('screenshot-stale');
  const freshScreenshots = input.screenshots.filter((shot) =>
    shot.diffHash === input.currentDiffHash
  );
  const missingScreenshotCoverage = screenshotCoverage(input, freshScreenshots);
  if (missingScreenshotCoverage.length > 0) reasons.push('screenshot-coverage-missing');

  const staleTests = input.tests.filter((test) => test.diffHash !== input.currentDiffHash);
  if (staleTests.length > 0) reasons.push('test-evidence-stale');
  const passedKinds = new Set(input.tests
    .filter((test) => test.diffHash === input.currentDiffHash && test.status === 'passed')
    .map((test) => test.kind));
  const missingTestKinds = Object.freeze(requiredTestKinds(input)
    .filter((kind) => !passedKinds.has(kind)));
  if (passedKinds.size === 0 || missingTestKinds.length > 0) {
    reasons.push('test-evidence-missing');
  }
  if (missingTestKinds.includes('keyboard')) reasons.push('keyboard-proof-missing');

  const uniqueReasons = Object.freeze([...new Set(reasons)]);
  if (uniqueReasons.length === 0) return emptyAssessment('passed');
  return Object.freeze({
    status: 'blocked',
    reasons: uniqueReasons,
    staleScreenshots,
    missingScreenshotCoverage,
    missingTestKinds,
  });
}
