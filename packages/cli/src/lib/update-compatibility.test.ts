// @test-resource subprocess
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { init } from '../commands/init.js';
import { INSTALL_RECEIPT_PATH } from './receipts.js';
import { assertProjectCompatibility } from './update-compatibility.js';
import { main, requiresProjectCompatibility } from '../main.js';
import { doctor } from '../commands/doctor.js';

const roots: string[] = [];
const initialCwd = process.cwd();
afterEach(async () => {
  process.chdir(initialCwd);
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it('refuses a newer installation before init changes its files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'void-compatibility-'));
  roots.push(root);
  await mkdir(join(root, '.void/machine/receipts'), { recursive: true });
  const receipt = JSON.stringify({ schemaVersion: 1, version: '99.0.0',
    source: 'local', runtimes: ['codex'], files: [] });
  await writeFile(join(root, INSTALL_RECEIPT_PATH), receipt);
  process.chdir(root);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process, 'exit').mockImplementation(code => {
    throw new Error(`process.exit(${String(code)})`);
  });

  await expect(init(['--runtime', 'codex', '--no-interactive']))
    .rejects.toThrow(/newer.*99\.0\.0|99\.0\.0.*newer/i);
  expect(await readFile(join(root, INSTALL_RECEIPT_PATH), 'utf8')).toBe(receipt);
  expect(await readdir(root)).toEqual(['.void']);
});

it.each([
  { body: '{', reason: /receipt.*invalid/i },
  { body: JSON.stringify({ schemaVersion: 9 }), reason: /receipt.*schema/i },
  { body: JSON.stringify({ schemaVersion: 1, version: '5.0.1', source: 'local',
    runtimes: ['future-runtime'], files: [] }), reason: /receipt.*runtime|receipt.*invalid/i },
  { body: JSON.stringify({ schemaVersion: 1, version: 'garbage', source: 'local',
    runtimes: ['codex'], files: [] }), reason: /version/i },
  { body: JSON.stringify({ schemaVersion: 1, version: '5.0.1', source: 'local',
    runtimes: [], files: [] }), reason: /runtime/i },
  { body: JSON.stringify({ schemaVersion: 1, version: '5.0.1', source: 'local',
    runtimes: ['codex', 'codex'], files: [] }), reason: /runtime/i },
])('distinguishes invalid installed evidence from absence: $body', async ({ body, reason }) => {
  const root = await mkdtemp(join(tmpdir(), 'void-invalid-compatibility-'));
  roots.push(root);
  await mkdir(join(root, '.void/machine/receipts'), { recursive: true });
  await writeFile(join(root, INSTALL_RECEIPT_PATH), body);
  await expect(assertProjectCompatibility(root)).rejects.toThrow(reason);
  expect(await readFile(join(root, INSTALL_RECEIPT_PATH), 'utf8')).toBe(body);
});

it('refuses contradictory receipt and manifest versions without repairing either', async () => {
  const root = await mkdtemp(join(tmpdir(), 'void-contradictory-compatibility-'));
  roots.push(root);
  await mkdir(join(root, '.void/machine/receipts'), { recursive: true });
  await writeFile(join(root, INSTALL_RECEIPT_PATH), JSON.stringify({ schemaVersion: 1,
    version: '5.0.1', source: 'local', runtimes: ['codex'], files: [] }));
  await writeFile(join(root, '.void/install-manifest.json'), JSON.stringify({ schemaVersion: 1,
    version: '4.0.0', files: [] }));
  await expect(assertProjectCompatibility(root)).rejects.toThrow(/disagree|contradict/i);
});

it('refuses future manifest and config schemas even without a receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'void-future-compatibility-'));
  roots.push(root);
  await mkdir(join(root, '.void'), { recursive: true });
  await writeFile(join(root, '.void/install-manifest.json'), JSON.stringify({ schemaVersion: 9,
    version: '5.0.1', files: [] }));
  await expect(assertProjectCompatibility(root)).rejects.toThrow(/manifest.*schema/i);
  await writeFile(join(root, '.void/install-manifest.json'), JSON.stringify({ schemaVersion: 1,
    version: '5.0.1', files: [] }));
  await writeFile(join(root, '.void/config.json'), '{"schemaVersion":99}');
  await expect(assertProjectCompatibility(root)).rejects.toThrow(/config.*schema/i);
});

it('refuses a retired selected pack instead of dropping it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'void-pack-compatibility-'));
  roots.push(root);
  await mkdir(join(root, '.void'), { recursive: true });
  await writeFile(join(root, '.void/config.json'), '{"packs":{"retired":"^4.0.0"}}');
  await expect(assertProjectCompatibility(root)).rejects.toThrow(/pack.*retired/i);
});

it.each(['future-programme', 'damaged-hold', 'linked-record-parent'])('refuses %s before mutations and reports the same cause in doctor', async kind => {
  const root = await mkdtemp(join(tmpdir(), 'void-programme-compatibility-'));
  roots.push(root);
  await mkdir(join(root, '.void/machine/autopilot'), { recursive: true });
  if (kind === 'future-programme') await writeFile(join(root, '.void/program.md'), '---\nschemaVersion: 99\n---\n');
  if (kind === 'damaged-hold') await writeFile(join(root, '.void/machine/autopilot/merge-hold.json'), '{}');
  if (kind === 'linked-record-parent') {
    await mkdir(join(root, 'foreign'));
    await symlink(join(root, 'foreign'), join(root, '.void/machine/receipts'));
  }
  const verdict = await assertProjectCompatibility(root).then(() => 'accepted', error => error instanceof Error ? error.message : 'unknown');
  expect(verdict).not.toBe('accepted');
  process.chdir(root);
  const output: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => { output.push(String(chunk)); return true; });
  vi.spyOn(process, 'exit').mockImplementation(code => { throw new Error(`process.exit(${String(code)})`); });
  await expect(doctor(['--no-remote'])).rejects.toThrow();
  expect(output.join('')).toContain(verdict);
});

it('guards runtime mutation routing before wiring a newer installation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'void-runtime-compatibility-'));
  roots.push(root);
  await mkdir(join(root, '.void/machine/receipts'), { recursive: true });
  await writeFile(join(root, INSTALL_RECEIPT_PATH), JSON.stringify({ schemaVersion: 1,
    version: '99.0.0', source: 'local', runtimes: ['claude'], files: [] }));
  await writeFile(join(root, '.void/config.json'), '{"packs":{}}');
  process.chdir(root);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process, 'exit').mockImplementation(code => {
    throw new Error(`process.exit(${String(code)})`);
  });
  await expect(main(['runtime', 'add', 'codex'])).rejects.toThrow(/newer/i);
  expect(await readdir(root)).toEqual(['.void']);
});

it.each([
  ['init', [], true], ['add', ['react'], true], ['remove', ['react'], true],
  ['runtime', ['add', 'codex'], true], ['runtime', ['list'], false],
  ['doctor', ['--fix'], true], ['doctor', ['--no-remote'], false],
  ['hydrate', [], true], ['update', [], false], ['help', [], false], ['version', [], false],
  ['mission', ['start'], true], ['mission', ['status'], false],
  ['agents', ['dispatch'], true], ['agents', ['status'], false],
  ['autopilot', ['merge'], true], ['autopilot', ['fingerprint'], false],
  ['graph', ['project-build'], true], ['graph', ['explain'], false],
  ['adoption', ['apply'], true], ['security', ['grant'], true],
  ['decisions', ['new'], true], ['decisions', ['check'], false],
])('classifies %s %j before dispatch', (command, args, expected) => {
  expect(requiresProjectCompatibility(String(command), Array.isArray(args) ? args : []))
    .toBe(expected);
});
