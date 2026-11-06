import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..');

describe('scheduled stress proof workflow', () => {
  it('runs exact-SHA seeded campaigns without retries and retains their reports', () => {
    const source = readFileSync(
      resolve(ROOT, '.github', 'workflows', 'test-certification.yml'),
      'utf8',
    );

    expect(source).toContain('schedule:');
    const commands = [...source.matchAll(/^\s+(?:- )?run: (.+)$/gm)].map((match) => match[1]);
    expect(commands).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm build',
      'node scripts/stress-proof.mjs fast 20 10401',
      'node scripts/stress-proof.mjs complete 10 20401',
    ]);
    expect(source).not.toContain('continue-on-error:');
    expect(source).toContain('name: Build certification prerequisites');
    expect(source).toContain('scripts/stress-proof.mjs fast 20 10401');
    expect(source).toContain('scripts/stress-proof.mjs complete 10 20401');
    expect(source).toContain('actions/upload-artifact@');
    expect(source).toContain(['if: $', '{{ !cancelled() }}'].join(''));
    expect(source).not.toMatch(/retry|rerun/i);
  });
});
