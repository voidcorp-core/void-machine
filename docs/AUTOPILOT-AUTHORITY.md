# Explicit Autopilot authority

Autopilot is optional. Its authority can now live in the project-owned, protected
`.void/config.json`. Nothing installs, enables or migrates this block automatically.
`init`, `update` and pack pin changes preserve it, even when its content is invalid;
`init --force` refuses to overwrite unreadable JSON. Repair requires a deliberate edit.

Only an explicit `autopilot` declaration with `schemaVersion: 3` and boolean `enabled`
can authorize autonomous work. `enabled: false` withholds it. Absent, v1/v2, unknown,
invalid or unreadable declarations never fall back to historical programmes. V2 remains
readable by general config consumers for preservation, but the single authority reader
refuses its autonomous admission even beside an agreeing, disabled, conflicting or unreadable
old programme. Updating packages alone must not extend consent.

V3 does not read or veto against `.void/program.md`, `.void/active.md` or `plans/ACTIVE.md`.
Those files remain project-owned history, with bytes and ownership preserved. Migration is an
explicit human decision after reconciling prior consent and every restriction; a version number
alone is not evidence that reconciliation happened. Former human merges remain on hold.
Local checkpoint and Git operations do not need autonomous authority or a reachable provider.

`progress.provider/scope/states` remains the routing contract. Scope is an opaque native
project-and-milestone locator; the milestone links the approved plan and decisions. The
orchestrator reads actual membership, complete acceptance, blockers and human holds using native
tools. The kernel consumes observations and does not independently verify Linear. Missing plan,
scope or provider capability blocks dependent selection. Membership alone grants no permission.

Create a bounded initial selection (at most sixteen queue entries), then refresh affected units
and relations when evidence changes. Preserve human priorities and assignments; no full backlog
rerank after every merge. Clear approved arrivals get native project/milestone placement and a
readback. Ambiguous arrivals remain visible and non-admitted while independent work proceeds.
Reconcile multiple engaged tickets and uncertain workers before dispatch. Planned checkpoint
order is mutable intent; removing an entry cancels no ticket and deletes no worktree.

Human holds, additive protected paths, the deployment-branch ban, sequential ownership and review
bound to exact head/base remain unchanged. Nothing in the checkpoint grants permission or proves
fresh completion; read the full checkpoint and verify current remote/Git/worker observations.

## Explicit migration example

After a human approves migration, copy the effective legacy values into the new
block, preserving every restriction and the progress state names of the real provider.
For example, this declaration deliberately remains disabled:

```json
{
  "autopilot": {
    "schemaVersion": 3,
    "enabled": false,
    "clusterSize": 4,
    "base": "develop",
    "deployBranch": "main",
    "progress": {
      "provider": "linear",
      "scope": "native-project-and-milestone-locator",
      "states": {
        "ready": ["Todo"],
        "started": ["In Progress"],
        "review": ["In Review"],
        "done": ["Done"]
      }
    },
    "protectedPaths": [],
    "verifyCommands": [["pnpm", "test"]],
    "ownership": { "sequential": [], "reconcileOnly": [] },
    "humanGates": []
  }
}
```

`humanWaitLabel` is optional and defaults to `void:human-wait`; omitted `base` means
`auto`, and omitted `deployBranch` uses the repository default at admission. Existing
protected-path floors always apply. Run `void-machine doctor` to diagnose the source,
then test dependent commands in isolation. Keep the legacy programme and its history;
the runtime never rewrites it or promotes old config values. No flags,
config repair or checkpoint replay may turn `enabled` on.

Implementation: `config-schema.ts` declares the strict block, `autopilot/config.ts`
owns the shared value grammar, and `autopilot/authority.ts` owns admission.
`next`, review, fingerprints, publication and doctor use that same admission.

## Public compatibility changes

`ResumeBundle.schemaVersion` is now **2**. `ResumeBundle.program`, input `program` and
`programError`, gap reasons `program-absent`/`program-invalid`, and exported
`ResumeProgramInput`/`ProgramSummary` are removed. CLI `resume --json` follows that shape;
human and hook output no longer inject programme name, plan/spec or progress locator.
Checkpoint fields, complete-reference preservation, Git drift diagnostics and the 4,000-character
summary limit remain. The full checkpoint path and non-authority notice survive truncation.

Project summary input/output no longer exposes `program`/`ProgramSignal` or offline programme
unit counts. It retains local plan counts, Git and checkpoint observations; no remote counters
are invented. CLI `autopilot/program` parsing/path exports and `ProgressLocator` are removed;
authority types live in `autopilot/config`. Preflight observations use `authority` instead of
`program`. Historical files and decisions are retained, not migrated by install/update/packs.

Before activating this retirement, acceptance requires real fresh Claude and Codex sessions on
isolated candidate installations, with normal permissions. Installed hook subprocess tests prove
wiring only; they do not substitute for native context and provider observations. The current
coordinator's pinned runtime and active declaration are not migrated by this source change.
