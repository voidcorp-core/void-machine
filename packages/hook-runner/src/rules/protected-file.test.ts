import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { protectedFile } from './protected-file.js';
import { PRODUCT_IDENTITY } from '../identity.js';

function manifestRoot(paths: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), `${PRODUCT_IDENTITY.packageName}-ownership-`));
  mkdirSync(join(root, '.void'));
  writeFileSync(join(root, '.void/install-manifest.json'), JSON.stringify({
    files: paths.map((path) => ({ path })),
  }));
  return root;
}

describe('co-owned manifest paths', () => {
  it.each([
    '.gitignore', '.void/config.json', '.void/PROJECT-DOCTRINE.md',
    '.claude/settings.json', 'CLAUDE.md', 'AGENTS.md',
  ])('allows only the exact project path after normalization: %s', (path) => {
    const root = manifestRoot([path]);
    for (const target of [path, `./${path}`, `folder/../${path}`, join(root, path)]) {
      expect(protectedFile([target], { root })).toMatchObject({ allow: true, code: 'ALLOW' });
    }
    expect(protectedFile([path.replaceAll('/', '\\')], { root }).code).toBe('ALLOW');
  });

  it.each([
    '.claude/skills/void-tdd/SKILL.md', '.agents/skills/void-tdd/SKILL.md',
    '.claude/agents/reviewer.md', '.codex/agents/reviewer.toml',
    '.claude/commands/check.md', '.void/hooks/runner.mjs', '.codex/hooks.json',
    '.void/installed/PHILOSOPHY.md', 'nested/CLAUDE.md', 'nested/AGENTS.md',
    'nested/.void/config.json', '.void/PROJECT-DOCTRINE.md.bak', 'AGENTS.md.bak',
    'claude.md', 'agents.md', '.VOID/config.json', '.claude/settings.json/extra',
  ])('keeps manifest-owned assets and namesakes exclusive: %s', (path) => {
    const root = manifestRoot([path]);
    for (const target of [path, join(root, path)]) {
      const verdict = protectedFile([target], { root });
      expect(verdict).toMatchObject({ allow: false, code: 'PROTECTED_FILE' });
      expect(verdict.evidence).toEqual([
        `${target}: delivered harness asset; change the harness through void-learn`,
      ]);
    }
  });

  it.each(['.env.local', '.npmrc', 'private.key', 'pnpm-lock.yaml', '.git/config'])(
    'continues lexical checks after an allowed co-owned target: %s', (path) => {
      const root = manifestRoot(['AGENTS.md']);
      for (const paths of [['AGENTS.md', path], [path, 'AGENTS.md']]) {
        const verdict = protectedFile(paths, { root });
        expect(verdict).toMatchObject({ allow: false, code: 'PROTECTED_FILE' });
        expect(verdict.evidence[0]?.startsWith(`${path}:`)).toBe(true);
        expect(verdict.evidence[0]).not.toContain('delivered harness asset');
      }
    },
  );
});

describe('protectedFile', () => {
  it.each(['test', 'spec'])('refuses .%s credential source tests extracted from shell writes', (kind) => {
    for (const extension of ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts']) {
      const path = `fixtures/client-secrets.${kind}.${extension}`;
      for (const target of [path, path.toUpperCase().replaceAll('/', '\\')]) {
        expect(protectedFile([target], { shellWritePaths: [target] }))
          .toMatchObject({ allow: false, code: 'PROTECTED_FILE' });
      }
    }
  });

  it.each(['test', 'spec'])('allows credential-named .%s source files only', (kind) => {
    for (const extension of ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts']) {
      for (const name of ['client-secrets', 'credentials']) {
        const path = `src/${name}.${kind}.${extension}`;
        expect(protectedFile([path])).toMatchObject({ allow: true, code: 'ALLOW' });
        expect(protectedFile([path.toUpperCase().replaceAll('/', '\\')]).allow).toBe(true);
      }
    }
  });

  it.each([
    '.env.test.mjs', 'CONFIG\\.ENV.SPEC.TS',
    ...['pem', 'key', 'p12', 'pfx', 'keystore', 'jks', 'asc']
      .map((extension) => `client-secrets.test.${extension}`),
    ...['rsa', 'ed25519', 'ecdsa', 'dsa'].map((kind) => `.ssh/id_${kind}`),
    '.npmrc', '.netrc', '.pgpass', '.aws/credentials', 'secrets.json',
    'src/Credentials.ts', '__tests__/secrets.json', 'tests/credentials.mjs',
    'client-secrets.test.json', 'client-secrets.test.mjs.bak',
    'client-secrets.testmjs', 'client-secrets.test.py', 'client-secrets.tests.ts',
    '.git/client-secrets.test.mjs', '.GIT\\CLIENT-SECRETS.SPEC.TS',
    'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb',
    'cargo.lock', 'poetry.lock', 'composer.lock',
  ])('retains protection beside a source test in either order: %s', (path) => {
    for (const paths of [[path, 'client-secrets.test.mjs'], ['client-secrets.test.mjs', path]]) {
      const verdict = protectedFile(paths);
      expect(verdict).toMatchObject({ allow: false, code: 'PROTECTED_FILE' });
      expect(verdict.evidence[0]?.startsWith(`${path}:`)).toBe(true);
    }
  });

  it('keeps a manifest-owned source test protected', () => {
    const path = 'src/client-secrets.test.mjs';
    const root = manifestRoot([path]);
    const verdict = protectedFile([path], { root });
    expect(verdict).toMatchObject({ allow: false, code: 'PROTECTED_FILE' });
    expect(verdict.evidence[0]).toContain('delivered harness asset');
  });

  it.each([
    'apps/web/.env',
    'CONFIG/.ENV.LOCAL',
    'certs/server.pem',
    '/home/u/.ssh/id_rsa',
    'pnpm-lock.yaml',
    'bun.lock',
    'apps/web/BUN.LOCK',
    'bun.lockb',
    '.git/config',
    'src/Credentials.ts',
  ])('blocks %s', (path) => {
    expect(protectedFile([path]).allow).toBe(false);
  });

  it.each([
    '.env.example',
    'src/feature.ts',
    'docs/byo-credentials.md',
  ])('allows %s', (path) => {
    expect(protectedFile([path]).allow).toBe(true);
  });

  it('blocks a harness asset named by the install manifest and points to void-learn', () => {
    const root = mkdtempSync(join(tmpdir(), 'void-protected-file-'));
    mkdirSync(join(root, '.void'));
    writeFileSync(join(root, '.void/install-manifest.json'), JSON.stringify({
      schemaVersion: 1,
      version: '3.7.1',
      files: [{ path: '.claude/skills/void-tdd/SKILL.md', sha256: 'a'.repeat(64) }],
    }));

    const verdict = protectedFile(['.claude/skills/void-tdd/SKILL.md'], { root });

    expect(verdict.allow).toBe(false);
    expect(verdict.code).toBe('PROTECTED_FILE');
    expect(verdict.message).toContain('void-learn');
    expect(verdict.evidence[0]).toContain('delivered harness asset');
  });

  it('allows a project-owned skill even when a manifest exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'void-project-skill-'));
    mkdirSync(join(root, '.void'));
    writeFileSync(join(root, '.void/install-manifest.json'), JSON.stringify({
      schemaVersion: 1,
      version: '3.7.1',
      files: [{ path: '.claude/skills/void-tdd/SKILL.md', sha256: 'a'.repeat(64) }],
    }));

    expect(protectedFile(['.claude/skills/project-skill/SKILL.md'], { root }).allow).toBe(true);
  });
});
