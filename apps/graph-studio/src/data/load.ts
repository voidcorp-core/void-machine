import { logger } from '../logger.js';
import type {
  CostReport,
  Finding,
  GraphModel,
} from '@voidcorp/harness-graph';
import cost from '../generated/cost.json' with { type: 'json' };
import findings from '../generated/findings.json' with { type: 'json' };
import model from '../generated/model.json' with { type: 'json' };
import usage from '../generated/usage-summary.json' with { type: 'json' };
import workflows from '../generated/workflows.json' with { type: 'json' };
import type { UsageSummary, WorkflowMeta } from './types.js';

export interface StudioData {
  readonly model: GraphModel;
  readonly findings: readonly Finding[];
  readonly usage: UsageSummary;
  readonly workflows: Record<string, WorkflowMeta>;
  /** Per-component cost (from analyzeCost). Absent until a producer computes it. */
  readonly cost?: CostReport;
}

export function loadData(): StudioData {
  return {
    // prepare-data validates through CatalogGraph v3 before writing this read-only v1 projection.
    model: model as GraphModel,
    findings: findings as readonly Finding[],
    usage: usage as UsageSummary,
    workflows: workflows as Record<string, WorkflowMeta>,
    cost: cost as CostReport,
  };
}

/** Fetch the server-computed StudioData from a `graph live` server (same-origin). */
export async function loadDataFromServer(origin: string): Promise<StudioData> {
  const res = await fetch(`${origin}/studio-data.json`, { credentials: 'include' });
  if (!res.ok) throw new Error(`studio-data fetch failed: ${res.status}`);
  return (await res.json()) as StudioData;
}

export interface StudioBoot {
  readonly data: StudioData;
  /** Where the live SSE stream lives — same-origin when server-fed, else the configured URL. */
  readonly liveUrl: string;
}

/**
 * Pick the data source. When the studio is served by `void-machine graph live` (same-origin
 * /studio-data.json responds), it is consumer server-fed and the live stream is same-origin.
 * Otherwise (dev / static build) it falls back to the build-time snapshot.
 */
export async function resolveStudioBoot(): Promise<StudioBoot> {
  const origin = typeof location === 'undefined' ? '' : location.origin;
  if (origin.startsWith('http')) {
    try {
      return { data: await loadDataFromServer(origin), liveUrl: origin };
    } catch (err) {
      // Served from an http origin but the data fetch failed (server down, malformed payload).
      // Surface it, then fall back to the build-time snapshot so the studio still renders.
      logger.warn('graph-studio.snapshot-fallback', err);
    }
  }
  const configured = import.meta.env.VITE_LIVE_URL as string | undefined;
  return { data: loadData(), liveUrl: configured ?? 'http://localhost:4317' };
}
