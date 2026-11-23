import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeSpecialists } from '@voidcorp/mission-engine';
import { describe, expect, it } from 'vitest';
import { compileClaudeSpecialist } from './compile-claude.js';
import { parseSpecialistYaml } from './load.js';
import { parseSpecialistCompletion } from './schema.js';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(DIRECTORY, '../../../../core/specialists/visual-craft-director.yaml');
const BASELINE = resolve(DIRECTORY, '__fixtures__/visual-applicability/visual-craft-director-v2.yaml');
const current = parseSpecialistYaml(readFileSync(SOURCE, 'utf8'), SOURCE);
const previous = parseSpecialistYaml(readFileSync(BASELINE, 'utf8'), BASELINE);

// These are mechanical contract guards. Native fixture replay, recorded separately,
// establishes whether the specialist actually follows the applicability instructions.
describe('visual applicability contract isolation', () => {
  it('versions the changed evidence obligation without rewriting the prior contract', () => {
    expect(previous.version).toBe(2);
    expect(current.version).toBe(4);
    expect(current.stages).toEqual(['post-implementation']);
    expect(current.appliesWhen).toEqual(previous.appliesWhen);
  });

  it.each(['ux-ui', 'frontend-change', 'profile-react', 'profile-expo'])(
    'retains conservative scope assessment selected by %s',
    (signal) => {
      const decisions = routeSpecialists([current], {
        signals: new Set([signal]),
        profiles: [],
        contextStatus: 'complete',
        inputHash: `sha256:${'a'.repeat(64)}`,
      });
      expect(decisions[0]).toMatchObject({
        specialistId: 'core:visual-craft-director',
        state: 'applicable',
        stages: ['post-implementation'],
      });
    },
  );

  it('ships the current contract through the versioned native agent projection', () => {
    const agent = resolve(DIRECTORY, '../../../../core/agents/visual-craft-director.md');
    expect(readFileSync(agent, 'utf8')).toBe(compileClaudeSpecialist(current).content);
  });

  it('keeps a v4 applicability completion out of a frozen v2 contract', () => {
    const completion = JSON.stringify({
      schemaVersion: 1,
      specialistId: 'core:visual-craft-director',
      contractVersion: 4,
      completionId: 'visual_scope_regression',
      verdict: 'pass',
      findings: [],
      evidenceRequests: [],
      limitations: [
        'Rendered-UI review not applicable: inspected docs/motion.md; only prose changed. '
          + 'This completes scope assessment and does not certify visual craft.',
      ],
    });

    expect(() => parseSpecialistCompletion(completion, previous, [])).toThrow(/version/i);
    expect(parseSpecialistCompletion(completion, current, [])).toMatchObject({
      verdict: 'pass',
      contractVersion: 4,
      limitations: [expect.stringContaining('not applicable')],
    });
  });
});
