#!/usr/bin/env node
// Inspect the one supported npm delivery, produced by pnpm with its lifecycle.
// Release publishes those verified bytes using npm publish --ignore-scripts.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withCliArtifact } from '../packages/cli/scripts/conformance-artifact.mjs';
import { PRODUCT_IDENTITY } from './product-identity.mjs';

export function checkPublishSafety(tarball) {
  const pkg = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], {
    encoding: 'utf8', maxBuffer: 1_048_576,
  }));
  if (pkg.name !== PRODUCT_IDENTITY.packageName) throw new Error('unexpected published package identity');
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (String(range).startsWith('workspace:')) {
        throw new Error(`workspace: specifier survived in ${field}.${name}: ${range}`);
      }
    }
  }
  process.stdout.write('check-publish-safety: CLI tarball has no unresolved workspace references.\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await withCliArtifact(checkPublishSafety); }
  catch (error) {
    process.stderr.write(`check-publish-safety: ${error.message}\n`);
    process.exitCode = 1;
  }
}
