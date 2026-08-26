import { describe, expect, it } from 'vitest';
import type { DecisionRecord } from './types.js';
import { renderDecisionsJson, renderDecisionsMarkdown } from './render.js';

function record(
  id: string,
  createdAt: string,
  supersedes: readonly string[] = [],
): DecisionRecord {
  return {
    schemaVersion: 1,
    id,
    createdAt,
    title: id,
    status: 'accepted',
    deciders: ['folpe'],
    supersedes,
    body: `# ${id}`,
    file: `${id}.md`,
    legacy: false,
  };
}

describe('decision projections', () => {
  it('renders newest first without writing an index', () => {
    const markdown = renderDecisionsMarkdown([
      record('adr:old', '2026-07-23T00:00:00.000Z'),
      record('adr:new', '2026-07-24T00:00:00.000Z'),
    ]);

    expect(markdown.indexOf('adr:new')).toBeLessThan(markdown.indexOf('adr:old'));
    expect(markdown).toContain('Generated view only');
  });

  it('renders stable JSON with a schema version', () => {
    expect(JSON.parse(renderDecisionsJson([record('adr:one', '2026-07-24')]))).toEqual({
      schemaVersion: 1,
      decisions: [
        expect.objectContaining({
          id: 'adr:one',
          status: 'accepted',
        }),
      ],
    });
  });

  it('exposes effective supersession without rewriting the older record', () => {
    const old = record('adr:old', '2026-07-23T00:00:00.000Z');
    const replacement = record(
      'adr:replacement',
      '2026-07-24T00:00:00.000Z',
      ['adr:old'],
    );

    expect(JSON.parse(renderDecisionsJson([old, replacement]))).toEqual(
      expect.objectContaining({
        decisions: expect.arrayContaining([
          expect.objectContaining({
            id: 'adr:old',
            status: 'superseded',
            declaredStatus: 'accepted',
            supersededBy: ['adr:replacement'],
          }),
        ]),
      }),
    );
    expect(renderDecisionsMarkdown([old, replacement])).toContain(
      'adr:old` (superseded by `adr:replacement`)',
    );
    expect(old.status).toBe('accepted');
  });
});
