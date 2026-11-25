---
name: void-doctor
description: Run the harness health checks and report what is healthy, missing or stale, with the exact command that repairs each finding. Reports; never repairs on its own.
allowed-tools: Bash(void-machine:*) Bash(npx:*)
---

# void-doctor

Answer one question: is this project's harness actually wired, or does it only look wired.

**Attribution**: see `.source`.

---

## When it fires

Only when a human asks. `disable-model-invocation: true` is deliberate: a health check that
fires on its own turns a session into a diagnostic, and its findings arrive when nobody asked
for them and nobody acts on them.

The moments worth running it: after an install or an update, when a rule that should have
blocked something did not, when a skill you expected did not load, and when a session opens on a
project you have not touched in a while.

---

## Run it

```
void-machine doctor
```

The CLI is public on npm as `voidmachine`, whose binary is `void-machine` (alias `vm`;
the former command still works, with a deprecation notice). If it is not on PATH,
`npx voidmachine doctor` is the same thing without an install.

`doctor` checks the published installation at `installRoot`, including in the source repository
and linked worktrees. It performs no npm, marketplace or GitHub authentication lookup. Use
`void-machine check` explicitly for available updates; `--no-remote` remains a compatible no-op.

For current-source validation, explicitly run `void-machine self-host sync` followed by
`void-machine self-host doctor`. The latter never builds: absent, stale or drifted artifacts fail;
missing optional runtime CLIs remain degraded and untested. A healthy self-host artifact never
substitutes for a missing published installation.

---

## Read it

Give a one-screen summary, in this order:

1. **What is broken**, and for each one the exact command that fixes it. A finding without its
   repair command is a finding the reader has to research, which is how a doctor report becomes
   something nobody runs twice.
2. **What was not tested**, such as an optional native runtime unavailable to self-host.
   Structural self-host staleness is a failure; unavailable optional runtimes are degraded.
3. **What is healthy**, in one line. Not a list.

Do not paste the raw output back. It is written to be read by a human at a terminal, and
repeating it costs the whole screen for no added meaning.

---

## What it must not do

**Never repair automatically.** The report names the command; the human runs it. A check that
silently rewrites a project's configuration removes the one moment where someone could have said
"no, that file is mine".

The former `doctor --fix` and `--dry-run` repair flags are retired and return an explicit error.
Self-host rollout modes and `--mode` are retired too; structural validation always applies.

---

## Red flags

| Rationalization | Reality |
|---|---|
| "It reported stale, I'll just re-run init to clean it up" | init rewrites managed files. Report it and let the human choose. |
| "The output is long, I'll paste it and let them read" | Then the skill added nothing. Summarise, or say it was already clear. |
| "Everything is green, nothing to say" | Say it in one line, including which target ran: published-install doctor and explicit self-host doctor answer different questions. |

---

## Composition

Adjacent: `void-verify` proves one unit of work; this proves the harness that guards every unit.
Downstream: a finding about a missing doctrine rule is routed to `void-learn`, never fixed here.
