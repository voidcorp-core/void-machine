// @test-resource subprocess
/**
 * `add` / `remove` refresh doctrine docs PER-RUNTIME: they update every doc the
 * project already has (keeping them in parity), but never resurrect the doc of a
 * runtime the project does not target. Doc ownership is per-runtime — creating a
 * runtime's doc is `init` / `runtime add`'s job, not a side effect of `add`.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { add } from '../../packages/cli/src/commands/add.js';
import { init } from '../../packages/cli/src/commands/init.js';
import { remove } from '../../packages/cli/src/commands/remove.js';

const BLOCK = '<!-- void-harness:begin -->\nold\n<!-- void-harness:end -->\n';

let dir: string;
let cwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'void-addrm-'));
  cwd = process.cwd();
  process.chdir(dir);
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
});

/**
 * One real `init` for the file, copied by the test that only needs its result.
 *
 * `init` writes 71 owned files and costs about a second on an idle machine. The
 * test below spends that on a precondition -- what it is about is `add` and
 * `remove` over a real installation -- and under the full concurrent suite the
 * three together were cut at the 10 s budget about two runs in five. Copying the
 * installed project costs roughly a tenth of that, and the copy IS an `init`
 * output, so nothing the test reads became a fixture written by hand.
 *
 * Built before any test and never written to, so no test depends on another
 * having run. The test that asserts on `init`'s own output still calls it.
 *
 * What that did NOT close, measured rather than assumed. `materializes and
 * removes only receipt-owned local pack assets` still fails about one full suite
 * in three. Per phase on an idle machine: the fixture copy 29 ms over 72 files
 * and 733 KB, `add` 691 ms, `remove` 434 ms. So the precondition is already ~2%
 * of the cost and there is nothing left to trim there -- `add` on a locally
 * installed project runs a whole `init` (`addLocalPacks` -> `init`), `remove`
 * does the same, and those two calls ARE what the test asserts on.
 *
 * The residual is contention, not redundant work: 693 ms isolated becomes
 * 5576 ms against the 10 s budget under the full concurrent suite, and the
 * neighbouring `init` test 365 ms becomes 3961 ms. Both sit within a factor of
 * two of the ceiling, so any extra load tips one over. The remaining levers are
 * a sequential lane for the install-heavy files, or `add` / `remove` not
 * re-running a full `init` -- a change to the suite's execution shape or to the
 * install path this repository runs on itself. Each wants its own ticket, and
 * neither is a bigger budget.
 */
let installedProject: string;

beforeAll(async () => {
  installedProject = mkdtempSync(join(tmpdir(), 'void-addrm-template-'));
  const before = process.cwd();
  process.chdir(installedProject);
  try {
    await init(['--runtime', 'claude', '--no-interactive']);
  } finally {
    process.chdir(before);
  }
}, 60_000);

afterAll(() => {
  rmSync(installedProject, { recursive: true, force: true });
});

describe('add / remove refresh existing docs per-runtime', () => {
  it('refreshes common doctrine while retaining the Claude import', async () => {
    // A both-runtime project: both docs already carry the managed block.
    writeFileSync(join(dir, 'CLAUDE.md'), `# CLAUDE.md\n${BLOCK}`);
    writeFileSync(join(dir, 'AGENTS.md'), `# AGENTS.md\n${BLOCK}`);
    await add(['harness-nextjs']);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toContain('@AGENTS.md');
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain('harness-nextjs');
  });

  it('does not resurrect the absent runtime doc (a Codex-only project keeps no CLAUDE.md)', async () => {
    writeFileSync(join(dir, 'AGENTS.md'), `# AGENTS.md\n${BLOCK}`);
    await add(['harness-nextjs']);
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain('harness-nextjs');
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false);
  });

  it('remove drops the pack from every existing doc', async () => {
    writeFileSync(join(dir, 'CLAUDE.md'), `# CLAUDE.md\n${BLOCK}`);
    writeFileSync(join(dir, 'AGENTS.md'), `# AGENTS.md\n${BLOCK}`);
    await add(['harness-nextjs']);
    await remove(['harness-nextjs']);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).not.toContain('harness-nextjs');
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).not.toContain('harness-nextjs');
  });

  it('materializes and removes only receipt-owned local pack assets', async () => {
    cpSync(installedProject, dir, { recursive: true });
    await add(['harness-nextjs']);
    const packSkill = join(dir, '.claude', 'skills', 'void-cache-component-pattern', 'SKILL.md');
    const adjacent = join(dir, '.claude', 'skills', 'private', 'SKILL.md');
    expect(existsSync(packSkill)).toBe(true);
    mkdirSync(join(dir, '.claude', 'skills', 'private'), { recursive: true });
    writeFileSync(adjacent, '# private\n');

    await remove(['harness-nextjs']);

    expect(existsSync(packSkill)).toBe(false);
    expect(readFileSync(adjacent, 'utf8')).toBe('# private\n');
  });

  /**
   * End-to-end guard for the channel wiring. `harnessBlock` takes the channel,
   * but a doc rendered without it silently falls back to the bare name and would
   * look correct here for the wrong reason. What this asserts is the opposite
   * direction: a local install must never write a namespaced skill name, because
   * a local install resolves none of them.
   */
  it('keeps runtime and channel invocation syntax in the common owner', async () => {
    await init(['--runtime', 'claude', '--no-interactive']);
    const doc = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    expect(doc).toMatch(/void-machine:begin/);
    expect(doc).not.toMatch(/(?<!void-)\bharness:[a-z]/);
    expect(doc).toContain('@AGENTS.md');
    const common = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    expect(common).toContain('invoked by its name');
    expect(common).toContain('`/void-implement`, `/void-tdd` for local installs');
    expect(common).toContain('`$void-implement`');
  });
});
