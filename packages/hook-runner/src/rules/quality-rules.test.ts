import { describe, expect, it } from 'vitest';
import { boundaryDirection } from './boundary-direction.js';
import { designSlop } from './design-slop.js';
import { noAny } from './no-any.js';
import { noAsCast } from './no-as-cast.js';
import { noConsole } from './no-console.js';
import { noFocusedTest } from './no-focused-test.js';
import { noNull } from './no-null.js';
import { testName } from './test-name.js';

const edit = (path: string, addedContent: string) => [{ path, addedContent }];

describe('profile-scoped TypeScript rules', () => {
  it('blocks any and assertion casts in production TypeScript', () => {
    expect(noAny(edit('src/user.ts', 'const user: any = value;')).allow).toBe(false);
    expect(noAsCast(edit('src/user.ts', 'const user = value as User;')).allow).toBe(false);
  });

  it('allows Python, tests, generated code and documented exceptions', () => {
    expect(noAny(edit('src/user.py', 'value: any = input')).allow).toBe(true);
    expect(noAny(edit('src/user.test.ts', 'const fixture: any = 1;')).allow).toBe(true);
    expect(noAsCast(edit('src/__generated__/api.ts', 'value as User')).allow).toBe(true);
    expect(noAny(edit('src/user.ts', 'const fixture: any = 1; // allow-any: vendor boundary')).allow).toBe(true);
    expect(noAsCast(edit('src/user.ts', 'value as const')).allow).toBe(true);
  });

  it('ignores null in strings/comments but blocks a null literal', () => {
    expect(noNull(edit('src/user.ts', 'const value = null;')).allow).toBe(false);
    expect(noNull(edit('src/user.ts', 'const label = "null"; // null docs')).allow).toBe(true);
    expect(noNull(edit('src/user.ts', 'const value = null; // allow-null: API boundary')).allow).toBe(true);
  });
});

describe('language and test hygiene rules', () => {
  it('blocks console calls only on applicable source files', () => {
    expect(noConsole(edit('src/user.ts', 'console.error("boom");')).allow).toBe(false);
    expect(noConsole(edit('scripts/migrate.ts', 'console.log("done");')).allow).toBe(true);
    expect(noConsole(edit('src/user.py', 'print("done")')).allow).toBe(true);
  });

  it('refuses focused aliases and skipped suites without an undocumented path exemption', () => {
    for (const call of ['fdescribe', 'fit', 'describe.skip', 'it.skip', 'test.only']) {
      expect(noFocusedTest(edit('src/user.test.ts', `${call}("case", () => {});`)).allow).toBe(false);
    }
    expect(noFocusedTest(edit('test/__skip-on-purpose__/user.test.ts', 'test.skip("case", () => {});')).allow).toBe(false);
    expect(noFocusedTest(edit('src/user.test.ts', 'it.todo("pending contract");')).allow).toBe(true);
  });

  it('blocks focused/skipped JavaScript tests and generic test names', () => {
    expect(noFocusedTest(edit('src/user.test.tsx', 'it.only("renders", () => {});')).allow).toBe(false);
    expect(testName(edit('src/user.spec.js', 'test("should work", () => {});')).allow).toBe(false);
    expect(testName(edit('src/user.spec.js', 'test("returns the user when valid", () => {});')).allow).toBe(true);
  });
});

describe('architecture and design rules', () => {
  it('blocks a cross-package import but scopes itself to the monorepo profile', () => {
    // Topology now comes from each package's own manifest, so this rule needs a
    // project root to say anything at all. Without one it allows rather than
    // falling back to the star topology it used to assume — see
    // boundary-direction.test.ts for the behaviour that replaced it.
    expect(boundaryDirection(edit(
      'packages/orders/src/index.ts',
      "import { user } from '@repo/users';",
    )).allow).toBe(true);
  });

  it('blocks conservative design tells only in style-bearing files', () => {
    expect(designSlop(edit(
      'apps/web/src/Hero.tsx',
      '<div className="bg-gradient-to-r from-violet-500 to-cyan-500">Hero</div>',
    )).allow).toBe(false);
    expect(designSlop(edit(
      'apps/api/src/hero.ts',
      'const gradient = "from-violet-500 to-cyan-500";',
    )).allow).toBe(true);
    expect(designSlop(edit(
      'apps/web/src/Hero.tsx',
      '<div className="font-[Inter]">Hero</div> // allow-design-slop: brand font',
    )).allow).toBe(true);
  });
});
