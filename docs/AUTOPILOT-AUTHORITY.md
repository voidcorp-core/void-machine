# Autopilot authority during programme migration

Autopilot is optional. Its authority can now live in the project-owned, protected
`.void/config.json`. Nothing installs, enables or migrates this block automatically.
`init`, `update` and pack pin changes preserve it, even when its content is invalid;
`init --force` refuses to overwrite unreadable JSON. Repair requires a deliberate edit.

An absent config block retains legacy programme semantics, including a declared
legacy block with omitted `enabled`. A present block requires schema 2 and an explicit
boolean `enabled`; unknown fields, invalid values and unreadable sources never fall
back to a more permissive grant. Schema 1 is never promoted implicitly.

When both sources declare authority, enabled authority requires semantic equality
of consent, targets, cluster size, label, verification commands, protected paths,
ownership, progress provider/scope/states and human gates. Defaults are normalized;
sets ignore ordering, command argv and command order remain significant. Both disabled
sources withhold every autonomous admission regardless of their other restrictions.
Conflicts refuse only dependent autonomous actions, not unrelated repository work.

The programme remains context for plan/spec and selection until the checkpoint
migration is independently proven. Config has no ticket order. Missing selection
information must be diagnosed rather than invented; config alone works for operations
whose supplied input already contains the needed selection information. Checkpoints
never grant authority. Human holds, additive protected paths, the deployment-branch
ban and review bound to the exact head/base remain unchanged.

## Explicit migration example

After a human approves migration, copy the effective legacy values into the new
block, preserving every restriction and the progress state names of the real provider.
For example, this declaration deliberately remains disabled:

```json
{
  "autopilot": {
    "schemaVersion": 2,
    "enabled": false,
    "clusterSize": 4,
    "base": "develop",
    "deployBranch": "main",
    "progress": {
      "provider": "linear",
      "scope": "team/project",
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
removing its authority block is an explicit edit, not an automatic repair. No flags,
config repair or checkpoint replay may turn `enabled` on.

Implementation: `config-schema.ts` declares the strict block, `autopilot/config.ts`
owns the shared value grammar, and `autopilot/authority.ts` owns source resolution.
`next`, review, fingerprints, publication and doctor use that same resolution.
