import { describe, expect, it } from 'vitest';
import { renderDocument, type CheatSheet } from './render.js';

const document: CheatSheet = {
  schemaVersion: 1, installation: 'absent', entries: [{
    id: 'skill:void-example', name: 'void-example', type: 'skill', pack: 'core',
    description: '</script><img src=x onerror="alert(1)"> [click](https://bad.invalid)',
    runtimes: ['codex'], invocations: [{ runtime: 'codex', text: '$void-example' }],
    triggers: ['tools: Write'], relatedIds: [],
    availability: [{ runtime: 'codex', state: 'absent', verified: false, reason: 'No installation.' }],
  }],
};
describe('offline discovery documents', () => {
  it.each(['markdown', 'html'] as const)('preserves every field for each added entry in %s', format => {
    const entries = ['first', 'newly-added'].map(name => ({
      id: `core:${name}`, name, type: 'specialist' as const, pack: 'pack-react',
      description: `Distinct description for ${name}`, runtimes: ['claude' as const, 'codex' as const],
      invocations: [{ runtime: 'codex' as const, text: `Delegate to ${name}` }],
      triggers: [`When: ${name} review`], relatedIds: [`agent:${name}`],
      availability: [{ runtime: 'codex' as const, state: 'unknown' as const, verified: false as const, reason: `Missing proof for ${name}` }],
    }));
    const result = renderDocument({ ...document, entries }, format);
    for (const entry of entries) {
      const section = format === 'html'
        ? result.split('<article').find(part => part.includes(`>${entry.name}</h2>`))?.split('</article>')[0]
        : result.split(`## ${entry.name}\n`)[1]?.split('\n## ')[0];
      expect(section).toBeDefined();
      for (const value of [entry.id, entry.name, entry.type, entry.pack, entry.description,
        ...entry.runtimes, ...entry.triggers, ...entry.relatedIds,
        ...entry.invocations.map(item => item.text),
        ...entry.availability.flatMap(item => [item.runtime, item.state, item.reason])]) {
        // The Markdown title is intentionally outside the section under test.
        if (format === 'markdown' && value === entry.name) continue;
        expect(section, `${format}: ${entry.id}: ${value}`).toContain(value);
      }
    }
  });
  it.each(['json', 'markdown', 'html'] as const)('preserves all projection facts in %s', format => {
    const result = renderDocument(document, format);
    for (const text of ['void-example', 'tools: Write', 'No installation.', 'absent', 'codex']) {
      expect(result).toContain(text);
    }
    const first = document.entries[0];
    if (first === undefined) throw new Error('fixture entry missing');
    const added = { ...document, entries: [...document.entries, { ...first, id: 'skill:void-added', name: 'void-added' }] };
    expect(renderDocument(added, format)).toContain('void-added');
  });
  // Moved from the CLI test with its extraction unchanged: the export carries the
  // whole catalogue as JSON, and each readable format must carry every identity of
  // it, in catalogue order, with no subprocess needed to say so.
  it.each(['html', 'markdown'] as const)('renders every catalogue identity, in order, in %s', format => {
    const first = document.entries[0];
    if (first === undefined) throw new Error('fixture entry missing');
    const kinds = [['agent:void-a', 'agent'], ['command:b', 'command'], ['core:c', 'specialist'],
      ['hook:d', 'hook'], ['skill:void-e', 'skill']] as const;
    const entries = kinds.map(([id, type]) => ({ ...first, id, type, name: id.slice(id.indexOf(':') + 1) }));
    const rendered = renderDocument({ ...document, entries }, format);
    const identities = format === 'html'
      ? [...rendered.matchAll(/<p class="meta">([^<]+?) ·/g)].map(match => match[1])
      : rendered.split('\n').filter(line => /^(skill|hook|agent|core|command):/.test(line)).map(line => line.split(' | ')[0]);
    expect(identities).toEqual(kinds.map(([id]) => id));
  });
  it('keeps metadata out of executable HTML and Markdown', () => {
    const html = renderDocument(document, 'html');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;/script&gt;');
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html).not.toMatch(/<(?:link|script)[^>]+(?:src|href)=/);
    const markdown = renderDocument(document, 'markdown');
    expect(markdown).not.toContain('<img');
    expect(markdown).not.toContain('[click](');
  });
  it('provides native labelled controls and readable content before enhancement', () => {
    const html = renderDocument(document, 'html');
    expect(html).toContain('id="search"');
    expect(html).toContain('for="search"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('No local installation');
    expect(html).toContain('@media print');
    expect(html).toMatch(/<article[^>]*data-entry/);
    expect(html).not.toMatch(/<article[^>]*hidden/);
  });
});
