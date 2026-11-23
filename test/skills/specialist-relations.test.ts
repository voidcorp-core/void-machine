import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDeclaredEdges } from '../../packages/harness-graph/src/relations/load.js';

const ROOT = new URL('../../', import.meta.url);
const relations = loadDeclaredEdges(readFileSync(
  new URL('packages/harness-graph/relations.graph.yaml', ROOT),
  'utf8',
));
const specialistRoot = new URL('packages/core/specialists/', ROOT);
const specialistNames = readdirSync(specialistRoot)
  .filter((name) => name.endsWith('.yaml'))
  .map((name) => {
    const body = readFileSync(new URL(name, specialistRoot), 'utf8');
    const id = /^id:\s*(core:[a-z0-9-]+)\s*$/m.exec(body)?.[1];
    expect(id, join('packages/core/specialists', name)).toMatch(/^core:/);
    return String(id).slice('core:'.length);
  })
  .sort();
const profileRoot = new URL('packages/core/profiles/', ROOT);
const profileNames = readdirSync(profileRoot)
  .filter((name) => name.endsWith('.yaml'))
  .map((name) => name.slice(0, -'.yaml'.length))
  .sort();

describe('declared skill, agent, hook, and learn synergies', () => {
  it('connects void-implement to every canonical specialist agent', () => {
    const connected = relations
      .filter((edge) =>
        edge.from === 'skill:void-implement'
        && edge.to.startsWith('agent:')
        && edge.kind === 'composes')
      .map((edge) => edge.to.slice('agent:'.length))
      .filter((name) => specialistNames.includes(name))
      .sort();

    expect(connected).toEqual(specialistNames);
  });

  it('connects void-implement to every canonical stack profile', () => {
    const connected = relations
      .filter((edge) => edge.from === 'skill:void-implement' && edge.to.startsWith('profile:'))
      .map((edge) => edge.to.slice('profile:'.length))
      .sort();

    expect(connected).toEqual(profileNames);
  });

  it('declares the telemetry to audit to learn feedback loop', () => {
    expect(relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'hook:activation-meter', to: 'skill:void-graph' }),
      expect.objectContaining({ from: 'hook:outcome-meter', to: 'skill:void-graph' }),
      expect.objectContaining({ from: 'skill:void-graph', to: 'skill:void-audit' }),
      expect.objectContaining({ from: 'skill:void-audit', to: 'skill:void-learn' }),
      expect.objectContaining({ from: 'skill:void-retrospective', to: 'skill:void-learn' }),
    ]));
  });

  it('connects lifecycle and context hooks to the doctrine they support', () => {
    expect(relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'hook:secret-in-content', to: 'skill:void-security-guidance' }),
      expect.objectContaining({ from: 'hook:sessionstart-context', to: 'skill:void-context' }),
    ]));
  });

  it('connects direct lifecycle skills to learn, verify, and their specialist', () => {
    expect(relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'skill:void-checkpoint', to: 'skill:void-learn' }),
      expect.objectContaining({ from: 'skill:void-claude-md', to: 'skill:void-context' }),
      expect.objectContaining({ from: 'skill:void-doctor', to: 'skill:void-learn' }),
      expect.objectContaining({ from: 'skill:void-make-pdf', to: 'agent:pdf-specialist', kind: 'composes' }),
      expect.objectContaining({ from: 'skill:void-merge', to: 'skill:void-verify' }),
    ]));
  });
});
