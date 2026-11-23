---
name: void-refactor
description: Improve structure without changing behavior through small verified transformations and coherent commits. Use when current code resists the accepted task.
---

# Refactor

Change structure while preserving behavior. Use small, verifiable transformations; run relevant
tests before and after. When observable behavior changes, apply `void-tdd` and preserve applicable
RED/GREEN evidence. Fowler techniques are useful references, never compulsory commit wording.
**Attribution**: see `.source` (Beck, Fowler and Feathers).

## Choose the transformation

Refactor when current code resists the accepted task, a boundary is unclear, or relevant duplication
has a shared reason to change. Do not add unrelated cleanup or speculative abstractions. Use IDE
transformations where reliable; inspect the diff and verify the affected behavior. A failed test
requires investigation, not relabeling the change to bypass the proof.

### Common refactors

| Refactor | When |
|---|---|
| **Extract Function** | A block of code does a sub-task that has a name. Give the name a function. |
| **Inline Function** | A function's body is as clear as its name. Inline it. |
| **Extract Variable** | An expression is hard to understand. Name it with a `const`. |
| **Inline Variable** | A variable's name adds no clarity. Inline. |
| **Rename Variable** / **Rename Function** | Better name. Use IDE Rename Symbol. |
| **Move Function** | The function belongs to another module / class. |
| **Replace Conditional with Polymorphism** | A `switch` on type is repeated. Move dispatch to the types. (Use sparingly; discriminated unions + exhaustive switch is often better in TS than classes.) |
| **Replace Magic Number with Symbolic Constant** | Magic numbers (or magic strings) without context. Name them. |
| **Decompose Conditional** | Complex `if` expression. Extract Variable on each branch's condition + Extract Function on each body. |
| **Replace Primitive with Branded Type** | Composes with `void-typescript-strict`. `string` UserId → `UserId` branded. |
| **Replace Loop with Pipeline** | Imperative loop accumulating into an array. Use `.map().filter().reduce()`. |
| **Replace Function with Command** | Function with many parameters and state. Object with a `run()` method. |
| **Separate Query from Modifier** | A function that returns AND mutates. Split into `getX()` and `setX()`. |

## Coherent commits

One commit has one coherent, reviewable and revertible intent. Separate substantial or independently
useful preparatory restructuring when mixing it would obscure behavioral review or rollback.
A small directly necessary extraction or rename may accompany its feature/fix and regression test,
under the correct `feat`/`fix` type. No universal one-transformation-one-commit rule or Fowler-name
gate applies. `void-commit-discipline` owns Conventional Commits and meaningful rationale.

## Legacy code

Establish a faithful characterization test or useful seam before restructuring untested behavior.
Feathers' Sprout and Wrap techniques can isolate new tested logic while preserving the old contract.
Do not treat new tests as behavior additions in themselves. Cross-boundary changes follow
`void-hexagonal-architecture` and `void-domain-driven-design`; independent `void-code-review` checks
actual consequences, not terminology.
