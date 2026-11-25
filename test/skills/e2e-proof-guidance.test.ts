import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').toLowerCase();

const testing = read('packages/core/src/skills/void-testing/SKILL.md');
const next = read('packages/packs/pack-nextjs/src/claude/modules/01-nextjs.md');
const server = read('packages/packs/pack-server/src/claude/modules/01-server.md');

describe('release E2E guidance', () => {
  it('keeps immutable artifact proof separate from local development feedback', () => {
    expect(testing).toContain('immutable deployable artifact');
    expect(testing).toMatch(/build\s+readiness/);
    expect(next).toContain('next dev');
    expect(next).toContain('next build');
    expect(next).toContain('deployment-equivalent');
    expect(next).toMatch(/next dev.{0,80}local feedback/);
    expect(next).toMatch(/never release proof/);
  });

  it('uses the lowest faithful fixture boundary and preserves the UI auth path', () => {
    expect(testing).toContain('lowest faithful boundary');
    expect(next).toContain('observable process readiness');
    expect(server).toMatch(/server\/api fixture\s+boundary/);
    expect(server).toMatch(/authentication ui path/);
  });

  it('requires namespaced state and bounded idempotent cleanup', () => {
    expect(testing).toContain('namespaced per run/worker');
    expect(testing).toContain('idempotent');
    expect(testing).toMatch(/cleanup is idempotent and bounded/);
    expect(next).toContain('worker');
  });

  it('does not turn security controls off to make E2E green', () => {
    expect(testing).toContain('test-only security override');
    expect(testing).toMatch(/production\s+defaults/);
    expect(server).toContain('does not disable rate limiting');
    expect(server).toContain('429');
    expect(server).toContain('malformed');
  });

  it('does not recommend retries or assertion-timeout inflation as flake fixes', () => {
    expect(testing).toContain('no retry');
    expect(testing).toMatch(/assertion[-\s]timeout/);
    expect(next).toMatch(/do not hide compilation/);
  });
});
