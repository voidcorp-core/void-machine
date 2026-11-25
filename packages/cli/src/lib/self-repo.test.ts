import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isHarnessSourceRepo } from './self-repo.js';

describe('isHarnessSourceRepo', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'void-selfrepo-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const writePkg = (name: string) => writeFileSync(join(root, 'package.json'), JSON.stringify({ name }));
  const makeWorkspace = () => {
    mkdirSync(join(root, 'packages', 'cli'), { recursive: true });
    mkdirSync(join(root, 'packages', 'core'), { recursive: true });
  };

  it('is true for the source repo: name void-harness + packages/{cli,core}', () => {
    writePkg('void-harness');
    makeWorkspace();
    expect(isHarnessSourceRepo(root)).toBe(true);
  });

  it('is false when the name matches but the workspace layout is absent (a consumer named void-harness)', () => {
    writePkg('void-harness');
    // No packages/cli + packages/core — e.g. a consumer that vendored a .void/ dir.
    expect(isHarnessSourceRepo(root)).toBe(false);
  });

  it('is false when the workspace layout exists but the name differs', () => {
    writePkg('some-consumer-monorepo');
    makeWorkspace();
    expect(isHarnessSourceRepo(root)).toBe(false);
  });

  it('is false when only one of cli/core is present', () => {
    writePkg('void-harness');
    mkdirSync(join(root, 'packages', 'cli'), { recursive: true });
    expect(isHarnessSourceRepo(root)).toBe(false);
  });

  it('is false when there is no package.json at all', () => {
    expect(isHarnessSourceRepo(root)).toBe(false);
  });

  it('is false on a malformed package.json rather than throwing', () => {
    writeFileSync(join(root, 'package.json'), '{ not valid json');
    makeWorkspace();
    expect(isHarnessSourceRepo(root)).toBe(false);
  });

});
