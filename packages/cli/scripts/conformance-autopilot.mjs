#!/usr/bin/env node

// Does autopilot exist for someone who installed the package?
//
// Every other proof in this repository runs against the monorepo: the skill is
// read from `packages/core`, the command from `src/commands`, the workflow from
// a path that only exists here. All of it can be green while the published
// tarball ships none of it — a source-only success is exactly the false green
// this script exists to catch.
//
// So it receives the exact packed artifact, installs it into a throwaway project, and asks the
// consumer would: is the skill there for my runtime, is the command routed, does
// the CLI compute without a network, and is the retired surface really gone. It
// asserts on the INSTALLED tree, never on this repository.
//
// It contacts nothing. `autopilot plan` is pure computation over stdin, which is
// what makes a consumer-side proof possible at all without a tracker.

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRODUCT_IDENTITY } from '../../../scripts/product-identity.mjs';
import { installPackage } from './conformance-install.mjs';
import { conformanceArtifactFromEnvironment } from './conformance-artifact.mjs';
import { assertPortableConsumerSkill } from './conformance-autopilot-lib.mjs';
import {
  conformanceFixtureEnvironment,
  requireConformanceExit,
  runConformanceProcess,
} from './conformance-process.mjs';

function fail(message) {
  throw new Error(`autopilot conformance: ${message}`);
}

function requirePath(path, label) {
  if (!existsSync(path)) fail(`the installed tree has no ${label} (${path})`);
}

const temporary = await mkdtemp(join(tmpdir(), 'void-autopilot-conformance-'));


try {
  const { manifest, tarball } = await conformanceArtifactFromEnvironment();

  const bin = process.env.VOID_CONFORMANCE_BIN ?? await installPackage(temporary, tarball);

  for (const runtime of ['claude', 'codex']) {
    const fixture = join(temporary, `consumer-${runtime}`);
    await mkdir(join(fixture, 'tmp'), { recursive: true });
    await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'consumer', private: true }));
    const environment = conformanceFixtureEnvironment(fixture);

    const init = await runConformanceProcess({
      command: process.execPath,
      args: [bin, 'init', '--runtime', runtime, '--no-interactive'],
      cwd: fixture,
      env: environment,
    });
    requireConformanceExit(init, `autopilot conformance ${runtime} init`);

    // The skill and its adapter, in the directory this runtime actually reads.
    const home = runtime === 'codex' ? '.agents' : '.claude';
    requirePath(join(fixture, home, 'skills', 'void-autopilot', 'SKILL.md'), `${runtime} autopilot skill`);
    // No `.claude/commands/` assertion. Claude Code merged custom commands into
    // skills, and the install stopped writing that directory at all — a command
    // file was Claude-only while the harness targets three runtimes.

    // The retired surface must be gone from the shipped assets too, not only
    // from the source tree — a stale bundled asset is the failure mode a green
    // source suite cannot see.
    for (const stale of [
      join(fixture, home, 'skills', 'backlog-autopilot'),
      join(fixture, home, 'skills', 'autopilot'),
      // The cluster engine's fan-out, removed with the engine.
      join(fixture, home, 'skills', 'void-autopilot', 'workflows'),
      join(fixture, '.claude', 'commands'),
    ]) {
      if (existsSync(stale)) fail(`the installed tree still ships the retired surface (${stale})`);
    }

    const skill = await readFile(join(fixture, home, 'skills', 'void-autopilot', 'SKILL.md'), 'utf8');
    assertPortableConsumerSkill(skill);
    if (/in construction/i.test(skill)) fail(`${runtime} skill still announces itself as unfinished`);

    // The CLI computes, offline, from the installed package.
    const help = await runConformanceProcess({
      command: process.execPath,
      args: [bin, 'autopilot', '--help'],
      cwd: fixture,
      env: environment,
    });
    requireConformanceExit(help, 'autopilot --help');
    if (!help.stdout.includes('autopilot')) fail('autopilot --help printed no usage');

    // The kernel decides offline from the installed package: a judgment piped in
    // is admitted and rendered without GitHub, the tracker or an agent.
    const headSha = 'a'.repeat(40);
    const judged = await runConformanceProcess({
      command: process.execPath,
      args: [bin, 'autopilot', 'judgment', 'conflict-class'],
      cwd: fixture,
      env: environment,
      input: JSON.stringify({ headSha, class: 'semantic', reason: 'Both sides changed the grant.' }),
    });
    requireConformanceExit(judged, 'autopilot judgment conflict-class');
    if (!judged.stdout.includes('void-autopilot:conflict-class') || !judged.stdout.includes(headSha)) {
      fail('autopilot judgment printed no conflict-class block bound to its head');
    }

    // Merging is armed only on a verdict the programme consented to, on the
    // consumer's machine too: no invocation flag grants it.
    const armed = await runConformanceProcess({
      command: process.execPath,
      args: [bin, 'autopilot', 'next', '--auto-merge'],
      cwd: fixture,
      env: environment,
      input: '{}',
    });
    // Any failure is not enough: in this fixture `next` has no programme, so it
    // could fail for that reason alone. The refusal must name the flag.
    if (armed.outcome.kind !== 'exited' || armed.outcome.code === 0
      || !armed.stderr.includes('autopilot does not accept --auto-merge')) {
      fail('the installed CLI did not refuse --auto-merge by name');
    }

    // The cluster engine was removed, not left reachable under its old names.
    const clustered = await runConformanceProcess({
      command: process.execPath,
      args: [bin, 'autopilot', 'plan', '--json'],
      cwd: fixture,
      env: environment,
      input: '{}',
    });
    if (clustered.outcome.kind !== 'exited' || clustered.outcome.code === 0
      || !clustered.stderr.includes("autopilot has no 'plan' subcommand")) {
      fail('the installed CLI did not refuse the removed `autopilot plan` as unknown');
    }

    const retired = await runConformanceProcess({
      command: process.execPath,
      args: [bin, 'backlog-autopilot'],
      cwd: fixture,
      env: environment,
    });
    if (retired.outcome.kind !== 'exited' || retired.outcome.code === 0) {
      fail('the installed CLI did not refuse the retired command with a non-zero exit');
    }

    process.stdout.write(`autopilot conformance passed for ${runtime}.\n`);
  }

  process.stdout.write(
    `autopilot conformance passed (${process.platform}) for ${manifest.sourceSha}.\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
