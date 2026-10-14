import { describe, expect, it } from 'vitest';
import { secretContent } from './secret-content.js';

describe('secretContent', () => {
  it.each(['', '.test', '.spec'])('scans credential-named %s source modules even in exempt directories', (kind) => {
    const contents = ['-----BEGIN PRIVATE KEY-----', `AKIA${'A1'.repeat(8)}`, `SERVICE_TOKEN="${'Az19'.repeat(8)}"`];
    for (const extension of ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts']) {
      for (const directory of ['src', '__tests__', '__fixtures__', 'fixtures', '__generated__']) {
        for (const name of ['client-secrets', 'credentials']) {
          const path = `${directory}/${name}${kind}.${extension}`;
          for (const target of [path, path.toUpperCase().replaceAll('/', '\\')]) {
            for (const addedContent of contents) {
              const verdict = secretContent([{ path: target, addedContent }]);
              expect(verdict).toMatchObject({ allow: false, code: 'SECRET_IN_CONTENT' });
              expect(verdict.evidence).toEqual([`${target}:1`]);
            }
          }
        }
      }
    }
  });

  it('reuses content policy for placeholders, generated values and line-scoped allow markers', () => {
    const path = 'fixtures/client-secrets.test.mjs';
    const token = `AKIA${'A1'.repeat(8)}`;
    for (const addedContent of [
      'export const fixture = 1;', 'SERVICE_TOKEN="your_token_placeholder"',
      'SERVICE_TOKEN=process.env.SERVICE_TOKEN', `SERVICE_TOKEN="${'ab12'.repeat(8)}"`,
      `const token = ${JSON.stringify('AKIA')} + 'A1'.repeat(8);`,
      `${token} // allow-secret-pattern: intentional synthetic fixture`,
    ]) {
      expect(secretContent([{ path, addedContent }]).allow).toBe(true);
    }
    const verdict = secretContent([{
      path, addedContent: `${token} // allow-secret-pattern: first line only\n${token}`,
    }]);
    expect(verdict).toMatchObject({ allow: false, code: 'SECRET_IN_CONTENT' });
    expect(verdict.evidence).toEqual([`${path}:2`]);
  });

  it.each([
    'src/ordinary.test.ts', 'src/secret-directory/ordinary.test.ts',
    '/repo/fixtures/ordinary.ts', '/repo/__tests__/ordinary.ts', '/repo/__fixtures__/ordinary.ts',
    '/repo/__generated__/ordinary.ts', '/repo/fixtures/secrets.json',
    'fixtures/client-secrets.test.json', 'fixtures/client-secrets.test.mjs.bak',
  ])('preserves the unrelated fixture exemption for %s', (path) => {
    expect(secretContent([{ path, addedContent: `AKIA${'A1'.repeat(8)}` }]).allow).toBe(true);
  });

  it('blocks high-confidence tokens without committing a real-looking fixture', () => {
    const token = `AKIA${'A1'.repeat(8)}`;
    const verdict = secretContent([{ path: 'src/config.ts', addedContent: `export const key = '${token}';` }]);
    expect(verdict.allow).toBe(false);
    expect(verdict.evidence[0]).toContain('src/config.ts:1');
  });

  it('blocks mixed generic assignments and allows documented placeholders', () => {
    expect(secretContent([{
      path: 'src/config.ts',
      addedContent: 'SERVICE_TOKEN="abcGHJ1234567890abcGHJ123456"',
    }]).allow).toBe(false);
    expect(secretContent([{
      path: 'src/config.ts',
      addedContent: 'SERVICE_TOKEN="your_token_placeholder"',
    }]).allow).toBe(true);
  });

  it('exempts tests and an explicit allow tag', () => {
    const token = `AKIA${'A1'.repeat(8)}`;
    expect(secretContent([{ path: 'src/a.test.ts', addedContent: token }]).allow).toBe(true);
    expect(secretContent([{
      path: 'src/a.ts',
      addedContent: `${token} // allow-secret-pattern: generated fixture`,
    }]).allow).toBe(true);
  });
});
