#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  readFileSync,
  renameSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import {
  assertVersionEntries,
  createReleaseArtifactManifest,
  parseReleaseTag,
} from './release-artifact-contract.mjs';
import { packConformanceArtifact, verifyConformanceArtifact } from '../packages/cli/scripts/conformance-artifact.mjs';
import { checkPublishSafety } from './check-publish-safety.mjs';
import { checkPackageSize } from './check-package-size.mjs';
import { PRODUCT_IDENTITY } from './product-identity.mjs';

function requiredEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function output(name, value) {
  appendFileSync(requiredEnv('GITHUB_OUTPUT'), `${name}=${value}\n`);
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function resolveRelease() {
  const releaseTag = requiredEnv('RELEASE_TAG');
  const version = parseReleaseTag(releaseTag);
  const repository = requiredEnv('EXPECTED_REPOSITORY');
  if (repository !== PRODUCT_IDENTITY.repositorySlug) {
    throw new Error('release repository identity is not canonical');
  }
  const controlRoot = resolve(requiredEnv('CONTROL_ROOT'));
  const releaseCommit = git(controlRoot, [
    'rev-parse',
    '--verify',
    `refs/tags/${releaseTag}^{commit}`,
  ]);

  const ancestry = spawnSync(
    'git',
    ['-C', controlRoot, 'merge-base', '--is-ancestor', releaseCommit, 'origin/main'],
    { stdio: 'ignore' },
  );
  if (ancestry.status !== 0) {
    throw new Error(`release commit ${releaseCommit} is not an ancestor of protected main`);
  }

  const observedTag = execFileSync(
    'gh',
    ['api', `repos/${repository}/releases/tags/${releaseTag}`, '--jq', '.tag_name'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
  if (observedTag !== releaseTag) throw new Error('matching GitHub Release does not exist');

  output('release_tag', releaseTag);
  output('version', version);
  output('release_commit', releaseCommit);
}

function versionEntries(root) {
  const releasePlease = readJson(join(root, 'release-please-config.json'));
  const extraFiles = releasePlease.packages?.['.']?.['extra-files'];
  if (!Array.isArray(extraFiles) || extraFiles.length === 0) {
    throw new Error('release-please extra-files are missing');
  }

  const entries = extraFiles.map((entry) => {
    if (entry?.type !== 'json' || typeof entry.path !== 'string') {
      throw new Error('release-please extra-file is not a JSON manifest');
    }
    const document = readJson(join(root, entry.path));
    if (entry.jsonpath === '$.version') return { file: entry.path, version: document.version };
    if (entry.jsonpath === '$.harnessVersion') {
      return { file: entry.path, version: document.harnessVersion };
    }
    throw new Error(`unsupported release version path in ${entry.path}`);
  });
  const manifest = readJson(join(root, '.release-please-manifest.json'));
  return [{ file: '.release-please-manifest.json', version: manifest['.'] }, ...entries];
}

function releaseCandidate() {
  const releaseTag = requiredEnv('RELEASE_TAG');
  const version = parseReleaseTag(releaseTag);
  const releaseCommit = requiredEnv('RELEASE_COMMIT');
  const releaseTree = resolve(requiredEnv('RELEASE_TREE'));
  const artifactDir = resolve(requiredEnv('ARTIFACT_DIR'));

  if (git(releaseTree, ['rev-parse', 'HEAD']) !== releaseCommit) {
    throw new Error('checked-out release tree does not match the resolved release commit');
  }
  assertVersionEntries(version, versionEntries(releaseTree));
  const status = git(releaseTree, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status !== '') throw new Error(`release source checkout is not clean:\n${status}`);
  return { releaseTag, version, releaseCommit, releaseTree, artifactDir };
}

async function packArtifact() {
  requiredEnv('GITHUB_RUN_ID');
  requiredEnv('GITHUB_RUN_ATTEMPT');
  const candidate = releaseCandidate();
  // Current control owns generation order and metadata, even for historical tags.
  await packConformanceArtifact(candidate.artifactDir, candidate.releaseTree);
}

function checkArtifact() {
  const candidate = releaseCandidate();
  const tarball = join(candidate.artifactDir, 'consumer.tgz');
  verifyConformanceArtifact(tarball, candidate.releaseCommit, {
    packageVersion: candidate.version,
    runIdentity: `${requiredEnv('GITHUB_RUN_ID')}:${requiredEnv('GITHUB_RUN_ATTEMPT')}`,
  });
  checkPublishSafety(tarball);
  checkPackageSize(tarball);
}

function prepareArtifact() {
  const { releaseTag, version, releaseCommit, artifactDir } = releaseCandidate();

  const tarballNames = readdirSync(artifactDir).filter((name) => name.endsWith('.tgz'));
  if (tarballNames.length !== 1) {
    throw new Error('release artifact directory must contain exactly one tarball');
  }
  if (tarballNames[0] === 'consumer.tgz') {
    const source = join(artifactDir, 'consumer.tgz');
    verifyConformanceArtifact(source, releaseCommit, {
      packageVersion: version,
      runIdentity: `${requiredEnv('GITHUB_RUN_ID')}:${requiredEnv('GITHUB_RUN_ATTEMPT')}`,
    });
    const canonical = `${PRODUCT_IDENTITY.packageName}-${version}.tgz`;
    renameSync(source, join(artifactDir, canonical));
    tarballNames[0] = canonical;
  }
  const tarballPath = join(artifactDir, tarballNames[0]);
  const tarballBytes = readFileSync(tarballPath);
  const packageManifest = JSON.parse(
    execFileSync('tar', ['-xOf', tarballPath, 'package/package.json'], {
      encoding: 'utf8',
      maxBuffer: 1_048_576,
    }),
  );
  const manifest = createReleaseArtifactManifest({
    releaseTag,
    releaseCommit,
    packageManifest,
    tarballNames,
    tarballBytes,
  });
  const manifestPath = join(artifactDir, 'release-artifact.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });

  output('tarball_path', tarballPath);
  output('tarball_name', manifest.tarballName);
  output('manifest_path', manifestPath);
  output('sha256', manifest.sha256);
  output('integrity', manifest.integrity);
}

try {
  const command = process.argv[2];
  if (command === 'resolve') resolveRelease();
  else if (command === 'pack') await packArtifact();
  else if (command === 'check') checkArtifact();
  else if (command === 'prepare') prepareArtifact();
  else throw new Error('usage: prepare-release-artifact.mjs <resolve|pack|check|prepare>');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`prepare-release-artifact: ${message}\n`);
  process.exitCode = 1;
}
