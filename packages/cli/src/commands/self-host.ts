import { isHarnessSourceRepo } from '../lib/self-repo.js';
import {
  syncSelfHost,
} from '../lib/self-host/compile.js';
import {
  diagnoseSelfHost,
  type SelfHostDiagnosis,
  type SelfHostState,
} from '../lib/self-host/doctor.js';
import { banner, blank, c, footer, glyph, line, meta } from '../lib/render.js';
import { PRODUCT_COMMAND } from '@voidcorp/hook-runner';

type SelfHostArgs = { readonly action: 'sync' | 'doctor' };

export function parseSelfHostArgs(args: readonly string[]): SelfHostArgs {
  const action = args[0];
  if (action !== 'sync' && action !== 'doctor') {
    throw new Error('self-host expects sync or doctor');
  }
  if (args.some((arg) => arg === '--mode' || arg.startsWith('--mode='))) {
    throw new Error('self-host --mode was removed; structural validation is always enforced');
  }
  if (args.length !== 1) throw new Error('self-host accepts no options');
  return { action };
}

export function selfHostExitCode(state: SelfHostState): number {
  return state === 'not-installed' || state === 'stale' || state === 'drifted' ? 2 : 0;
}

function renderDiagnosis(diagnosis: SelfHostDiagnosis): void {
  banner('self-host doctor');
  meta('artifact', diagnosis.artifactRoot);
  blank();
  for (const check of diagnosis.checks) {
    const mark = check.status === 'ok'
      ? c.green(glyph.check)
      : check.status === 'degraded'
        ? c.yellow('?')
        : c.red('x');
    line(`${mark}  ${c.dim(check.id.padEnd(18))}${check.detail}`);
  }
  const renderedState = diagnosis.state === 'healthy'
    ? c.green(diagnosis.state)
    : diagnosis.blocking
      ? c.red(diagnosis.state)
      : c.yellow(diagnosis.state);
  footer(`self-host ${renderedState}`);
}

export async function runSelfHostDoctor(root: string): Promise<SelfHostDiagnosis> {
  const diagnosis = await diagnoseSelfHost(root);
  renderDiagnosis(diagnosis);
  process.exitCode = selfHostExitCode(diagnosis.state);
  return diagnosis;
}

export async function selfHost(args: readonly string[]): Promise<void> {
  const root = process.cwd();
  if (!isHarnessSourceRepo(root)) {
    process.stderr.write(`self-host is only available inside the ${PRODUCT_COMMAND} source repository\n`);
    process.exitCode = 2;
    return;
  }
  let parsed: SelfHostArgs;
  try {
    parsed = parseSelfHostArgs(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid self-host arguments';
    process.stderr.write(`${message}\n`);
    process.exitCode = 2;
    return;
  }
  if (parsed.action === 'doctor') {
    await runSelfHostDoctor(root);
    return;
  }
  banner('self-host sync');
  const result = await syncSelfHost(root);
  meta('source', result.sourceHash.slice(0, 12));
  meta('artifact', result.artifactRoot);
  line(
    result.changed
      ? `${c.green(glyph.check)}  compiled and atomically published ${result.files} owned files`
      : `${c.green(glyph.check)}  current artifact already matches ${result.files} owned files`,
  );
  footer(result.changed ? 'self-host synchronized' : 'self-host unchanged');
}
