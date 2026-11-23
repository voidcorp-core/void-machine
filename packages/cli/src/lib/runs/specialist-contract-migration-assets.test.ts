import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { loadSpecialists, parseSpecialistYaml } from '../specialists/load.js';
import { compileCodexSpecialist } from '../specialists/compile-codex.js';
import { observeSpecialistMigrationAssets } from './specialist-contract-migration.js';
const CORE = fileURLToPath(new URL('../../../../core/', import.meta.url));
const FROM = 'sha256:56c4ff8694184f0d8b3b4baa474b76cb60e2b49a7cd52be9cd0bd59542248dd1';
const TO = 'sha256:333f5d2cd8dc21cb5f059c926f5db5a19b8511e2a3dd7ea0764a40b4502c2ca3';
it('observes the exact released archive and actually installed v3 agent without installing anything', async () => {
  const root = await mkdtemp(join(tmpdir(), 'void-migration-assets-'));
  try {
    const visual = parseSpecialistYaml(await readFile(join(CORE, 'contract-history/visual-craft-director/v3.yaml'), 'utf8'), 'v3.yaml');
    if (!visual) throw new Error('Expected current visual contract.');
    const compiled = compileCodexSpecialist(visual);
    await mkdir(join(root, '.codex/agents'), { recursive: true });
    const path = join(root, compiled.relativePath);
    await writeFile(path, compiled.content);
    expect(await observeSpecialistMigrationAssets(CORE, root, 'codex')).toMatchObject({
      declaration: { id: 'visual-craft-director-v2-v3', fromVersion: 2, toVersion: 3,
        fromContractPath: 'contract-history/visual-craft-director/v2.yaml',
        fromContractSha256: FROM, toContractSha256: TO },
      observedFromContractSha256: FROM, observedToContractSha256: TO,
      nativeContractVersion: 3,
      nativeAgentSha256: `sha256:${createHash('sha256').update(compiled.content).digest('hex')}`,
    });
    expect(await readFile(path, 'utf8')).toBe(compiled.content);
    const current = (await loadSpecialists(CORE)).find(value => value.id === visual.id);
    if (!current) throw new Error('Expected current visual contract.');
    expect(current.version).toBe(4);
    await writeFile(path, compileCodexSpecialist(current).content);
    await expect(observeSpecialistMigrationAssets(CORE, root, 'codex'))
      .rejects.toThrow('SPECIALIST_CONTRACT_MIGRATION_NATIVE');
    await writeFile(path, compiled.content.replace('v3', 'v2'));
    await expect(observeSpecialistMigrationAssets(CORE, root, 'codex'))
      .rejects.toThrow('SPECIALIST_CONTRACT_MIGRATION_NATIVE');
  } finally { await rm(root, { recursive: true }); }
});
