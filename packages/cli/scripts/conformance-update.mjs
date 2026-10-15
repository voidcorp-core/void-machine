// Actual packed-product qualification, shared by the focused probe and the OS
// install-conformance owner. Transport/interruption instrumentation lives only here.
import { PRODUCT_IDENTITY } from '../../../scripts/product-identity.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { conformanceArtifactFromEnvironment } from './conformance-artifact.mjs';
import { conformanceFixtureEnvironment, packageManagerCommand, requireConformanceExit,
  runConformanceProcess, runConformanceStep, safeConformanceDiagnostic } from './conformance-process.mjs';

const read = path => readFile(path, 'utf8');
const receipt = project => join(project, '.void/machine/receipts/install-v1.json');

// Reduced host mechanism only, not qualification of the real launcher.
export async function probePowerShellInput(home, env, execute = runConformanceProcess) {
  const plain = join(home, 'input-none.ps1');
  const consuming = join(home, 'input-read.ps1');
  await writeFile(plain, "[Console]::Error.WriteLine('plain-entered')\n[Console]::Out.Write('ready')\n[Console]::Error.WriteLine('plain-finished')\nexit 0\n", { flag: 'wx' });
  await writeFile(consuming, "[Console]::Error.WriteLine('input-before-read')\n$lines = @($input)\n[Console]::Error.WriteLine('input-after-read')\n[Console]::Out.Write(($lines -join '|'))\nexit 0\n", { flag: 'wx' });
  for (const [label, script, input, expected] of [
    ['no read, empty pipe', plain, undefined, 'ready'],
    ['read, empty pipe', consuming, undefined, ''],
    ['read, supplied line', consuming, 'fixture input\n', 'fixture input'],
  ]) {
    const result = requireConformanceExit(await execute({ command: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script], cwd: home, env, input,
      label: `PowerShell stdin probe: ${label}`, diagnosticStderr: true, diagnosticStdin: true }),
    `PowerShell stdin probe: ${label}`);
    assert.equal(result.stdout, expected);
  }
}

// Qualify original -File first; compare -Command only once, inside the same suite budget.
// PowerShell 5.1 about_Scripts: call operator gives the script its own scope;
// its exit sets LASTEXITCODE, which the outer command must explicitly return.
export async function measurePowerShellShim(options, execute = runConformanceProcess) {
  const { shim, args, cwd, env, label, control } = options;
  const flags = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'];
  const processOptions = { command: 'powershell.exe', cwd, env };
  if (control) {
    const result = requireConformanceExit(await execute({ ...processOptions,
      label: 'PowerShell output-only control', args: [...flags, "[Console]::Out.Write('ready')"] }),
    'PowerShell output-only control');
    assert.equal(result.stdout, 'ready');
  }
  const qualified = await execute({ ...processOptions, label: `${label} -File`,
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', shim, ...args] });
  if (!control || qualified.outcome.kind !== 'exited' || qualified.outcome.code !== 0) return qualified;
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const command = "$ErrorActionPreference = 'Stop'; $watch = [Diagnostics.Stopwatch]::StartNew(); "
    + "[Console]::Error.WriteLine('powershell-entered: before real shim'); "
    + `& ${[shim, ...args].map(quote).join(' ')}; $code = $LASTEXITCODE; `
    + "[Console]::Error.WriteLine(('powershell-returned: shimMs={0}; exit={1}' -f $watch.ElapsedMilliseconds, $code)); exit $code";
  const compared = requireConformanceExit(await execute({ ...processOptions,
    label: `${label} -Command comparison`, diagnosticStderr: true, args: [...flags, command] }),
  'PowerShell diagnostic comparison');
  assert.equal(compared.stdout, qualified.stdout);
  return qualified;
}

// This source is written only into the disposable fixture import, never the product.
// Node 24 documents the promisified execFile result's .child and raw error outputs.
export function stableUpdateTransportSource({ tarball, target, version, integrity }) {
  return `
    import fs from 'node:fs/promises';
    import cp from 'node:child_process';
    import {promisify} from 'node:util';
    import {basename} from 'node:path';
    import {syncBuiltinESMExports} from 'node:module';
    let bytes = 0;
    let sequence = 0;
    const emit = event => {
      const line = JSON.stringify(event) + '\\n';
      if (bytes + Buffer.byteLength(line) > 4096) return;
      bytes += Buffer.byteLength(line);
      process.stderr.write(line);
    };
    const begin = label => {
      const startedMs = performance.now();
      const id = ++sequence;
      emit({phase:'started', label, id, startedMs});
      return extra => emit({phase:'finished', label, id,
        durationMs:Math.round(performance.now() - startedMs), ...extra});
    };
    const execFile = cp.execFile;
    const custom = execFile[promisify.custom];
    const measure = (invoke, args) => {
      const name = basename(args[1]?.[0] ?? args[0]);
      const finish = begin(['npm-cli.js','void-machine.mjs','prepare-update.mjs'].includes(name) ? name : 'other child');
      let result;
      try { result = invoke(...args); }
      catch (error) { finish({code:error.code ?? 'thrown'}); throw error; }
      const child = result.child ?? result;
      child.once('close', (code, signal) => finish({code, ...(signal ? {signal} : {})}));
      return result;
    };
    cp.execFile = (...args) => measure((...values) => execFile(...values), args);
    Object.defineProperty(cp.execFile, promisify.custom, {
      value: (...args) => measure((...values) => custom(...values), args),
    });
    const rename = fs.rename;
    fs.rename = async (from, to) => {
      if (to !== ${JSON.stringify(target)}) return rename(from, to);
      const finish = begin('launcher publication');
      try { const result = await rename(from, to); finish({}); return result; }
      catch (error) { finish({code:error.code ?? 'thrown'}); throw error; }
    };
    syncBuiltinESMExports();
    const archive = await fs.readFile(${JSON.stringify(tarball)});
    const version = ${JSON.stringify(version)};
    const packageName = ${JSON.stringify(PRODUCT_IDENTITY.packageName)};
    const tarball = 'https://registry.npmjs.org/' + packageName + '/-/' + packageName + '-' + version + '.tgz';
    globalThis.fetch = async url => {
      const finish = begin(url === tarball ? 'archive' : 'metadata');
      try {
        if (url === tarball) return new Response(archive);
        if (url !== 'https://registry.npmjs.org/' + packageName + '/latest') throw new Error('Unexpected registry request');
        return new Response(JSON.stringify({name:packageName,version,dist:{tarball,integrity:${JSON.stringify(integrity)}}}));
      } finally { finish({}); }
    };
  `;
}

async function launcherState(path) {
  const info = await lstat(path);
  return { mode: info.mode & 0o777, link: info.isSymbolicLink(),
    content: info.isSymbolicLink() ? await readlink(path) : await read(path) };
}

// Isolate the batch-reader boundary: Node replaces its running adapter with the
// original npm bytes, then exits. Only Windows can prove cmd's actual behavior.
async function proveReplacedCommandExit(home, command, replacement, env) {
  const root = join(home, 'adapter replacement');
  await mkdir(root);
  const target = join(root, 'void-machine.cmd');
  for (const code of [37, 0]) {
    await writeFile(target, command);
    await writeFile(join(root, 'void-machine.mjs'), `
      import {writeFile, rename} from 'node:fs/promises';
      await writeFile(${JSON.stringify(`${target}.restore`)}, ${JSON.stringify(replacement)});
      await rename(${JSON.stringify(`${target}.restore`)}, ${JSON.stringify(target)});
      process.stdout.write(JSON.stringify(process.argv.slice(2)));
      process.exitCode = ${code};
    `);
    const result = await runConformanceProcess({ label: `replacement command exit ${code}`, command: env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', `""${target}" update "space value""`],
      windowsVerbatimArguments: true, cwd: root, env });
    const diagnostic = safeConformanceDiagnostic(JSON.stringify(result), 4096);
    assert.equal(result.stdout, JSON.stringify(['update', 'space value']), diagnostic);
    assert.equal(await read(target), replacement);
    assert.deepEqual(result.outcome, { kind: 'exited', code }, diagnostic);
  }
}

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
  if (process.platform === 'win32') await probePowerShellInput(home, env);
  const npm = packageManagerCommand('npm');
  await runConformanceStep('stable update npm-owned bootstrap', { command: npm.executable,
    args: [...npm.prefixArguments, 'install', '--global', '--prefix', prefix, '--offline',
      '--ignore-scripts', '--no-audit', '--no-fund', tarball], cwd: home, env });
  const pkg = join(prefix, ...(process.platform === 'win32' ? [] : ['lib']), `node_modules/${PRODUCT_IDENTITY.packageName}`);
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
  await writeFile(transport, stableUpdateTransportSource({ tarball, target, version,
    integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}` }));
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
  let powerShellControl = true;
  const invoke = (args, imports = [], alias = 'void-machine', powershell = false, cwd = project) => {
    const childEnv = { ...env, NODE_OPTIONS: imports.map(path => `--import=${pathToFileURL(path).href}`).join(' ') };
    const label = `native ${alias} ${args.join(' ')} (${powershell ? 'PowerShell' : 'default'}; ${imports.map(path => basename(path)).join(',')})`;
    if (process.platform !== 'win32') return runConformanceProcess({ label, diagnosticStderr: true,
      command: join(bin, alias), args, cwd, env: childEnv });
    if (powershell) {
      const control = powerShellControl;
      powerShellControl = false;
      return measurePowerShellShim({ label, shim: join(bin, `${alias}.ps1`), args,
        cwd, env: childEnv, control });
    }
    return runConformanceProcess({ label, diagnosticStderr: true, command: env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', `""${join(bin, `${alias}.cmd`)}" ${args.join(' ')}"`],
      windowsVerbatimArguments: true, cwd, env: childEnv });
  };
  const update = async (args = [], imports = [transport]) => requireConformanceExit(
    await invoke(['update', ...args], imports), 'stable public update');
  let selection;
  let originalLauncher;
  let originalReceipt;
  const bootstrapDenied = join(home, 'bootstrap-offline.mjs');
  return {
    async preview() {
      const result = await update(['--all', '--dry-run']);
      assert.ok(result.stdout.includes(second));
      assert.ok(result.stdout.includes(third));
      assert.equal(existsSync(active), false);
      assert.equal(await read(receipt(second)), otherReceipt);
      assert.equal(await read(receipt(third)), thirdReceipt);
    },
    async bootstrapInterrupt() {
      assert.equal(existsSync(active), false);
      originalLauncher = await launcherState(target);
      originalReceipt = await read(receipt(project));
      await writeFile(managed, 'bootstrap managed drift\n');
      const result = await invoke(['update'], [transport, interrupt]);
      assert.ok(result.outcome.kind === 'signaled' || (result.outcome.kind === 'exited' && result.outcome.code !== 0));
      assert.equal(await read(marker), 'after launcher rename, before active selection');
      assert.notDeepEqual(await launcherState(target), originalLauncher);
      assert.notEqual(await read(managed), 'bootstrap managed drift\n');
      assert.equal(existsSync(active), false);
      assert.ok(existsSync(join(home, '.void/cli/operation')));
      // Acquisition itself observes the restored state, proving recovery precedes it.
      await writeFile(bootstrapDenied, `
        import assert from 'node:assert/strict';
        import {lstat, readFile, readlink} from 'node:fs/promises';
        globalThis.fetch = async () => {
          const path = ${JSON.stringify(target)};
          const info = await lstat(path);
          assert.deepEqual({mode:info.mode & 0o777,link:info.isSymbolicLink(),
            content:info.isSymbolicLink() ? await readlink(path) : await readFile(path,'utf8')},
            ${JSON.stringify(originalLauncher)});
          assert.equal(await readFile(${JSON.stringify(managed)},'utf8'),'bootstrap managed drift\\n');
          assert.equal(await readFile(${JSON.stringify(receipt(project))},'utf8'),${JSON.stringify(originalReceipt)});
          await assert.rejects(lstat(${JSON.stringify(active)}), {code:'ENOENT'});
          await assert.rejects(lstat(${JSON.stringify(join(home, '.void/cli/operation'))}), {code:'ENOENT'});
          throw new Error('BOOTSTRAP_RECOVERED_BEFORE_ACQUISITION');
        };
      `);
    },
    async bootstrapRecover() {
      if (process.platform === 'win32') {
        await proveReplacedCommandExit(home, await read(target), originalLauncher.content, env);
      }
      const result = await invoke(['update'], [bootstrapDenied]);
      const diagnostic = safeConformanceDiagnostic(JSON.stringify(result), 4096);
      assert.equal(result.outcome.kind, 'exited', diagnostic);
      assert.notEqual(result.outcome.code, 0, diagnostic);
      assert.match(result.stdout + result.stderr, /BOOTSTRAP_RECOVERED_BEFORE_ACQUISITION/);
      assert.deepEqual(await launcherState(target), originalLauncher);
      assert.equal(await read(managed), 'bootstrap managed drift\n');
      assert.equal(await read(receipt(project)), originalReceipt);
      assert.equal(JSON.parse(await read(configPath)).authoredSetting, 'preserve this');
      assert.equal(existsSync(active), false);
      assert.equal(existsSync(join(home, '.void/cli/operation')), false);
      await rm(marker);
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
      for (const alias of ['void-machine', PRODUCT_IDENTITY.packageName]) {
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
        const result = await runConformanceProcess({ label: `installed hook ${rule}`, command: process.execPath,
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
  for (const phase of ['preview', 'bootstrapInterrupt', 'bootstrapRecover', 'current', 'all', 'ownership', 'interrupt', 'recover', 'repeat']) {
    const startedMs = performance.now();
    process.stdout.write(`${JSON.stringify({ phase: 'started', label: phase, startedMs })}\n`);
    await proof[phase]();
    process.stdout.write(`${JSON.stringify({ phase: 'finished', label: phase, startedMs,
      durationMs: Math.round(performance.now() - startedMs) })}\n`);
  }
}

// The consumer orchestrator gives this mandatory suite its own unchanged process
// budget. Importers share the same phases without starting another qualification.
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const { manifest, tarball } = await conformanceArtifactFromEnvironment();
  const temporary = await mkdtemp(join(tmpdir(), 'harness-update-conformance-'));
  try {
    await exerciseStableUpdate(temporary, tarball);
    process.stdout.write(`stable update conformance passed (${process.platform}) for ${manifest.sourceSha}\n`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
