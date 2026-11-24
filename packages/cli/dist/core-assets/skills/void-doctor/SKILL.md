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

In the void-machine repository itself, `doctor` delegates to the self-host doctor, which asks a
different question: do the current sources still compile into a working harness. Both are valid;
say which one ran, because "healthy" means different things.

---

## Read it

Give a one-screen summary, in this order:

1. **What is broken**, and for each one the exact command that fixes it. A finding without its
   repair command is a finding the reader has to research, which is how a doctor report becomes
   something nobody runs twice.
2. **What is stale** rather than broken: an artefact older than its sources, a version behind, a
   marketplace unreachable. Stale degrades; it does not fail.
3. **What is healthy**, in one line. Not a list.

Do not paste the raw output back. It is written to be read by a human at a terminal, and
repeating it costs the whole screen for no added meaning.

---

## What it must not do

**Never repair automatically.** The report names the command; the human runs it. A check that
silently rewrites a project's configuration removes the one moment where someone could have said
"no, that file is mine".

The exception is explicit and stays explicit: when a repair flag exists, it runs only because a
human typed it, never as a follow-up this skill decides on.

---

## Red flags

| Rationalization | Reality |
|---|---|
| "It reported stale, I'll just re-run init to clean it up" | init rewrites managed files. Report it and let the human choose. |
| "The output is long, I'll paste it and let them read" | Then the skill added nothing. Summarise, or say it was already clear. |
| "Everything is green, nothing to say" | Say it in one line, including which target ran: the repo doctor and the consumer doctor answer different questions. |

---

## Composition

Adjacent: `void-verify` proves one unit of work; this proves the harness that guards every unit.
Downstream: a finding about a missing doctrine rule is routed to `void-learn`, never fixed here.
