import { describe, expect, it } from 'vitest';
import { composeResumeBundle, renderResumeContext } from './resume-bundle.js';

describe('ResumeBundle public boundary', () => {
  it('exposes the shared runtime-neutral composition', () => {
    const bundle = composeResumeBundle({
      project: { name: 'alpha', path: '/alpha' },
      now: 0,
      git: { branch: 'main', head: 'abc', dirtyFiles: 0 },
      checkpoint: undefined,
    });

    expect(bundle.schemaVersion).toBe(2);
    expect(renderResumeContext(bundle)).toBe('');
  });
});
