// ═══════════════════════════════════════════════════════
// main.js — DagCity Entry Point (ES6 modules)
// Bootstraps all modules in correct order.
// ═══════════════════════════════════════════════════════
import { State } from './State.js';
import * as Visualizer from './Visualizer.js';
import {
  buildBuilding, buildEdge, startAnimationLoop, rebuildCity,
  meshes, nodeMap, nodeMeshMap, edgeObjs, voxels,
  updateFires, LAYER_X, initLabelRenderer, flyToNode,
  disposeCity, pauseAnimationLoop, setGraphicsQuality,
  setUserRenderDistance, getUserRenderDistance
} from './CityEngine.js';
import {
  initDock, initRaycaster, initSLA, initHUD,
  renderZoneSliders, renderNodeOverrides, loadSLAFromProject, updateSyncHUD
} from './UIManager.js';
import { initLiveSync, autoRestoreProject, connectLocal, initLivePipelineStatus } from './DataManager.js';
import { dashboardManager } from './DashboardManager.js';

// Load persisted configuration from localStorage
State.loadPersisted();

// ── 1. Initialise Three.js scene ──────────────────────
Visualizer.initScene();

// ── 1b. Initialise CSS2DRenderer for Data Volume labels ─
const canvasContainer = document.getElementById('canvas-container');
if (canvasContainer) {
  initLabelRenderer(canvasContainer);
}

function applyViewMode(mode) {
  const resolved = mode === '2d' ? '2d' : '3d';
  State.set('viewMode', resolved);

  const btn2d = document.getElementById('view-mode-2d');
  const btn3d = document.getElementById('view-mode-3d');
  if (btn2d) btn2d.classList.toggle('active', resolved === '2d');
  if (btn3d) btn3d.classList.toggle('active', resolved === '3d');

  const canvasContainer = document.getElementById('canvas-container');
  if (canvasContainer) canvasContainer.style.display = 'block';

  const graph2d = document.getElementById('graph2d-container');
  if (graph2d) graph2d.style.display = 'none';
}

function scoreNodeMatch(query, node) {
  const q = query.toLowerCase();
  const name = String(node.name || '').toLowerCase();
  if (!q) return 0;
  if (name === q) return 200;
  if (name.startsWith(q)) return 130;
  if (name.includes(q)) return 90;

  let qi = 0;
  let run = 0;
  let score = 0;
  for (let i = 0; i < name.length && qi < q.length; i++) {
    if (name[i] === q[qi]) {
      qi++;
      run++;
      score += 8 + run * 2;
    } else {
      run = 0;
    }
  }
  if (qi !== q.length) return -1;
  return score;
}

function initOmniSearch() {
  const launch = document.getElementById('omni-launch');
  const modal = document.getElementById('omni-modal');
  const input = document.getElementById('omni-input');
  const results = document.getElementById('omni-results');
  if (!launch || !modal || !input || !results) return;

  let activeIndex = -1;
  let currentHits = [];

  const renderHits = (query) => {
    const nodes = State.raw?.nodes || [];
    const ranked = nodes
      .map((node) => ({ node, score: scoreNodeMatch(query, node) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((x) => x.node);

    currentHits = ranked;
    activeIndex = ranked.length ? 0 : -1;

    if (!ranked.length) {
      results.innerHTML = '<div class="omni-item"><span>No results</span><span class="omni-meta">Try model name or layer</span></div>';
      return;
    }

    results.innerHTML = ranked.map((n, idx) => `
      <div class="omni-item ${idx === activeIndex ? 'active' : ''}" data-idx="${idx}">
        <span>${n.name}</span>
        <span class="omni-meta">${(n.layer || '').toUpperCase()} · ${(n.execution_time || 0).toFixed(2)}s</span>
      </div>
    `).join('');
  };

  const chooseNode = (node) => {
    if (!node) return;
    State.set('selectedNode', node);
    flyToNode(node.name || node.id);
    modal.classList.remove('open');
  };

  launch.addEventListener('click', () => {
    modal.classList.add('open');
    input.value = '';
    renderHits('');
    setTimeout(() => input.focus(), 0);
  });

  input.addEventListener('input', () => renderHits(input.value.trim()));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!currentHits.length) return;
      activeIndex = (activeIndex + 1) % currentHits.length;
      renderHits(input.value.trim());
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!currentHits.length) return;
      activeIndex = (activeIndex - 1 + currentHits.length) % currentHits.length;
      renderHits(input.value.trim());
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && currentHits[activeIndex]) {
        chooseNode(currentHits[activeIndex]);
      }
      return;
    }
    if (e.key === 'Escape') {
      modal.classList.remove('open');
    }
  });

  results.addEventListener('click', (e) => {
    const row = e.target.closest('.omni-item');
    if (!row) return;
    const idx = Number(row.dataset.idx);
    if (Number.isFinite(idx) && currentHits[idx]) chooseNode(currentHits[idx]);
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });

  document.addEventListener('keydown', (e) => {
    const shortcut = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
    if (!shortcut) return;
    e.preventDefault();
    modal.classList.add('open');
    input.value = '';
    renderHits('');
    setTimeout(() => input.focus(), 0);
  });
}

function initViewToggle() {
  applyViewMode(State.viewMode || '3d');
}

initViewToggle();
initOmniSearch();

// ── 2. Bootstrap UI controls ─────────────────────────
initDock();
initRaycaster(Visualizer.renderer, Visualizer.camera);
initSLA();
initHUD(Visualizer.renderer);

// Boot the sync indicator into a known state (no project loaded yet → OFFLINE).
// rebuildCity will refresh it whenever a project loads.
updateSyncHUD('offline');
window.addEventListener('dagcity:sync-source', (ev) => {
  updateSyncHUD(ev.detail && ev.detail.source);
});

// ── 2b. Graphics quality: bind slider + apply persisted state ─
// Single source of truth: setGraphicsQuality. Slider input AND boot use the
// exact same function. No other code path touches renderer/composer for graphics.
let savedGraphics = '1';
try {
  const stored = localStorage.getItem('dagcity_graphics');
  if (stored === '0' || stored === '1') {
    savedGraphics = stored;
  } else {
    savedGraphics = State.graphicsMode === 'low' ? '0' : '1';
  }
} catch (_) {
  savedGraphics = State.graphicsMode === 'low' ? '0' : '1';
}
const graphicsSlider = document.getElementById('graphics-slider');
if (graphicsSlider) {
  graphicsSlider.value = savedGraphics;
  graphicsSlider.addEventListener('input', (e) => {
    setGraphicsQuality(e.target.value);
  });
}
setGraphicsQuality(savedGraphics);

// ── 2c. Render Distance slider: bind + apply persisted state ──
// User-controlled camera.far. Read at boot from localStorage (handled inside
// CityEngine.setUserRenderDistance), bound to UI slider here, and applied to
// the camera immediately so it takes effect on the very first frame.
setUserRenderDistance(Infinity);

// Apply other persisted settings via the legacy bridge (labels/particles/neon)
if (typeof window.applySettingsToEngine === 'function') {
  window.applySettingsToEngine({
    showLabels: State.showLabels,
    showParticles: State.showParticles,
    neonIntensity: State.neonIntensity,
  });
}

// Expose Hub functions globally (called from HTML onclick)
window.connectLocal = connectLocal;


// ── 4. Initialize Dashboard Manager ─────────────────────
// Initialize dashboard manager for project management and UI transitions
const cityEngineAPI = {
  rebuildCity: (data) => {
    // Defensive cleanup before loading a new project
    disposeCity({ resetCamera: true });
    rebuildCity(data, false);
    // Ensure animation loop is running (idempotent)
    startAnimationLoop();
  },
  dispose: () => {
    disposeCity({ resetCamera: true });
  },
  pause: pauseAnimationLoop,
};
dashboardManager.init(cityEngineAPI);

// ── 5. Load initial data from server injection ────────
// SILENT BOOT: Do NOT auto-load projects on startup
// Only show dashboard and wait for user action
const RAW = window.__RAW__ || { status: 'awaiting_upload', nodes: [], links: [], metadata: {} };
State.set('raw', RAW);

const AWAITING_DATA = RAW.status === 'awaiting_upload';

if (AWAITING_DATA) {
  const overlay = document.getElementById('awaiting-overlay');
  if (overlay) overlay.style.display = 'flex';
  // Probe the environment and update the Live Pipeline panel
  initLivePipelineStatus();
} else {
  // SILENT BOOT: Even if data exists, do NOT auto-load
  // Show dashboard instead and let user choose to load
  const overlay = document.getElementById('awaiting-overlay');
  if (overlay) overlay.style.display = 'flex';
  console.log('[DagCity] Silent boot: Data available but not auto-loaded. User must select project.');
}

// ── 6. Start render loop ──────────────────────────────
startAnimationLoop();

// ── 7. Connect Live Sync (SSE) ────────────────────────
initLiveSync();

// ── 8. Auto-restore project if awaiting data ──────────
// DISABLED: Do not auto-restore on startup
// if (AWAITING_DATA) {
//   autoRestoreProject();
// }

console.log('[DagCity] v1.0 — One-Click Live Sync Ready 🚀');

