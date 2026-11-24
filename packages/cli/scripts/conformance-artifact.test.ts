import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createArtifactManifest,
  requireCleanCheckoutStatus,
  verifyConformanceArtifact,
} from './conformance-artifact.mjs';
import { PRODUCT_IDENTITY } from '../../hook-runner/src/identity.js';

const SHA = '2b0e24dc054cf4b7bde36d2e346db341f31501a5';
const roots: string[] = [];

function fixture(): { root: string; tarball: string } {
  const root = mkdtempSync(join(tmpdir(), 'void-conformance-artifact-'));
  roots.push(root);
  const tarball = join(root, 'consumer.tgz');
  writeFileSync(tarball, 'packed bytes');
  writeFileSync(
    `${tarball}.json`,
    `${JSON.stringify(
      createArtifactManifest(Buffer.from('packed bytes'), {
        packageName: PRODUCT_IDENTITY.packageName,
        packageVersion: '3.6.0',
        sourceSha: SHA,
        runIdentity: 'local',
      }),
      null,
      2,
    )}\n`,
  );
  return { root, tarball };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('immutable consumer artifact', () => {
  it('refuses untracked source that the pack could otherwise attribute to HEAD', () => {
    expect(() =>
      requireCleanCheckoutStatus('?? packages/core/src/skills/untracked/SKILL.md', 'before'),
    ).toThrow(/checkout changed before pack/i);
  });

  it('binds package identity, source SHA and tarball bytes without ambient data', () => {
    const { tarball } = fixture();

    expect(verifyConformanceArtifact(tarball, SHA)).toMatchObject({
      schemaVersion: 1,
      packageName: PRODUCT_IDENTITY.packageName,
      packageVersion: '3.6.0',
      sourceSha: SHA,
        runIdentity: 'local',
      tarballSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('rejects byte substitution and evidence from another source SHA', () => {
    const { tarball } = fixture();
    writeFileSync(tarball, 'different bytes');
    expect(() => verifyConformanceArtifact(tarball, SHA)).toThrow(/digest|bytes/i);

    const second = fixture();
    expect(() => verifyConformanceArtifact(second.tarball, 'a'.repeat(40))).toThrow(/source SHA/i);
  });

  it('rejects an artifact path without a regular parent directory', () => {
    const { root } = fixture();
    const missing = join(root, 'missing', 'consumer.tgz');
    mkdirSync(join(root, 'other'));
    expect(() => verifyConformanceArtifact(missing, SHA)).toThrow(/artifact|tarball/i);
  });
});

it('rejects an artifact from another workflow run or package version', () => {
  const { tarball } = fixture();
  expect(() => verifyConformanceArtifact(tarball, SHA, { runIdentity: '12:2' }))
    .toThrow(/run/i);
  expect(() => verifyConformanceArtifact(tarball, SHA, { packageVersion: '9.9.9' }))
    .toThrow(/version/i);
});
