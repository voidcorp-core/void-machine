import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type CandidateRequest, candidateRequestSchema, decodeCandidatePlan, prepareCandidatePlan } from './candidate-plan.js';
import { validateReleasePackage } from './update-release.js';

async function boundedFile(path: string, limit: number): Promise<string> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('Invalid bounded candidate protocol file');
  const bytes = await readFile(path);
  if (bytes.length > limit) throw new Error('Candidate protocol file exceeded limit');
  return bytes.toString('utf8');
}

export async function writeCandidatePlan(requestPath: string, responsePath: string): Promise<void> {
  const request = candidateRequestSchema.parse(JSON.parse(await boundedFile(requestPath, 8192)));
  const plan = await prepareCandidatePlan(request);
  await writeFile(responsePath, JSON.stringify(plan), { flag: 'wx', mode: 0o600 });
}

export async function prepareWithCandidate(packageRoot: string, request: CandidateRequest, workspace: string) {
  candidateRequestSchema.parse(request);
  const metadata = await validateReleasePackage(packageRoot, request.version);
  const stage = await mkdtemp(join(workspace, 'candidate-'));
  try {
    const requestPath = join(stage, 'request.json');
    const responsePath = join(stage, 'response.json');
    await writeFile(requestPath, JSON.stringify(request), { flag: 'wx', mode: 0o600 });
    const home = join(stage, 'home');
    const temporary = join(stage, 'tmp');
    await mkdir(home);
    await mkdir(temporary);
    const env: NodeJS.ProcessEnv = { HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
      TMPDIR: temporary, TEMP: temporary, TMP: temporary, VOID_GLOBAL_DIR: join(home, '.void') };
    for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'LANG', 'LC_ALL']) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    try {
      await promisify(execFile)(process.execPath, [join(packageRoot, 'bin/prepare-update.mjs'), requestPath, responsePath], {
        cwd: stage, env, timeout: 120_000, maxBuffer: 1024 * 1024, killSignal: 'SIGKILL', shell: false, windowsHide: true,
      });
    } catch (error) {
      const detail = error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
        ? error.stderr.slice(0, 4096) : 'no candidate diagnostic';
      throw new Error(`Candidate preparation failed without publication: ${detail}`);
    }
    const plan = decodeCandidatePlan(await boundedFile(responsePath, 192 * 1024 * 1024), request);
    for (const runtime of plan.runtimes) {
      if (!metadata.voidUpdate.runtimeAdapters.includes(runtime)) throw new Error(`Candidate release does not support runtime ${runtime}`);
    }
    return plan;
  } finally { await rm(stage, { recursive: true, force: true }); }
}
