// @test-resource subprocess
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(behavior: 'valid' | 'foreign' | 'failure') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'void-candidate-process-')));
  roots.push(root);
  const pkg = join(root, 'package');
  await mkdir(join(pkg, 'bin'), { recursive: true });
  await mkdir(join(pkg, 'dist'));
  await mkdir(join(root, 'workspace'));
  await mkdir(join(root, 'project'));
  await writeFile(join(pkg, 'package.json'), JSON.stringify({
    name: 'voidmachine', version: '5.1.0', engines: { node: '>=24.15.0' },
    bin: { 'void-machine': './bin/void-machine.mjs', voidmachine: './bin/void-machine.mjs' },
    voidUpdate: { protocol: 1, configSchemas: [1], receiptSchemas: [1], manifestSchemas: [1], programSchemas: [1], runtimeAdapters: ['codex', 'claude'] },
  }));
  await writeFile(join(pkg, 'bin/void-machine.mjs'), '');
  await writeFile(join(pkg, 'dist/main.js'), '');
  await writeFile(join(pkg, 'bin/prepare-update.mjs'), `
    import { readFile, writeFile } from 'node:fs/promises';
    const request = JSON.parse(await readFile(process.argv[2], 'utf8'));
    if (${JSON.stringify(behavior)} === 'failure') process.exit(23);
    if (${JSON.stringify(behavior)} === 'foreign') request.root = '/foreign';
    if (process.env.NODE_OPTIONS) throw new Error('inherited Node options');
    await writeFile(process.argv[3], JSON.stringify({ ...request,
      mutations: [], inputs: [], restored: [], preserved: [], runtimes: ['codex'] }));
  `);
  return { root, pkg, request: { protocol: 1 as const, operationId: 'op-1', version: '5.1.0', root: join(root, 'project') } };
}

it('executes the fixed candidate protocol with isolated state and returns a validated plan', async () => {
  const { prepareWithCandidate } = await import('./candidate-process.js');
  const { root, pkg, request } = await fixture('valid');
  expect(await prepareWithCandidate(pkg, request, join(root, 'workspace'))).toMatchObject({ ...request, mutations: [] });
  expect(JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8')).version).toBe('5.1.0');
});

it.each(['foreign', 'failure'] as const)('refuses candidate %s without publishing project files', async behavior => {
  const { prepareWithCandidate } = await import('./candidate-process.js');
  const { root, pkg, request } = await fixture(behavior);
  await expect(prepareWithCandidate(pkg, request, join(root, 'workspace'))).rejects.toThrow();
  await expect(readFile(join(request.root, '.void/config.json'))).rejects.toThrow();
});
