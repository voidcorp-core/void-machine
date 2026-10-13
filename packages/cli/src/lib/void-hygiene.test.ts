import { describe, expect, it } from 'vitest';
import { PRODUCT_IDENTITY } from '@voidcorp/hook-runner';
import type { CheckResult } from './prerequisites.js';
import { judgeLayout, judgeProjectSkills, type LayoutObservation } from './void-hygiene.js';

function observation(over: Partial<LayoutObservation> = {}): LayoutObservation {
  return {
    pending: [],
    localIgnored: true,
    trackedObserved: [],
    trackedDerivedCount: 0,
    observedPaths: [],
    orphanedAssets: [],
    manifest: { kind: 'present', version: '2.5.1', drifted: 0 },
    receipt: { kind: 'present', version: '2.5.1', missing: [], missingTotal: 0 },
    keptTracked: [],
    ...over,
  };
}

function named(results: readonly CheckResult[], name: string): CheckResult | undefined {
  return results.find((result) => result.name === name);
}

describe('judgeLayout', () => {
  it('passes a project that keeps observed state out of its history', () => {
    expect(judgeLayout(observation()).every((check) => check.ok)).toBe(true);
  });

  it('reports state left at the old location, and points at the command that moves it', () => {
    const check = named(judgeLayout(observation({ pending: ['runs', 'activations.jsonl'] })), 'void layout');

    expect(check?.status).toBe('fail');
    expect(check?.message).toContain('runs');
    expect(check?.fix).toContain('void-machine update');
  });

  it('does not confuse "no git" with "not ignored"', () => {
    // One is a project shipping telemetry; the other is a directory nobody
    // versions. Collapsing them either cries wolf or hides a real leak.
    const absent = named(judgeLayout(observation({ localIgnored: null })), 'void ignore');
    const notIgnored = named(judgeLayout(observation({ localIgnored: false })), 'void ignore');

    expect(absent?.status).toBe('unknown');
    expect(notIgnored?.status).toBe('fail');
  });

  it('treats an already-tracked observed path as its own failure', () => {
    // git ignores nothing it already tracks, so writing the block does not fix
    // this one — the fix has to be an explicit untrack.
    const check = named(judgeLayout(observation({ trackedObserved: ['.void/usage.log'] })), 'void tracked');

    expect(check?.status).toBe('fail');
    expect(check?.fix).toContain('git rm --cached');
    expect(check?.fix).toContain('.void/usage.log');
  });

  it('reports drift against the manifest as a failure, with the pinned command', () => {
    // The working tree claims a version it does not hold. That is not advisory.
    const check = named(
      judgeLayout(observation({ manifest: { kind: 'present', version: '2.5.1', drifted: 3 } })),
      'void manifest',
    );

    expect(check?.status).toBe('fail');
    expect(check?.message).toContain('3 file(s)');
    expect(check?.fix).toBe(`npx ${PRODUCT_IDENTITY.packageFor('2.5.1')}@2.5.1 hydrate — it restores and proves every file`);
  });

  // A count sends the reader to rehash eighty files by hand to find the one that
  // moved. The verification already knows which; the observation was throwing
  // the names away.
  it('names the files that differ, not just how many', () => {
    const check = named(
      judgeLayout(
        observation({
          manifest: {
            kind: 'present',
            version: '3.6.0',
            drifted: 2,
            driftedPaths: ['.claude/skills/void-tdd/SKILL.md', '.void/hooks/_void-hook.mjs'],
          },
        }),
      ),
      'void manifest',
    );

    expect(check?.message).toContain('.claude/skills/void-tdd/SKILL.md');
    expect(check?.message).toContain('.void/hooks/_void-hook.mjs');
  });

  // The mirror of `void ignore`: the block declares these tracked, and a project
  // rule higher in the file can win over it with nothing to show for it.
  it('reports a declared-tracked path that git hides, naming the rule', () => {
    const check = named(
      judgeLayout(
        observation({
          keptTracked: [
            { path: '.void/config.json', present: true, ignored: true, rule: '.gitignore:1:.void/*' },
          ],
        }),
      ),
      'void kept',
    );

    expect(check?.status).toBe('fail');
    expect(check?.message).toContain('.void/config.json');
    expect(check?.message).toContain('.gitignore:1:.void/*');
  });

  // `.void/PROJECT-DOCTRINE.md` is created once from a template and the project
  // is told to edit it freely. Counting that as drift failed `doctor` on the
  // intended use of the file, and named `hydrate` as the remedy -- which restores
  // nothing there, it re-stamps the hash over what the project wrote. A red
  // verdict nobody can extinguish is a red verdict everybody learns to skip past.
  it('passes when the only difference is a co-owned file the project wrote into', () => {
    const check = named(
      judgeLayout(observation({ manifest: { kind: 'present', version: '3.3.0', drifted: 0, coEdited: 2 } })),
      'void manifest',
    );

    expect(check?.status).toBe('pass');
    expect(check?.message).toContain('2 co-owned');
    expect(check?.fix).toBeUndefined();
  });

  it('still fails on real drift even when a co-owned file was also edited', () => {
    const check = named(
      judgeLayout(observation({ manifest: { kind: 'present', version: '3.3.0', drifted: 1, coEdited: 2 } })),
      'void manifest',
    );

    expect(check?.status).toBe('fail');
    expect(check?.message).toContain('1 file(s)');
  });

  it('treats an absent manifest as advisory, not as a defect', () => {
    // A project runs fine without one; it just cannot prove another checkout got
    // the same bytes.
    const check = named(judgeLayout(observation({ manifest: { kind: 'absent' } })), 'void manifest');

    expect(check?.status).toBe('advisory');
    expect(check?.ok).toBe(true);
  });

  it('does not confuse a damaged manifest with a missing one', () => {
    const check = named(judgeLayout(observation({ manifest: { kind: 'unreadable' } })), 'void manifest');

    expect(check?.status).toBe('fail');
    expect(check?.fix).toContain('restore it from git');
  });

  it('reports tracked regenerated content as advisory, not as a failure', () => {
    // Nothing is broken by committing it, so calling it a failure would cry wolf.
    // But untracking rewrites the project's index, so it is offered, not done.
    const check = named(judgeLayout(observation({ trackedDerivedCount: 126 })), 'void derived');

    expect(check?.status).toBe('advisory');
    expect(check?.ok).toBe(true);
    expect(check?.message).toContain('126');
    expect(check?.fix).toContain('git rm --cached');
    expect(check?.fix).not.toContain('--untrack-derived');
  });

  it('stays silent when no regenerated content is tracked', () => {
    expect(named(judgeLayout(observation()), 'void derived')?.status).toBe('pass');
  });

  it('judges every observed write path, not only the one the block declares', () => {
    // `.void/machine/` being ignored says nothing about `.void/outputs/`, which
    // the published hook bundle writes to on every session. That gap is how an
    // untracked session log came within one `git add .` of being committed.
    const check = named(
      judgeLayout(
        observation({
          localIgnored: true,
          observedPaths: [{ path: '.void/outputs', present: true, ignored: false }],
        }),
      ),
      'void observed',
    );

    expect(check?.status).toBe('fail');
    expect(check?.message).toContain('.void/outputs');
  });

  it('says the consequence, not just the state', () => {
    const check = named(judgeLayout(observation({ localIgnored: false })), 'void ignore');

    expect(check?.message).toMatch(/would be committed/);
  });
});

// A renamed skill kept because it was edited by hand goes on loading beside its
// replacement, and after the first update nothing mentions it again. Advisory
// rather than a failure: nothing is broken, the agent simply answers from
// whichever of the two doctrines it loads first.
describe('void orphans', () => {
  const orphans = (over: Partial<LayoutObservation> = {}): CheckResult =>
    judgeLayout(observation(over)).find((check) => check.name === 'void orphans') as CheckResult;

  it('passes quietly when the manifest still owns everything on disk', () => {
    expect(orphans().ok).toBe(true);
    expect(orphans().status).toBeUndefined();
  });

  it('names what still loads, and whose call it is to delete', () => {
    const check = orphans({ orphanedAssets: ['.claude/skills/ticket-runner/SKILL.md'] });
    expect(check.status).toBe('advisory');
    expect(check.message).toContain('ticket-runner');
    expect(check.fix).toContain('delete');
  });

  it('does not block, because the bytes were changed by hand and are not ours', () => {
    expect(orphans({ orphanedAssets: ['a', 'b'] }).ok).toBe(true);
  });
})

// The install writes two records of the same event, and only one of them
// survives a git operation. `.void/install-manifest.json` is tracked, so
// `git checkout` reverts it; the receipt lives under the ignored `.void/machine/`
// and does not. That asymmetry is the whole point of this check: after an
// upgrade across a rename, `git checkout -- . && git clean -fd` restores the
// previous ignore block and then deletes the assets that block no longer covers,
// leaving a project whose manifest and disk agree on the OLD version while the
// receipt still records the new one. Every other check passes, git reports a
// clean tree, and the harness is silently back one version.
describe('void receipt', () => {
  const receipt = (over: Partial<LayoutObservation> = {}): CheckResult =>
    judgeLayout(observation(over)).find((check) => check.name === 'void receipt') as CheckResult;

  it('passes when every file the install recorded is still on disk', () => {
    expect(receipt().ok).toBe(true);
  });

  it('fails when the install recorded files that are no longer there', () => {
    const check = receipt({
      receipt: {
        kind: 'present',
        version: '3.4.1',
        missing: ['.claude/skills/void-tdd/SKILL.md'],
        missingTotal: 80,
      },
    });

    expect(check.status).toBe('fail');
    expect(check.message).toContain('80');
    expect(check.message).toContain('3.4.1');
    expect(check.fix).toContain('3.4.1');
  });

  it('names the rollback when the manifest disagrees, because that is the diagnosis', () => {
    // Receipt ahead of manifest is not "some files vanished". It is one specific
    // sequence, and naming it saves the hours the audit spent finding it.
    const check = receipt({
      manifest: { kind: 'present', version: '3.1.0', drifted: 0 },
      receipt: { kind: 'present', version: '3.4.1', missing: ['.claude/skills/void-tdd/SKILL.md'], missingTotal: 80 },
    });

    expect(check.message).toContain('3.1.0');
    expect(check.message).toContain('rolled back');
  });

  it('does not claim a rollback when both records name the same version', () => {
    // Files can also go missing by hand, or by a failed write. Saying "rolled
    // back" there would send the reader looking for a git operation that never
    // happened, which is the class of misleading message this check exists to
    // stop making.
    const check = receipt({
      manifest: { kind: 'present', version: '3.4.1', drifted: 0 },
      receipt: { kind: 'present', version: '3.4.1', missing: ['.claude/agents/doctrine-critic.md'], missingTotal: 1 },
    });

    expect(check.status).toBe('fail');
    expect(check.message).not.toContain('rolled back');
    expect(check.message).toContain('doctrine-critic');
  });

  it('treats an absent receipt as unproven, never as a failure', () => {
    // A marketplace install records no local receipt. Nothing is wrong; there is
    // simply nothing to compare, and saying so beats inventing a verdict.
    const check = receipt({ receipt: { kind: 'absent' } });
    expect(check.ok).toBe(true);
    expect(check.status).toBe('advisory');
  });

  it('does not confuse an unreadable receipt with missing assets', () => {
    const check = receipt({ receipt: { kind: 'unreadable' } });
    expect(check.status).toBe('unknown');
  });
});

// The block no longer ignores a project skill by default, so this check stopped
// being the mechanism and became the net. What can still hide one is a name: a
// project skill called `void-something` falls under the pattern that hides the
// shipped ones. Teaching the old remedy -- write the exception by hand -- would
// now be teaching a workaround for a name collision.
describe('judgeProjectSkills', () => {
  it('passes when the project wrote none of its own', () => {
    expect(judgeProjectSkills([]).ok).toBe(true);
  });

  it('names the reserved prefix as the cause, since that is what hides a skill now', () => {
    const check = judgeProjectSkills(['.claude/skills/void-ma-skill']);
    expect(check.ok).toBe(false);
    expect(check.message).toContain('void-ma-skill');
    expect(check.fix).toContain('void-');
    expect(check.fix).not.toContain('!.claude/skills/void-ma-skill/');
  });

  it('sends an unexplained case to git, which names the exact rule', () => {
    const check = judgeProjectSkills(['.claude/skills/ma-skill']);
    expect(check.ok).toBe(false);
    expect(check.fix).toContain('git check-ignore -v');
    expect(check.fix).not.toContain('!.claude/skills/ma-skill/');
  });

  it('is advisory, never a blocker: an ignored skill still loads at runtime', () => {
    expect(judgeProjectSkills(['.claude/skills/ma-skill']).status).toBe('advisory');
  });
});
