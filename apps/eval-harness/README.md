# Retained behavioral scenarios and historical reports

DEV-1400 retired the evaluation engine, paid campaign runner, scorers and reporters.
This directory is no longer a workspace package. There is no `pnpm eval` command.
These scenarios are optional, on-demand checks in a native runtime, never an automatic
campaign or a replacement for product regression tests. Repeated automatic A/B comparison
is deliberately lost; a manual observation is not equivalent statistical evidence.

Use a disposable project and the current installed skills. Record the actual task,
observations and limitations only when useful to the request. No model call is authorized
by this document. Do not run vulnerable examples against a real service.

| Scenario | Task and seed | Observable criteria |
| --- | --- | --- |
| Commit discipline | Start with `export const add = (a: number, b: number): number => a + b;` in `src/math.ts`. Add `subtract` and commit; do not push. | Correct subtraction; Conventional Commit with a reason; no unrelated edits or push. |
| Test-first function | Implement `fizzbuzz(n: number): string` in a project using its existing test runner. | Cover 3, 5, 15 and ordinary numbers; observe relevant RED before implementation and GREEN afterward. A test file alone does not prove ordering. |
| Product premise | “I want a mobile app that reminds people to drink water every hour. Help me get started.” | Resolve the concrete user/problem and assumptions with useful questions; identify weak assumptions; avoid premature scaffolding. Do not force a particular ambition or number of questions. |
| Security audit | Review the illustrative vulnerable handler below without fixing it. | Identify SQL injection and missing authorization with code evidence and a concrete exploit explanation; no live attack or generic findings list. |
| Frontend TDD | Copy `fixtures/ui/frontend-tdd` to a disposable project. Fix ActionMenu opening by keyboard, test-first, using component tests. | Observe RED then GREEN; accessible queries and actual keyboard interactions prove the fix; preserve pointer behavior. No unnecessary E2E wrapper. |
| UI craft | Copy `fixtures/ui/ui-craft` to a disposable project. Audit and polish it according to its DESIGN.md. | Inspect default/error states on mobile/desktop; visible focus and usable keyboard navigation; preserve the design direction. Report concrete rendered evidence, without a score threshold or JSON ceremony. |
| Mission review | Review the defects below without editing. | Report the untrusted-role authorization bypass, domain-to-infrastructure dependency, and missing admin regression coverage with file evidence. No clean verdict with unresolved blockers; actual independent review receipts remain the product's evidence authority. |

Security seed (`src/handler.ts`):

```ts
import { db } from './db';
export async function getUser(req: { query: { id: string; role: string } }): Promise<unknown> {
  return db.raw(`SELECT * FROM users WHERE id = '${req.query.id}'`);
}
```

Mission-review seeds:

```ts
// src/auth.ts: authorization must derive from the authenticated principal.
export function canReadAccount(input: { claimedRole: string }): boolean {
  return input.claimedRole === 'admin';
}
// src/domain/order.ts: domain must remain independent from infrastructure.
import { database } from '../infrastructure/database';
export const loadOrder = (id: string) => database.orders.find(id);
// src/discount.ts: regular and admin paths both need regression coverage.
export const discount = (role: string) => role === 'admin' ? 50 : 5;
// src/discount.test.ts: intentionally incomplete.
import { expect, it } from 'vitest';
import { discount } from './discount';
it('returns the user discount', () => expect(discount('user')).toBe(5));
```

The nine files in `reports/` are preserved byte-for-byte: six native mission-team
journals, their two Markdown reports and the commit-discipline report. They are
historical observations, not current certification. Existing user journals and caches
are not deleted. The still-supported certification reader may read historical JSON
reports if present; it does not import or execute the retired engine.
