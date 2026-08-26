# Migrating to 3.0

Thirteen skills changed name, and the layout under `.void/` moved. Both are
mechanical, and `update` performs the second one for you. The first is the reason
this is a major: a skill's name is the interface your doctrine and your tickets
cite, so renaming one breaks anything that wrote it down.

## Upgrading

```
npx voidharness@latest update
```

That migrates the layout, replaces the renamed skills and removes the ones they
replaced. Two situations need more than that.

**On a clone.** The install receipt is machine-local, so a fresh checkout has
none, and without it nothing knows which files the harness owns. `update` now
stops and says so rather than doing marketplace work and reporting success,
which is what earlier versions did:

```
npx voidharness@<the version in .void/install-manifest.json> hydrate
npx voidharness@latest update --force
```

**If you edited a skill by hand.** Its bytes no longer match what we wrote, so
`update` preserves it rather than deleting someone's work. It now names what it
kept, and `doctor` keeps reporting it under `void orphans` for as long as it sits
there. A preserved copy of a renamed skill loads beside its replacement, so the
agent answers from whichever it reads first. Delete it to finish the upgrade.

## The renames

Search your `PROJECT-DOCTRINE.md`, your tracker, and any prose that routes work.
The old names resolve to nothing; there is no alias.

| before | after |
|---|---|
| `brainstorming` | `void-brainstorm` |
| `writing-plans` | `void-plan` |
| `ticket-writer` | `void-ticket` |
| `ticket-runner` | `void-implement` |
| `verification-before-completion` | `void-verify` |
| `systematic-debugging` | `void-debug` |
| `learning-capture` | `void-learn` |
| `adr-workflow` | `void-decide` |
| `refactoring` | `void-refactor` |
| `accessibility-first` | `void-accessibility` |
| `context-management` | `void-context` |
| `claude-md-authoring` | `void-claude-md` |
| `migrations-safety` | `void-migrations` |

One rule decides all of them, and it is now checked rather than intended. A skill
is named by what someone would type looking for it without knowing it exists: an
action takes its bare verb, a standard takes the subject it governs, an agent
takes a person you could hire. `kind` in the frontmatter says which applies. The
reasoning, and the alternatives that lost, are in the decision log.

## The layout

`.void/` has three levels, named by what deleting them costs:

| | |
|---|---|
| the top of `.void/` | declared, committed. Deleting one loses a decision |
| `.void/installed/` | derived, ignored. `install` restores it byte for byte |
| `.void/machine/` | observed, ignored, disposable |

Everything at the top is committed; neither subdirectory is. `update` moves what
was observed, drops what was derived, and leaves what you declared alone.

Two files moved with it. The programme descriptor is now `.void/program.md`,
still committed, because it carries provider routing, human gates and consent to
autonomous execution, and consent nobody can review in a diff is not consent. The
session residue is now `.void/machine/checkpoint.md`, not committed,
because it is yours and disposable.

Readers fall back to the previous locations, so a project that has not run
`update` yet keeps working.

## What to check afterwards

```
void-harness doctor
```

Three of its checks are new and answer questions nothing asked before: whether
git actually ignores every path the harness writes to, whether a harness asset
the manifest no longer owns is still loading, and whether the CLI reading your
project is older than the layout on disk. That last one used to produce four
confident, wrong failures with remedies that would have damaged a healthy
install; it now reports the version gap and judges nothing else.
