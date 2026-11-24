import { adaptersFor } from '../runtime-adapters.js';
import { CORE_PLUGIN_NAME } from '../packs.js';

export interface WireSelfHostRuntimeInput {
  readonly artifactRoot: string;
  readonly overlayRoot: string;
  readonly finalRoot: string;
  readonly sourceHash: string;
}

export type WireSelfHostRuntimeSurfaces = (
  input: WireSelfHostRuntimeInput,
) => Promise<void>;

/**
 * Runtime adapter entry point compiled from the checkout for source self-host.
 * Keep orchestration in compile.ts; this module owns only adapter execution.
 */
export const wireSelfHostRuntimeSurfaces: WireSelfHostRuntimeSurfaces = async (
  input,
) => {
  for (const adapter of adaptersFor(['claude', 'codex'])) {
    await adapter.wire({
      stageRoot: input.artifactRoot,
      installRoot: input.finalRoot,
      sourceRoot: input.overlayRoot,
      enabledPlugins: [CORE_PLUGIN_NAME],
      enabledPacks: [],
      source: 'local',
      marketplaceRepo: '',
      pinVersion: undefined,
    });
  }
};
