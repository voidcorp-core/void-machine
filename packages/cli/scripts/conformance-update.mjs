// Actual packed-product qualification, shared by the focused probe and the OS
// install-conformance owner. Transport/interruption instrumentation lives only here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { conformanceFixtureEnvironment, packageManagerCommand, requireConformanceExit,
  runConformanceProcess, runConformanceStep } from './conformance-process.mjs';

const read = path => readFile(path, 'utf8');
const receipt = project => join(project, '.void/machine/receipts/install-v1.json');

export async function prepareStableUpdate(temporary, tarball) {
  const root = await realpath(temporary);
  const home = join(root, 'stable home');
  const prefix = join(home, 'npm');
  const bin = process.platform === 'win32' ? prefix : join(prefix, 'bin');
  const project = join(home, 'projects/current');
  const second = join(home, 'projects/second');
  const third = join(home, 'projects/both');
  const projects = [project, second, third];
  await mkdir(project, { recursive: true });
  await mkdir(second, { recursive: true });
  await mkdir(join(second, '.void'), { recursive: true });
  await writeFile(join(second, '.void/PROJECT-DOCTRINE.md'), 'Second project doctrine\n');
  await mkdir(third, { recursive: true });
  await mkdir(join(home, 'tmp'));
  const env = conformanceFixtureEnvironment(home, { HOME: home, USERPROFILE: home,
    VOID_GLOBAL_DIR: join(home, '.void') });
  const npm = packageManagerCommand('npm');
  await runConformanceStep('stable update npm-owned bootstrap', { command: npm.executable,
    args: [...npm.prefixArguments, 'install', '--global', '--prefix', prefix, '--offline',
      '--ignore-scripts', '--no-audit', '--no-fund', tarball], cwd: home, env });
  const pkg = join(prefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules/voidmachine');
  const source = join(pkg, 'bin/void-machine.mjs');
  const version = JSON.parse(await read(join(pkg, 'package.json'))).version;
  // The qualified fixture launcher is first. No real-home launcher can be selected.
  env.PATH = [bin, dirname(process.execPath), env.PATH ?? env.Path ?? ''].join(delimiter);
  delete env.Path;
  const direct = (args, cwd = project) => runConformanceStep(`stable update ${args.join(' ')}`, {
    command: process.execPath, args: [source, ...args], cwd, env });
  for (const [cwd, runtime] of [[project, 'claude'], [second, 'codex'], [third, 'both']]) {
    await direct(['init', '--runtime', runtime, '--no-interactive'], cwd);
    const privateSkill = join(cwd, runtime === 'codex' ? '.agents' : '.claude', 'skills/private/SKILL.md');
    await mkdir(dirname(privateSkill), { recursive: true });
    await writeFile(privateSkill, '# private user skill\n');
  }
  await mkdir(join(home, '.void'), { recursive: true });
  await writeFile(join(home, '.void/discovery.json'), JSON.stringify({ roots: [join(home, 'projects')] }));
  await writeFile(join(project, '.void/PROJECT-DOCTRINE.md'), '# Authored doctrine\r\n');
  const configPath = join(project, '.void/config.json');
  const config = JSON.parse(await read(configPath));
  config.authoredSetting = 'preserve this';
  await writeFile(configPath, JSON.stringify(config));
  await writeFile(join(project, '.npmrc'), 'registry=https://unreachable.invalid\nignore-scripts=false\n');
  const otherReceipt = await read(receipt(second));
  const thirdReceipt = await read(receipt(third));
  const archive = await readFile(tarball);
  const transport = join(home, 'transport.mjs');
  const denied = join(home, 'offline.mjs');
  const interrupt = join(home, 'interrupt.mjs');
  const marker = join(home, 'interrupted');
  const target = join(bin, process.platform === 'win32' ? 'void-machine.cmd' : 'void-machine');
  await writeFile(transport, `
    import {readFile} from 'node:fs/promises';
    const archive = await readFile(${JSON.stringify(tarball)});
    const version = ${JSON.stringify(version)};
    const tarball = 'https://registry.npmjs.org/voidmachine/-/voidmachine-' + version + '.tgz';
    globalThis.fetch = async url => {
      if (url === tarball) return new Response(archive);
      if (url !== 'https://registry.npmjs.org/voidmachine/latest') throw new Error('Unexpected registry request');
      return new Response(JSON.stringify({name:'voidmachine',version,dist:{tarball,
        integrity:${JSON.stringify(`sha512-${createHash('sha512').update(archive).digest('base64')}`)}}}));
    };
  `);
  await writeFile(denied, "globalThis.fetch = async () => { throw new Error('CONFORMANCE_OFFLINE'); };\n");
  await writeFile(interrupt, `
    import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    const rename = fs.rename;
    fs.rename = async (from, to) => {
      await rename(from, to);
      if (to === ${JSON.stringify(target)}) {
        await fs.writeFile(${JSON.stringify(marker)}, 'after launcher rename, before active selection');
        process.kill(process.pid, 'SIGKILL');
      }
    };
    syncBuiltinESMExports();
  `);
  const active = join(home, '.void/cli/active.json');
  const managed = join(project, '.void/installed/PHILOSOPHY.md');
  const invoke = (args, imports = [], alias = 'void-machine', powershell = false, cwd = project) => {
    const childEnv = { ...env, NODE_OPTIONS: imports.map(path => `--import=${pathToFileURL(path).href}`).join(' ') };
    if (process.platform !== 'win32') return runConformanceProcess({ command: join(bin, alias), args, cwd, env: childEnv });
    if (powershell) return runConformanceProcess({ command: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', join(bin, `${alias}.ps1`), ...args], cwd, env: childEnv });
    return runConformanceProcess({ command: env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', `""${join(bin, `${alias}.cmd`)}" ${args.join(' ')}"`],
      windowsVerbatimArguments: true, cwd, env: childEnv });
  };
  const update = async (args = [], imports = [transport]) => requireConformanceExit(
    await invoke(['update', ...args], imports), 'stable public update');
  let selection;
  return {
    async preview() {
      const result = await update(['--all', '--dry-run']);
      assert.ok(result.stdout.includes(second));
      assert.ok(result.stdout.includes(third));
      assert.equal(existsSync(active), false);
      assert.equal(await read(receipt(second)), otherReceipt);
      assert.equal(await read(receipt(third)), thirdReceipt);
    },
    async current() {
      await rm(receipt(project));
      await update();
      assert.equal(JSON.parse(await read(receipt(project))).version, version);
      assert.equal(JSON.parse(await read(configPath)).authoredSetting, 'preserve this');
      assert.equal(await read(join(project, '.void/PROJECT-DOCTRINE.md')), '# Authored doctrine\r\n');
      assert.equal(await read(receipt(second)), otherReceipt);
      assert.equal(await read(receipt(third)), thirdReceipt);
      await rename(pkg, `${pkg}-unavailable`);
      for (const alias of ['void-machine', 'voidmachine']) {
        const result = requireConformanceExit(await invoke(['--version'], [denied], alias, false, root), 'offline native launcher');
        assert.equal(result.stdout.trim(), version);
        if (process.platform === 'win32') {
          const ps = requireConformanceExit(await invoke(['--version'], [denied], alias, true, root), 'offline PowerShell shim');
          assert.equal(ps.stdout.trim(), version);
        }
      }
      for (const [rule, path, content] of [
        ['protected-file', '.env', 'synthetic fixture'],
        ['secret-content', 'example.ts', `AKIA${'Z'.repeat(16)}`],
      ]) {
        const result = await runConformanceProcess({ command: process.execPath,
          args: [join(project, '.void/hooks/_void-hook.mjs'), 'enforce', rule, 'claude'], cwd: project,
          env: { ...env, CLAUDE_PROJECT_DIR: project }, input: JSON.stringify({ hook_event_name: 'PreToolUse',
            tool_name: 'Write', tool_input: { file_path: join(project, path), content } }) });
        requireConformanceExit(result, `updated ${rule} protection`, [2]);
        assert.match(result.stderr, /PROTECTED_FILE|SECRET_IN_CONTENT/);
      }
    },
    async all() {
      await update(['--all']);
      assert.equal(await read(join(second, '.void/PROJECT-DOCTRINE.md')), 'Second project doctrine\n');
      assert.equal(JSON.parse(await read(receipt(second))).version, version);
      assert.equal(JSON.parse(await read(receipt(third))).version, version);
    },
    async ownership() {
      // Update, not offline hydrate, owns complete manifest/receipt recovery.
      // All three runtime selections have a current baseline after explicit all.
      const before = await Promise.all(projects.map(async cwd => JSON.parse(await read(receipt(cwd)))));
      for (const [index, cwd] of projects.entries()) {
        const required = ['.void/config.json', ...(cwd === second ? [] : ['CLAUDE.md', '.claude/settings.json']),
          ...(cwd === project ? [] : ['AGENTS.md', '.codex/hooks.json'])];
        for (const path of required) assert.ok(before[index].files.some(file => file.path === path),
          `stable update baseline lost ${path} in ${cwd}`);
        await rename(receipt(cwd), join(cwd, 'original-install-receipt.json'));
        if (cwd === second) await writeFile(receipt(cwd), JSON.stringify({ ...before[index], files: [] }));
      }
      await update(['--all']);
      for (const [index, cwd] of projects.entries()) {
        assert.deepEqual(JSON.parse(await read(receipt(cwd))), before[index],
          `stable update did not recover complete ownership for ${cwd}`);
        const privateSkill = join(cwd, cwd === second ? '.agents' : '.claude', 'skills/private/SKILL.md');
        assert.equal(await read(privateSkill), '# private user skill\n');
      }
      assert.equal(JSON.parse(await read(configPath)).authoredSetting, 'preserve this');
      assert.equal(await read(join(project, '.void/PROJECT-DOCTRINE.md')), '# Authored doctrine\r\n');
      assert.equal(await read(join(second, '.void/PROJECT-DOCTRINE.md')), 'Second project doctrine\n');
    },
    async interrupt() {
      selection = await read(active);
      await writeFile(managed, 'pre-interruption managed drift\n');
      const result = await invoke(['update'], [transport, interrupt]);
      assert.ok(result.outcome.kind === 'signaled' || (result.outcome.kind === 'exited' && result.outcome.code !== 0));
      assert.equal(await read(marker), 'after launcher rename, before active selection');
      assert.notEqual(await read(managed), 'pre-interruption managed drift\n');
      assert.equal(await read(active), selection);
      assert.ok(existsSync(join(home, '.void/cli/operation')));
    },
    async recover() {
      const result = await invoke(['update'], [denied]);
      assert.equal(result.outcome.kind, 'exited');
      assert.notEqual(result.outcome.code, 0);
      assert.match(result.stdout + result.stderr, /CONFORMANCE_OFFLINE/);
      assert.equal(await read(managed), 'pre-interruption managed drift\n');
      assert.equal(await read(active), selection);
      assert.equal(existsSync(join(home, '.void/cli/operation')), false);
    },
    async repeat() {
      await update();
      assert.notEqual(await read(managed), 'pre-interruption managed drift\n');
      const result = requireConformanceExit(await invoke(['--version'], [denied], 'void-machine', process.platform === 'win32'), 'recovered native shim');
      assert.equal(result.stdout.trim(), version);
    },
  };
}

export async function exerciseStableUpdate(temporary, tarball) {
  const proof = await prepareStableUpdate(temporary, tarball);
  for (const phase of ['preview', 'current', 'all', 'ownership', 'interrupt', 'recover', 'repeat']) {
    process.stdout.write(`stable update conformance (${process.platform}): ${phase}\n`);
    await proof[phase]();
  }
}
