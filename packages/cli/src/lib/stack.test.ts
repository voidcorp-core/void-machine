import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  commandsFor,
  detectPackageManager,
  detectProfileInput,
  detectStack,
  type Stack,
} from './stack.js';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'void-harness-stack-'));
}

function writePkg(root: string, pkg: object): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2));
}

describe('detectPackageManager', () => {
  it('reads packageManager field first', () => {
    const root = tmp();
    writePkg(root, { packageManager: 'pnpm@9.4.0' });
    writeFileSync(join(root, 'bun.lock'), '');
    expect(detectPackageManager(root)).toBe('pnpm');
  });

  it('falls back to lockfile when no packageManager field', () => {
    const root = tmp();
    writePkg(root, {});
    writeFileSync(join(root, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(root)).toBe('pnpm');
  });

  it('detects bun via bun.lock', () => {
    const root = tmp();
    writePkg(root, {});
    writeFileSync(join(root, 'bun.lock'), '');
    expect(detectPackageManager(root)).toBe('bun');
  });

  it('falls back to pnpm-workspace.yaml without lockfile', () => {
    const root = tmp();
    writePkg(root, {});
    writeFileSync(join(root, 'pnpm-workspace.yaml'), '');
    expect(detectPackageManager(root)).toBe('pnpm');
  });

  it('defaults to bun when nothing matches', () => {
    const root = tmp();
    writePkg(root, {});
    expect(detectPackageManager(root)).toBe('bun');
  });

  it('handles missing package.json (greenfield)', () => {
    const root = tmp();
    expect(detectPackageManager(root)).toBe('bun');
  });
});

describe('detectStack', () => {
  it('returns vitest + playwright when devDeps present', () => {
    const root = tmp();
    writePkg(root, {
      packageManager: 'pnpm@9.4.0',
      devDependencies: { vitest: '^2.0.0', '@playwright/test': '^1.0.0' },
    });
    const stack = detectStack(root);
    expect(stack.packageManager).toBe('pnpm');
    expect(stack.testRunner).toBe('vitest');
    expect(stack.e2eRunner).toBe('playwright');
  });

  it('returns jest + none when only jest present', () => {
    const root = tmp();
    writePkg(root, { devDependencies: { jest: '^29.0.0' } });
    const stack = detectStack(root);
    expect(stack.testRunner).toBe('jest');
    expect(stack.e2eRunner).toBe('none');
  });
});

describe('commandsFor', () => {
  it('uses pnpm exec for pnpm', () => {
    const stack: Stack = { packageManager: 'pnpm', testRunner: 'vitest', e2eRunner: 'playwright', mutationRunner: 'none' };
    const cmd = commandsFor(stack);
    expect(cmd.typecheck).toEqual(['pnpm', 'exec', 'tsc', '--noEmit']);
    expect(cmd.testUnit).toEqual(['pnpm', 'exec', 'vitest', 'run']);
    expect(cmd.testE2e).toEqual(['pnpm', 'exec', 'playwright', 'test']);
  });

  it('uses bunx for bun', () => {
    const stack: Stack = { packageManager: 'bun', testRunner: 'vitest', e2eRunner: 'playwright', mutationRunner: 'none' };
    expect(commandsFor(stack).typecheck).toEqual(['bunx', 'tsc', '--noEmit']);
  });

  it('uses npx for npm', () => {
    const stack: Stack = { packageManager: 'npm', testRunner: 'jest', e2eRunner: 'none', mutationRunner: 'none' };
    const cmd = commandsFor(stack);
    expect(cmd.typecheck).toEqual(['npx', 'tsc', '--noEmit']);
    expect(cmd.testUnit).toEqual(['npx', 'jest']);
  });

  it('uses yarn dlx-equivalent for yarn', () => {
    const stack: Stack = { packageManager: 'yarn', testRunner: 'vitest', e2eRunner: 'none', mutationRunner: 'none' };
    expect(commandsFor(stack).typecheck).toEqual(['yarn', 'tsc', '--noEmit']);
  });

  it('omits testE2e and mutation entirely when neither tool is detected', () => {
    const stack: Stack = { packageManager: 'pnpm', testRunner: 'vitest', e2eRunner: 'none', mutationRunner: 'none' };
    const cmd = commandsFor(stack);
    // No fabricated playwright/stryker command that would error on first run.
    expect('testE2e' in cmd).toBe(false);
    expect('mutation' in cmd).toBe(false);
  });

  it('emits mutation only when Stryker is present', () => {
    const withStryker: Stack = { packageManager: 'pnpm', testRunner: 'vitest', e2eRunner: 'none', mutationRunner: 'stryker' };
    expect(commandsFor(withStryker).mutation).toEqual(['pnpm', 'exec', 'stryker', 'run']);
  });
});

describe('detectMutationRunner', () => {
  it('detects Stryker from @stryker-mutator/core', () => {
    const root = tmp();
    writePkg(root, { devDependencies: { '@stryker-mutator/core': '^8.0.0' } });
    expect(detectStack(root).mutationRunner).toBe('stryker');
  });

  it('defaults to none with no Stryker signal', () => {
    const root = tmp();
    writePkg(root, { devDependencies: { vitest: '^2.0.0' } });
    expect(detectStack(root).mutationRunner).toBe('none');
  });
});

describe('detectProfileInput', () => {
  it('binds new mission inputs to the project Node declaration instead of the CLI runtime', () => {
    const root = tmp();
    writePkg(root, { engines: { node: '24.15.0' } });
    const first = detectProfileInput(root, [], 'project-v1');
    const version = Object.getOwnPropertyDescriptor(process.versions, 'node');
    if (!version) throw new Error('Node runtime version descriptor required');
    Object.defineProperty(process.versions, 'node', { ...version, value: '26.8.2' });
    try {
      const second = detectProfileInput(root, [], 'project-v1');
      expect(second).toEqual(first);
      expect(second.projects[0]?.technologies).toContainEqual({ id: 'node', version: '24.15.0',
        sources: ['package.json:engines.node'] });
    } finally { Object.defineProperty(process.versions, 'node', version); }
  });

  function monorepo(): string {
    const root = tmp();
    writePkg(root, {
      packageManager: 'pnpm@10.34.5',
      workspaces: ['apps/*', 'packages/*'],
      devDependencies: { typescript: '^5.9.2' },
    });
    writePkg(join(root, 'apps', 'web app'), {
      dependencies: { next: '^16.1.0', react: '^19.2.0' },
    });
    writePkg(join(root, 'apps', 'mobile'), {
      dependencies: { expo: '~55.0.0', 'react-native': '0.82.0' },
    });
    writePkg(join(root, 'packages', 'db'), {
      dependencies: { 'drizzle-orm': '^0.45.0' },
    });
    return root;
  }

  it('emits deterministic project-scoped technologies for a monorepo with spaces', () => {
    const detected = detectProfileInput(monorepo(), [
      'packages/db/migrations/001.sql',
      'apps/web app/app/page.tsx',
    ]);

    expect(detected).toMatchObject({
      schemaVersion: 1,
      status: 'complete',
      files: ['apps/web app/app/page.tsx', 'packages/db/migrations/001.sql'],
    });
    expect(detected.projects.map((project) => project.path)).toEqual([
      '.',
      'apps/mobile',
      'apps/web app',
      'packages/db',
    ]);
    expect(detected.projects.find((project) => project.path === '.')?.technologies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'node', version: expect.stringMatching(/^\d+\.\d+\.\d+$/) }),
        expect.objectContaining({ id: 'pnpm', version: '10.34.5' }),
        expect.objectContaining({ id: 'typescript', version: '5.9.2' }),
      ]),
    );
    expect(detected.projects.find((project) => project.path === 'apps/web app')?.technologies).toEqual([
      { id: 'nextjs', version: '16.1.0', sources: ['apps/web app/package.json:next'] },
      { id: 'react', version: '19.2.0', sources: ['apps/web app/package.json:react'] },
    ]);
  });

  it('marks an unparseable workspace dependency version unknown instead of guessing', () => {
    const root = tmp();
    writePkg(root, { workspaces: ['packages/*'] });
    writePkg(join(root, 'packages', 'shared'), {
      dependencies: { typescript: 'workspace:*' },
    });

    expect(detectProfileInput(root, ['packages/shared/index.ts']).projects[1]?.technologies).toEqual([
      { id: 'typescript', version: null, sources: ['packages/shared/package.json:typescript'] },
    ]);
  });

  it('rejects traversal in changed-file inputs', () => {
    expect(() => detectProfileInput(monorepo(), ['../outside.ts'])).toThrow(
      /PROFILE_INPUT_INVALID/,
    );
  });
});
