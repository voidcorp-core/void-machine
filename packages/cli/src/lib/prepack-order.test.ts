import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  readonly scripts: Readonly<Record<string, string>>;
}

function commandsOf(script: string | undefined): readonly string[] {
  return (script ?? '')
    .split('&&')
    .map((command) => command.trim())
    .filter(Boolean);
}

describe('CLI clean-checkout build order', () => {
  const cliManifest = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as PackageManifest;
  const rootManifest = JSON.parse(
    readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'),
  ) as PackageManifest;

  it('builds CLI dependencies in topological order', () => {
    const commands = commandsOf(rootManifest.scripts['build:cli']);

    expect(commands).toContain('pnpm --filter @voidcorp/mission-engine build');
    expect(commands).toContain('pnpm --filter @voidcorp/harness-graph build');
    expect(commands).toContain('pnpm --filter @voidcorp/hook-runner build');
    expect(commands).toContain('pnpm --filter ./packages/cli build');
    expect(commands.indexOf('pnpm --filter @voidcorp/mission-engine build'))
      .toBeLessThan(commands.indexOf('pnpm --filter @voidcorp/harness-graph build'));
    expect(commands.indexOf('pnpm --filter @voidcorp/mission-engine build'))
      .toBeLessThan(commands.indexOf('pnpm --filter @voidcorp/hook-runner build'));
    expect(commands.indexOf('pnpm --filter @voidcorp/harness-graph build'))
      .toBeLessThan(commands.indexOf('pnpm --filter ./packages/cli build'));
    expect(commands.indexOf('pnpm --filter @voidcorp/hook-runner build'))
      .toBeLessThan(commands.indexOf('pnpm --filter ./packages/cli build'));
  });

  it('reuses the canonical build for prepack', () => {
    const prepack = commandsOf(cliManifest.scripts.prepack);

    expect(prepack[0]).toBe('pnpm -w build:cli');
  });
});
