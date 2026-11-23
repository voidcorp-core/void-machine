import { logger } from './logger.js';
// tdd-cover: e2e apps/graph-studio/src/data/load.test.ts
import { indexCost } from './data/cost.js';
import { resolveStudioBoot } from './data/load.js';
import { createGraph } from './render/graph.js';
import { startLive } from './render/live.js';
import { playFlow } from './render/flow.js';
import { type IntroGraph, playIntro } from './render/intro.js';
import { createReticle, moveReticleTo, type ReticleGraph } from './render/reticle.js';
import { buildOverlays } from './scene/overlays.js';
import { defaultViewState } from './scene/select.js';
import { workflowView } from './scene/workflow-view.js';
import { renderControls } from './ui/controls.js';
import { renderPanel } from './ui/panel.js';
import { mountScrubber } from './ui/scrubber.js';
import { renderWorkflowView } from './ui/workflow.js';

const sceneRoot = document.getElementById('scene');
if (!sceneRoot) throw new Error('graph-studio: #scene container missing');

// Boot is async: server-fed data (consumer `graph live`) is fetched, dev falls back to the
// build-time snapshot. Wrapped in a function so the module has no top-level await; a boot
// failure is surfaced in the container instead of leaving a blank screen.
void boot(sceneRoot).catch((err: unknown) => {
  logger.error('graph-studio.boot-failed', err);
  sceneRoot.textContent = `graph-studio failed to start: ${err instanceof Error ? err.message : String(err)}`;
});

async function boot(scene: HTMLElement): Promise<void> {
const { data, liveUrl } = await resolveStudioBoot();
const overlays = buildOverlays(data.findings, data.model.edges);
const costIndex = indexCost(data.cost);

const panel = document.createElement('div');
panel.className = 'panel';
const controls = document.createElement('div');
controls.className = 'controls';
document.body.append(panel, controls);

let state = defaultViewState();
const handle = createGraph(scene, data.model, overlays, data.usage, costIndex);
handle.setView(state);

// Live layer: the `void-machine graph live` server streams activations. Same-origin when
// server-fed (consumer), else the configured/dev URL — resolved in resolveStudioBoot.
const live = startLive(handle, data.model, liveUrl);
const scrubber = document.createElement('div');
scrubber.style.display = 'none';
document.body.append(scrubber);
mountScrubber(scrubber, live);

// Lock-on reticle: snaps onto the selected node, frames the camera, opens the HUD.
const reticle = createReticle(handle.graph as unknown as ReticleGraph);
handle.onNodeClick((node) => {
  // The focus render (graph.ts) pins the clicked node at the origin and owns the
  // camera framing, so the reticle lands on the origin (the hero) and we do NOT
  // call focusNode here -- doing so forced the camera to a degenerate (0,0,0).
  moveReticleTo(reticle, node);
  // Workflows layer on: a workflow-def opens its phase sub-view; off: it reads as a
  // normal node (standard dossier panel). Other node types always use the panel.
  if (node.type === 'workflow-def' && state.layers.workflows) {
    const meta = data.workflows[node.id] ?? { phases: [] };
    renderWorkflowView(panel, workflowView(data.model, node, meta));
  } else {
    renderPanel(panel, data.model, overlays, node, costIndex);
  }
});

renderControls(controls, {
  state,
  onChange: (next) => {
    state = next;
    handle.setView(next);
    live.setEnabled(next.layers.live);
    scrubber.style.display = next.layers.live ? 'flex' : 'none';
  },
  onPlayFlow: () => {
    const start = data.model.nodes.find((n) => n.id === 'skill:brainstorming') ?? data.model.nodes[0];
    if (start !== undefined) playFlow(handle.graph, data.model, start.id);
  },
});

// One-time boot intro (camera sweep + "SYSTEM ONLINE" overlay); skipped under reduced-motion.
playIntro(handle.graph as unknown as IntroGraph);
}
