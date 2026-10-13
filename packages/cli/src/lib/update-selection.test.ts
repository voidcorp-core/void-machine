// @test-resource subprocess
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'void-update-selection-')));
  roots.push(root);
  const globalDir = join(root, 'global');
  const park = join(root, 'park');
  mkdirSync(globalDir);
  mkdirSync(park);
  writeFileSync(join(globalDir, 'discovery.json'), JSON.stringify({ roots: [park] }));
  return { root, globalDir, park };
}
function project(path: string) {
  mkdirSync(join(path, '.void'), { recursive: true });
  writeFileSync(join(path, '.void/config.json'), '{"packs":{}}');
  writeFileSync(join(path, '.void/install-manifest.json'), '{"schemaVersion":1,"version":"5.0.1","files":[]}');
  return path;
}

it('selects only the current enclosing installation, and no project outside one', async () => {
  const { selectUpdateProjects } = await import('./update-selection.js');
  const { root, globalDir, park } = fixture();
  const current = project(join(park, 'current'));
  project(join(park, 'other'));
  mkdirSync(join(current, 'nested'));
  expect(selectUpdateProjects({ cwd: join(current, 'nested'), globalDir, all: false })).toEqual([current]);
  expect(selectUpdateProjects({ cwd: root, globalDir, all: false })).toEqual([]);
});

it('selects the full declared project set only for explicit all', async () => {
  const { selectUpdateProjects } = await import('./update-selection.js');
  const { root, globalDir, park } = fixture();
  const first = project(join(park, 'first'));
  const second = project(join(park, 'second'));
  expect(selectUpdateProjects({ cwd: root, globalDir, all: true })).toEqual([first, second]);
});

it.each(['invalid-json', 'partial-roots', 'relative-root', 'unreadable-root', 'depth-limit'])(
  'refuses %s instead of presenting an incomplete all-project set', async attack => {
    const { selectUpdateProjects } = await import('./update-selection.js');
    const { root, globalDir, park } = fixture();
    project(join(park, 'visible'));
    if (attack === 'invalid-json') writeFileSync(join(globalDir, 'discovery.json'), '{');
    if (attack === 'partial-roots') writeFileSync(join(globalDir, 'discovery.json'), JSON.stringify({ roots: [park, 123] }));
    if (attack === 'relative-root') writeFileSync(join(globalDir, 'discovery.json'), JSON.stringify({ roots: [park, './relative'] }));
    if (attack === 'unreadable-root') writeFileSync(join(globalDir, 'discovery.json'), JSON.stringify({ roots: [park, join(root, 'missing')] }));
    if (attack === 'depth-limit') project(join(park, 'a/b/c/d/e/hidden'));
    expect(() => selectUpdateProjects({ cwd: root, globalDir, all: true })).toThrow();
  },
);

it('deduplicates a declared linked worktree through its canonical installation', async () => {
  const { selectUpdateProjects } = await import('./update-selection.js');
  const { root, globalDir, park } = fixture();
  const main = project(join(park, 'main'));
  const linked = join(park, 'linked');
  const git = (args: string[]) => execFileSync('git', ['-C', main, ...args], { stdio: 'pipe', timeout: 10_000 });
  git(['init', '-b', 'main']);
  git(['add', '.void']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
  git(['worktree', 'add', '--detach', linked]);
  writeFileSync(join(globalDir, 'discovery.json'), JSON.stringify({ roots: [linked, main] }));
  expect(selectUpdateProjects({ cwd: root, globalDir, all: true })).toEqual([main]);
  expect(selectUpdateProjects({ cwd: linked, globalDir, all: false })).toEqual([main]);
});
