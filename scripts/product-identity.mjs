// The product identity, for the plain-ESM scripts that cannot import TypeScript.
//
// It reads packages/core/src/data/identity.json relative to this file, never relative to the working
// directory: a guard that runs from a trusted checkout therefore reads the identity of that same
// checkout, never one a pull request brought along. The TypeScript accessor
// (packages/hook-runner/src/identity.ts) derives the same fields, and
// test/identity/product-identity.test.ts proves the two agree.

import { readFileSync } from 'node:fs';

const document = JSON.parse(
  readFileSync(new URL('../packages/core/src/data/identity.json', import.meta.url), 'utf8'),
);
const { owner, name } = document.repository;
const namespaces = [document.markers.namespace, ...document.markers.deprecated];

// Same derivation as parseProductIdentity; the contract test fails the moment they part.
function managed(pair) {
  const recognized = namespaces.map((namespace) => Object.freeze(pair(namespace)));
  return Object.freeze({ current: recognized[0], recognized: Object.freeze(recognized) });
}

export const PRODUCT_IDENTITY = Object.freeze({
  repository: Object.freeze({ owner, name }),
  repositorySlug: `${owner}/${name}`,
  repositoryUrl: `https://github.com/${owner}/${name}`,
  formerRepositorySlugs: Object.freeze(
    (document.repository.formerNames ?? []).map((former) => `${owner}/${former}`),
  ),
  packageName: document.packageName,
  formerPackages: Object.freeze(
    (document.formerPackages ?? []).map(({ name, lastMajor }) => Object.freeze({ name, lastMajor })),
  ),
  commands: Object.freeze({
    primary: document.commands.primary,
    aliases: Object.freeze([...document.commands.aliases]),
    deprecated: Object.freeze([...document.commands.deprecated]),
  }),
  markers: Object.freeze({
    agentDoc: managed((ns) => ({ begin: `<!-- ${ns}:begin -->`, end: `<!-- ${ns}:end -->` })),
    contextContinuity: managed((ns) => ({
      begin: `<!-- ${ns}:context-continuity:begin -->`,
      end: `<!-- ${ns}:context-continuity:end -->`,
    })),
    gitignore: managed((ns) => ({ begin: `# ${ns}:begin`, end: `# ${ns}:end` })),
  }),
  environment: Object.freeze({
    prefix: document.environment.prefix,
    deprecated: Object.freeze([...document.environment.deprecated]),
  }),
});
