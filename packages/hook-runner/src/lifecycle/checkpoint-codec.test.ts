import { describe, expect, it } from 'vitest';
import { PRODUCT_IDENTITY } from '../identity.js';
import { parseCheckpoint } from './checkpoint-codec.js';

const { recognized } = PRODUCT_IDENTITY.markers.contextContinuity;

describe('the checkpoint codec of this product', () => {
  it('reads a checkpoint whose mechanical block carries a former name', () => {
    const former = recognized.at(-1);
    expect(former).toBeDefined();
    if (former === undefined) return;
    const raw = `## Objective\n\nShip it.\n\n${former.begin}\nnot a block\n${former.end}\n`;
    const checkpoint = parseCheckpoint(raw);
    expect(checkpoint.objective).toBe('Ship it.');
    expect(checkpoint).not.toHaveProperty('mechanicalContext');
  });

});


it('shares the work prose codec without the list length limit', () => {
  const reference = `/worktree/${'exact-project-path/'.repeat(20)}A-1`;
  expect(parseCheckpoint(`## Engaged work\n\n${reference}\n\n## Planned work\n\nA-3\nA-2\n`)).toMatchObject({
    engagedWork: reference, plannedWork: 'A-3\nA-2', isEmpty: false,
  });
});
