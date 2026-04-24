// ═══════════════════════════════════════════════════════
// main.js — DagCity Entry Point (ES6 modules)
// Bootstraps all modules in correct order.
// ═══════════════════════════════════════════════════════
import { State } from './State.js';
import * as Visualizer from './Visualizer.js';
import {
  buildBuilding, buildEdge, startAnimationLoop, rebuildCity,
  meshes, nodeMap, nodeMeshMap, edgeObjs, voxels,
  updateFires, LAYER_X, initLabelRenderer, flyToNode
} from './CityEngine.js';
import {
  initDock, initRaycaster, initSLA, initHUD,
  renderZoneSliders, renderNodeOverrides, loadSLAFromProject
} from './UIManager.js';
import { initLiveSync, autoRestoreProject, connectLocal, initLivePipelineStatus } from './DataManager.js';
import {
  initDAGView2D,
  rebuildDAGView2D,
  showDAGView2D,
  hideDAGView2D,
  focusNode2D,
} from './DAGView2D.js';

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
  if (canvasContainer) canvasContainer.style.display = resolved === '3d' ? 'block' : 'none';

  if (resolved === '2d') {
    showDAGView2D();
  } else {
    hideDAGView2D();
  }

  const selected = State.selectedNode;
  if (selected) {
    if (resolved === '3d') flyToNode(selected.name || selected.id);
    else focusNode2D(selected.name || selected.id);
  }
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
    if (State.viewMode === '2d') focusNode2D(node.name || node.id);
    else flyToNode(node.name || node.id);
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
  const btn2d = document.getElementById('view-mode-2d');
  const btn3d = document.getElementById('view-mode-3d');
  if (btn2d) btn2d.addEventListener('click', () => applyViewMode('2d'));
  if (btn3d) btn3d.addEventListener('click', () => applyViewMode('3d'));

  State.on('city:rebuilt', (payload) => {
    rebuildDAGView2D(payload);
  });
  State.on('change:selectedNode', (node) => {
    if (!node) return;
    if (State.viewMode === '2d') {
      focusNode2D(node.name || node.id);
      import('./UIManager.js').then(({ openSidebar }) => openSidebar(node));
    }
  });

  applyViewMode(State.viewMode || '3d');
}

initViewToggle();
initOmniSearch();

// ── 2. Bootstrap UI controls ─────────────────────────
initDock();
initRaycaster(Visualizer.renderer, Visualizer.camera);
initSLA();
initHUD(Visualizer.renderer);

// Expose Hub functions globally (called from HTML onclick)
window.connectLocal = connectLocal;


// ── 3. Load initial data from server injection ────────
const RAW = window.__RAW__ || { status: 'awaiting_upload', nodes: [], links: [], metadata: {} };
State.set('raw', RAW);

const AWAITING_DATA = RAW.status === 'awaiting_upload';

if (AWAITING_DATA) {
  const overlay = document.getElementById('awaiting-overlay');
  if (overlay) overlay.style.display = 'flex';
  // Probe the environment and update the Live Pipeline panel
  initLivePipelineStatus();
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
  initDAGView2D(RAW);

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

console.log('[DagCity] v5.1 — One-Click Live Sync Ready 🚀');

