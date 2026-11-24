#!/usr/bin/env node
// Assemble the complete marketplace trees and the self-contained npm delivery.
// Sources are versioned src assets; the hook bundle is an explicit built dependency.
import { cp, mkdir, readdir, rm, stat, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGES = resolve(HERE, '../..');
const SOURCE = join(PACKAGES, 'core/src');
const CORE = join(PACKAGES, 'core/dist');
const PACKS = join(PACKAGES, 'packs');
const args = process.argv.slice(2);
const check = args.includes('--check');
const packIndex = args.indexOf('--pack');
const onlyPack = packIndex < 0 ? undefined : args[packIndex + 1];
const destination = args.find((arg, index) => !arg.startsWith('--') && (packIndex < 0 || index !== packIndex + 1));
const TARGET = resolve(destination ?? join(PACKAGES, 'cli/dist/core-assets'));

const SHIPPED = new Map([
  ['.claude-plugin', 'the marketplace plugin manifest'],
  ['PHILOSOPHY.md', 'the universal doctrine, read from the package'],
  ['PROJECT-DOCTRINE.template.md', 'seeds .void/PROJECT-DOCTRINE.md once at init'],
  ['adapters', 'security scanner manifests'],
  ['agents', 'the specialist agent definitions each runtime stages'],
  ['codex', 'the Codex safety floor (hooks.json)'],
  ['contract-history', 'immutable released contracts required by declared open-mission migrations'],
  ['data', 'the product identity consumed by the runtime'],
  ['enforce', 'the enforcement floor configuration'],
  ['hooks', 'the runtime hook bundle a consumer executes'],
  ['modules', 'extension point `install --global` copies when present'],
  ['policies', 'the routing policies the mission engine merges'],
  ['profiles', 'stack profiles compiled into a project'],
  ['skills', 'the skills themselves'],
  ['specialists', 'native specialist contracts per runtime'],
  ['templates', 'the GitHub workflow a project can adopt'],
]);


async function copy(source, target) {
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, filter: (path) => !path.endsWith('.test.ts') });
}

async function assembleCore(target) {
  const undeclared = (await readdir(SOURCE)).filter((entry) => !SHIPPED.has(entry));
  if (undeclared.length > 0) throw new Error(`Undeclared core delivery: ${undeclared.join(', ')}`);
  await copy(SOURCE, target);
  await copy(join(CORE, 'hooks/_void-hook.mjs'), join(target, 'hooks/_void-hook.mjs'));
  const { loadSpecialists } = await tsImport('../src/lib/specialists/load.ts', import.meta.url);
  const { compileClaudeSpecialist } = await tsImport('../src/lib/specialists/compile-claude.ts', import.meta.url);
  for (const contract of await loadSpecialists(SOURCE)) {
    const compiled = compileClaudeSpecialist(contract);
    await writeFile(join(target, 'agents', `${compiled.name}.md`), compiled.content);
  }
}

const PACK_ASSETS = ['.claude-plugin', 'skills', 'hooks', 'claude', 'tsconfig.strict.json'];
async function assemblePack(name, target) {
  const source = join(PACKS, name, 'src');
  for (const entry of PACK_ASSETS) {
    try { await stat(join(source, entry)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    await copy(join(source, entry), join(target, entry));
  }
}

// Compare bytes, names and executable bits, including missing and orphan files.
async function inventory(root, path = '') {
  const found = new Map();
  let entries;
  try { entries = await readdir(join(root, path), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return found; throw error; }
  for (const entry of entries) {
    const relative = join(path, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Delivery symlink refused: ${relative}`);
    if (entry.isDirectory()) {
      for (const [name, content] of await inventory(root, relative)) found.set(name, content);
    } else {
      const info = await stat(join(root, relative));
      found.set(relative, `${info.mode & 0o111}:${(await readFile(join(root, relative))).toString('base64')}`);
    }
  }
  return found;
}

async function publish(expected, actual) {
  if (check) {
    const wanted = await inventory(expected);
    const received = await inventory(actual);
    const changed = [...new Set([...wanted.keys(), ...received.keys()])]
      .filter((name) => wanted.get(name) !== received.get(name));
    if (changed.length > 0) throw new Error(`Stale delivery ${actual}: ${changed.join(', ')}. Run pnpm derive.`);
  } else {
    await rm(actual, { recursive: true, force: true });
    try { await stat(expected); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    await copy(expected, actual);
  }
}

const temporary = await mkdtemp(join(tmpdir(), 'assembly-'));
try {
  const names = (await readdir(PACKS, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  if (onlyPack !== undefined && !names.includes(onlyPack)) throw new Error(`Unknown pack: ${onlyPack}`);
  for (const name of onlyPack === undefined ? names : [onlyPack]) {
    const assembled = join(temporary, 'packs', name);
    await assemblePack(name, assembled);
    if (destination === undefined) {
      // The pack's TypeScript compiler owns other dist entries.
      for (const entry of PACK_ASSETS) {
        const expected = join(assembled, entry);
        try { await stat(expected); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await publish(expected, join(PACKS, name, 'dist', entry));
          continue;
        }
        if (entry.endsWith('.json')) {
          const actual = join(PACKS, name, 'dist', entry);
          if (check) {
            if (!(await readFile(expected)).equals(await readFile(actual))) throw new Error(`Stale delivery ${actual}`);
          } else await copy(expected, actual);
        } else await publish(expected, join(PACKS, name, 'dist', entry));
      }
    }
  }
  if (onlyPack === undefined) {
    if (destination === undefined) await publish(join(PACKAGES, 'cli/src/bin'), join(PACKAGES, 'cli/dist/bin'));
    const assembled = join(temporary, 'core');
    await assembleCore(assembled);
    if (destination === undefined) await publish(assembled, CORE);
    for (const name of names) await copy(join(temporary, 'packs', name, 'skills'), join(assembled, 'packs', name, 'skills'));
    await publish(assembled, TARGET);
  }
  process.stdout.write(`Assets ${check ? 'verified' : 'assembled'}.\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
