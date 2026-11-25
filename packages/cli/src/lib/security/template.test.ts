// The CI template ships to consumers, so its defects ship too.
//
// A template is copied once and read never again. Whatever it does on the day
// it is pasted in is what it will keep doing, which makes these properties
// worth a gate rather than a review comment.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

const TEMPLATE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'core',
  'src',
  'templates',
  'github',
  'void-security.yml',
);

const SOURCE = readFileSync(TEMPLATE, 'utf8');

function workflow() {
  const document = parseDocument(SOURCE, { strict: true, uniqueKeys: true, version: '1.2' });

  expect(document.errors.map((error) => error.message)).toEqual([]);
  return z.object({
    jobs: z.object({ baseline: z.object({
      steps: z.array(z.object({ uses: z.string().optional() })),
      'timeout-minutes': z.number(),
    }) }),
    on: z.object({ schedule: z.array(z.object({ cron: z.string() })), workflow_dispatch: z.unknown() }),
    permissions: z.record(z.string(), z.string()),
  }).parse(document.toJS({ maxAliasCount: 0 }));
}

describe('the shipped CI template', () => {
  it('is valid YAML with the jobs GitHub expects', () => {
    const parsed = workflow();

    expect(parsed.jobs?.baseline?.steps?.length).toBeGreaterThan(0);
  });

  it('offers a schedule and a manual trigger, so the cadence can be changed and forced', () => {
    // `on` is the YAML 1.1 boolean `true` in some parsers; 1.2 keeps it a string.
    const parsed = workflow();
    const triggers = parsed.on;

    expect(Object.keys(triggers)).toEqual(expect.arrayContaining(['schedule', 'workflow_dispatch']));
    expect(triggers.schedule[0]?.cron).toMatch(/^\S+ \S+ \S+ \S+ \S+$/);
  });

  it('pins every action by commit SHA, because a tag is mutable', () => {
    // Whoever can move a tag can choose what runs with this job's token.
    const parsed = workflow();
    const uses = parsed.jobs.baseline.steps
      .map((step) => step.uses)
      .filter((entry): entry is string => entry !== undefined);

    expect(uses.length).toBeGreaterThan(0);
    for (const entry of uses) {
      expect(entry, entry).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('names the version each SHA stands for, so the pin can be reviewed', () => {
    for (const line of SOURCE.split('\n')) {
      if (!line.includes('uses:')) continue;
      expect(line, line.trim()).toMatch(/#\s*v\d/);
    }
  });

  it('asks for no more permission than reading the code', () => {
    // A scanner needs to read the tree. Anything beyond that is a token worth
    // stealing sitting in a job that runs third-party tools.
    expect(workflow().permissions).toEqual({ contents: 'read' });
  });

  it('bounds the job, so a hung scan cannot hold a runner all day', () => {
    expect(workflow().jobs.baseline['timeout-minutes']).toBeGreaterThan(0);
  });

  it('depends on no security vendor to produce a result', () => {
    // The baseline must run with nothing installed and say so honestly. A
    // template that only works with a paid account is a vendor dependency
    // wearing a template's clothes.
    expect(SOURCE).not.toMatch(/SEMGREP_APP_TOKEN|SNYK_TOKEN|--config auto|secrets\.\w*(SNYK|SEMGREP)/);
  });

  it('never puts a scan target in the file', () => {
    // A DAST target needs an authorization checked at run time. One pasted into
    // a scheduled workflow outlives every grant that justified it.
    expect(SOURCE).not.toMatch(/--target\s+\S/);
  });
});
