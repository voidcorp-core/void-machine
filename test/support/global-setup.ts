import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    readonly voidTestRunRoot: string;
  }
}

// Every command that writes a repository ends by starting `git maintenance run
// --auto --detach` (`gc --auto` before Git 2.29), a process that outlives it and
// still writes in `.git` while a test removes the repository. Turning the
// trigger off in the home every test runs under removes that writer, rather
// than retrying the removal it races.
const GIT_CONFIG = '[maintenance]\n\tauto = false\n[gc]\n\tauto = 0\n';

export default async function globalSetup(project: TestProject): Promise<() => Promise<void>> {
  const root = await mkdtemp(join(tmpdir(), 'void-harness-test-run-'));
  await Promise.all(
    ['home', 'tmp', 'void-global', 'cache', 'config'].map((name) =>
      mkdir(join(root, name), { recursive: true }),
    ),
  );
  await writeFile(join(root, 'home', '.gitconfig'), GIT_CONFIG);
  project.provide('voidTestRunRoot', root);

  return async () => {
    await rm(root, { recursive: true, force: true });
  };
}
