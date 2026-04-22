// ═══════════════════════════════════════════════════════
// main.js — DagCity Entry Point (ES6 modules)
// Bootstraps all modules in correct order.
// ═══════════════════════════════════════════════════════
import { State } from './State.js';
import * as Visualizer from './Visualizer.js';
import {
  buildBuilding, buildEdge, startAnimationLoop, rebuildCity,
  meshes, nodeMap, nodeMeshMap, edgeObjs, voxels,
  updateFires, LAYER_X
} from './CityEngine.js';
import {
  initDock, initRaycaster, initSLA, initHUD,
  renderZoneSliders, renderNodeOverrides, loadSLAFromProject
} from './UIManager.js';
import { initLiveSync, autoRestoreProject } from './DataManager.js';

// ── 1. Initialise Three.js scene ──────────────────────
Visualizer.initScene();

// ── 2. Bootstrap UI controls ─────────────────────────
initDock();
initRaycaster(Visualizer.renderer, Visualizer.camera);
initSLA();
initHUD(Visualizer.renderer);


// ── 3. Load initial data from server injection ────────
const RAW = window.__RAW__ || { status: 'awaiting_upload', nodes: [], links: [], metadata: {} };
State.set('raw', RAW);

const AWAITING_DATA = RAW.status === 'awaiting_upload';

if (AWAITING_DATA) {
  const overlay = document.getElementById('awaiting-overlay');
  if (overlay) overlay.style.display = 'flex';
} else {
  // Position nodes by layer
  const lCnt = {}, lIdx = {};
  RAW.nodes.forEach(n => { const l = n.layer||'default'; lCnt[l]=(lCnt[l]||0)+1; lIdx[l]=0; });
  RAW.nodes.forEach(n => {
    const l = n.layer||'default';
    n.x = LAYER_X[l] ?? 0;
    n.z = (lIdx[l] - (lCnt[l]-1)/2) * 70;
    n.y = 0; lIdx[l]++;
    nodeMap[n.id] = n;
  });
  RAW.nodes.forEach(n => buildBuilding(n));
  RAW.links.forEach(l => buildEdge(l));

  // Load SLA after building the city
  loadSLAFromProject(RAW);
  renderZoneSliders();
  renderNodeOverrides();
  updateFires();

  // Update stats
  const hasRealNew = RAW.metadata?.has_real_times || false;
  const stats = document.getElementById('stats');
  if (stats) stats.innerHTML =
    `NODES&nbsp;<span style="color:#fff">${RAW.nodes.length}</span><br>EDGES&nbsp;<span style="color:#fff">${RAW.links?.length||0}</span><br>${hasRealNew?`<span style="color:var(--green)">✓ REAL TIMES</span>`:`<span style="color:var(--orange)">∼ SIMULATED</span>`}`;
}

// ── 4. Start render loop ──────────────────────────────
startAnimationLoop();

// ── 5. Connect Live Sync (SSE) ────────────────────────
initLiveSync();

// ── 6. Auto-restore project if awaiting data ──────────
if (AWAITING_DATA) {
  autoRestoreProject();
}

console.log('[DagCity] v5.0 — Modular Engine Ready 🚀');
