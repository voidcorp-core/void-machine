import { describe, expect, it } from 'vitest';
import { composeResumeBundle, renderResumeContext } from './resume-bundle.js';

describe('ResumeBundle public boundary', () => {
  it('exposes the shared runtime-neutral composition', () => {
    const bundle = composeResumeBundle({
      project: { name: 'alpha', path: '/alpha' },
      now: 0,
      git: { branch: 'main', head: 'abc', dirtyFiles: 0 },
      program: {
        status: 'executing',
        program: 'shared',
        plan: 'docs/plan.md',
        spec: 'docs/spec.md',
      },
      checkpoint: undefined,
    });

    expect(renderResumeContext(bundle)).toContain('Program: shared');
  });
});
