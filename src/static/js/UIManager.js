// ═══════════════════════════════════════════════════════
// UIManager.js — Sidebar, SLA Panel, Project Manager, HUD
// ═══════════════════════════════════════════════════════
import { State } from './State.js';
import {
  meshes, nodeMeshMap, edgeObjs, nodeMap,
  applySelection, applyBlastRadius, resetSelection, tweenCamera, updateFires, rebuildCity, flyToNode, flyToNodeNoSelect,
  makeTimeSprite, getNodeSLA, buildBuilding, buildEdge, updateSyncMetrics, getRaycastTargets, zoomToFitAll, GLOBAL_VIEW_FLIGHT_MS
} from './CityEngine.js';
import { controls, camera, composer } from './Visualizer.js';
import { aiClient } from './AIClient.js';

// ── Blast Radius danger threshold ───────────────────────
// Tweak this to change when "Critical Danger" wording kicks in.
const DANGER_THRESHOLD = 5;


// ── Sidebar ────────────────────────────────────────────
const sidebar   = document.getElementById('sidebar');
const sbContent = document.getElementById('sb-content');

let isSlaPanelOpen = false;
let isSettingsOpen = false;
let isArchitectureOpen = false;
let isAiPanelOpen = false;
const aiHistory = [];

function calculateImpact(nodeId, visited = new Set()) {
  if (!nodeId || visited.has(nodeId)) return { impactedIds: [], exposuresImpacted: [] };
  visited.add(nodeId);

  const node = nodeMap[nodeId] || (State.raw?.nodes || []).find(n => n.id === nodeId);
  if (!node) return { impactedIds: [], exposuresImpacted: [] };

  const impacted = [];
  const exposures = [];
  const downstream = node.downstream || [];

  downstream.forEach((childId) => {
    if (visited.has(childId)) return;
    const child = nodeMap[childId] || (State.raw?.nodes || []).find(n => n.id === childId);
    if (!child) return;

    impacted.push(childId);

    const tags = (child.tags || []).map(t => String(t).toLowerCase());
    const nameLower = String(child.name || '').toLowerCase();
    const exposureLike =
      child.resource_type === 'exposure' ||
      nameLower.includes('dashboard') ||
      nameLower.includes('report') ||
      tags.includes('dashboard') ||
      tags.includes('exposure') ||
      tags.includes('report') ||
      (!child.downstream || child.downstream.length === 0);

    if (exposureLike) exposures.push(childId);

    const nested = calculateImpact(childId, visited);
    impacted.push(...nested.impactedIds);
    exposures.push(...nested.exposuresImpacted);
  });

  return {
    impactedIds: [...new Set(impacted)],
    exposuresImpacted: [...new Set(exposures)],
  };
}

// Graphics mode is now driven exclusively by setGraphicsQuality (CityEngine.js)
// via the #graphics-slider element. No legacy checkbox handler here.

function setPerfModeEnabled(enabled) {
  State.set('perfMode', !!enabled);
  const perfCheck = document.getElementById('check-perf-mode');
  if (perfCheck) perfCheck.checked = State.perfMode;
  
  meshes.forEach(m => {
    const ud = m.userData;
    ud.targetH = State.perfMode ? ud.perfH : ud.baseH;
    if (ud.hazard) ud.hazard.visible = !State.perfMode;
  });
  updateFires();
}

function setAutoRotateEnabled(enabled, shouldAnimate = true) {
  if (!controls) return;
  controls.autoRotate = !!enabled;
  const rotateCheck = document.getElementById('check-auto-rotate');
  if (rotateCheck) rotateCheck.checked = controls.autoRotate;
  if (controls.autoRotate && shouldAnimate) {
    const farPos = camera.position.clone().normalize().multiplyScalar(450);
    farPos.y = 110;
    tweenCamera(farPos, {x:0,y:0,z:0}, 2000);
  }
}

export function openSidebar(n) {
  const cols      = n.columns || [];
  const isBN      = n.is_bottleneck;
  const statusCol = isBN ? '#ff4400' : '#39ff14';
  const statusLbl = isBN ? 'BOTTLENECK' : 'HEALTHY';

  // ── STRICT TIME LABEL CONTRACT ───────────────────────────
  // The execution-time card shows ONE of two states, never both:
  //   • Has real/marketing data   → number + sec  + provenance line
  //   • No data                   → "Time: N/A"  + provenance line
  // No concatenations, no "0.000sec next to N/A" contradictions.
  const _execNum = Number(n.execution_time);
  const _hasTime = (n.time_source === 'real' || n.time_source === 'marketing')
    && Number.isFinite(_execNum) && _execNum > 0;

  const tSrc = n.time_source === 'real'
    ? '✓ from run_results.json'
    : (n.time_source === 'marketing'
        ? '🎬 marketing mode (synthetic, dev-only)'
        : '— No execution time data');

  const perfTimeHTML = _hasTime
    ? `<div class="perf-time" style="color:${isBN?'#ff6600':'#ffffff'}">${_execNum.toFixed(3)}<span class="perf-unit">sec</span></div>`
    : `<div class="perf-time" style="color:#666;font-size:28px;letter-spacing:2px;">Time: N/A</div>`;
  const impact = calculateImpact(n.id);
  const impactedCount = impact.impactedIds.length;
  // Strict count: only nodes whose resource_type is literally 'exposure'.
  // The heuristic-based exposuresImpacted (tags/name match) is too lax and was
  // labeling regular models as Dashboard.
  const exposureCount = impact.impactedIds.reduce((acc, id) => {
    const node = nodeMap[id];
    return acc + (node && String(node.resource_type || '').toLowerCase() === 'exposure' ? 1 : 0);
  }, 0);

  sbContent.innerHTML = `
    <div class="sb-node-name" style="color:${n.color}">${n.name}</div>
    <div class="sb-path" title="Unique ID">${n.id}</div>
    <div class="sb-file-path" style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#888;margin-bottom:15px;word-break:break-all;border-left:2px solid ${n.color};padding-left:8px;">
      <span style="color:#555">File:</span> ${n.file_path}
    </div>
    <div style="margin-bottom:20px;">
      <div style="font-size:11px;color:#555;letter-spacing:2px;margin-bottom:8px;">ARCHITECTURAL LAYER</div>
      <span class="sb-badge" style="color:${n.color};border-color:${n.color};font-weight:bold;background:${n.color}15">
        <span class="dot"></span>${n.layer.toUpperCase()}
      </span>
    </div>
    <span class="sb-badge" style="color:${statusCol};border-color:${statusCol}">
      <span class="dot"></span>${statusLbl}
    </span>
    ${n.is_dead_end ? `
      <div style="background:rgba(255,0,0,0.15); border:1px solid #ff2222; border-radius:10px; padding:18px; margin-bottom:25px; box-shadow: 0 0 15px rgba(255,0,0,0.1)">
        <div style="color:#ff2222;font-weight:900;letter-spacing:1px;font-size:13px;margin-bottom:8px;">⚠️ ARCHITECTURAL ALERT</div>
        <div style="color:#fff;font-size:15px;line-height:1.4;">This model is a <strong>dead end</strong> (0 downstreams). Possible dead code detected by the Ghost Protocol.</div>
      </div>
    ` : ''}
    <div class="perf-card ${isBN?'bottleneck':'normal'}">
      <div class="perf-card-label">⏱ EXECUTION TIME</div>
      ${perfTimeHTML}
      <div class="perf-source">${tSrc}</div>
    </div>
    <div class="sb-section-title">// STATISTICS</div>
    <div class="sb-grid">
      <div class="sb-stat"><span class="val">${(n.upstream||[]).length}</span><span class="lbl">Upstream</span></div>
      <div class="sb-stat"><span class="val">${(n.downstream||[]).length}</span><span class="lbl">Downstream</span></div>
      <div class="sb-stat"><span class="val">${cols.length||'—'}</span><span class="lbl">Columns</span></div>
      <div class="sb-stat"><span class="val">${(n.upstream||[]).length+(n.downstream||[]).length}</span><span class="lbl">Total Deps</span></div>
    </div>
    ${(() => {
      // ── Dynamic danger tiering ──────────────────────────
      const isCritical = impactedCount >= DANGER_THRESHOLD || exposureCount > 0;
      const isLow      = impactedCount > 0 && !isCritical;
      const isSafe     = impactedCount === 0;

      const tier = isSafe
        ? { title: '// ✅ IMPACT ASSESSMENT', titleCol: '#39ff14',
            bg: 'rgba(57,255,20,0.08)', border: 'rgba(57,255,20,0.4)', glow: 'rgba(57,255,20,0.18)',
            text: 'Safe to modify. No downstream dependencies.', textCol: '#b8ffc4' }
        : isLow
        ? { title: '// ⚠️ IMPACT ASSESSMENT', titleCol: '#ffcc44',
            bg: 'rgba(255,200,0,0.08)', border: 'rgba(255,200,0,0.45)', glow: 'rgba(255,200,0,0.18)',
            text: `Low Impact: Feeds <strong style="color:#fff">${impactedCount}</strong> downstream node${impactedCount === 1 ? '' : 's'}.`, textCol: '#ffe9aa' }
        : { title: '// 💥 IMPACT ASSESSMENT', titleCol: '#ff7744',
            bg: 'rgba(255,80,0,0.1)', border: 'rgba(255,100,20,0.45)', glow: 'rgba(255,80,0,0.18)',
            text: `Critical Danger: Feeds <strong style="color:#fff">${impactedCount}</strong> downstream nodes!${exposureCount > 0 ? ` Includes <strong style="color:#fff">${exposureCount}</strong> Dashboard/Exposure.` : ''}`, textCol: '#ffd8c8' };

      return `
      <div class="sb-section-title" style="color:${tier.titleCol}">${tier.title}</div>
      <div style="background:${tier.bg};border:1px solid ${tier.border};border-radius:10px;padding:14px 12px;margin-bottom:14px;box-shadow:0 0 14px ${tier.glow}">
        <div style="font-size:13px;color:${tier.textCol};line-height:1.5;">${tier.text}</div>
        ${impactedCount > 0 ? `<button id="btn-show-blast" style="margin-top:12px;background:linear-gradient(90deg,#ff4400,#ff7700);border:none;border-radius:8px;color:#fff;padding:8px 11px;font-size:11px;letter-spacing:1.4px;cursor:pointer;font-weight:bold;box-shadow:0 0 12px rgba(255,80,0,0.35)">[ SHOW BLAST RADIUS ]</button>
        <div id="blast-affected-list" style="display:none;margin-top:12px;max-height:150px;overflow-y:auto;border:1px solid rgba(255,100,20,0.25);border-radius:8px;background:rgba(0,0,0,0.35);padding:6px 4px;"></div>` : ''}
      </div>`;
    })()}
    <div class="sb-section-title">// METADATA</div>
    <div class="meta-row"><span class="key">SCHEMA</span><span class="val" style="color:${n.color}">${n.schema||'—'}</span></div>
    <div class="meta-row"><span class="key">MATERIALIZATION</span><span class="val">${n.materialized}</span></div>
    <div class="meta-row"><span class="key">PACKAGE</span><span class="val">${n.group}</span></div>
    ${n.description?`<div class="meta-row" style="display:block;padding:10px 0; border-bottom:none"><span class="key" style="display:block;margin-bottom:5px">DESCRIPTION</span><span style="color:#aaa;font-size:12px;line-height:1.6">${n.description}</span></div>`:''}
    <div class="sb-section-title">// SCHEMA EXPLORER</div>
    <input id="schema-search" type="text" placeholder="🔍 Search columns…" autocomplete="off">
    <div id="col-list">
      ${cols.length
        ? cols.map(c=>`<div class="col-row" data-col="${c.name.toLowerCase()}"><span class="col-name">${c.name}</span><span class="col-type">${c.type||'UNKNOWN'}</span></div>`).join('')
        : '<div class="no-cols">No column schema found.<br>Run <em>dbt docs generate</em> to enrich.</div>'}
    </div>
  `;
  sidebar.classList.add('open');
  const s = document.getElementById('schema-search');
  if (s) s.addEventListener('input', () => {
    const q = s.value.toLowerCase();
    document.querySelectorAll('#col-list .col-row').forEach(r => { r.style.display = r.dataset.col.includes(q) ? 'flex' : 'none'; });
  });

  const blastBtn = document.getElementById('btn-show-blast');
  if (blastBtn) {
    blastBtn.addEventListener('click', () => {
      const ids = [n.id, ...impact.impactedIds];
      applyBlastRadius(n.id, ids);

      // ── Populate affected-nodes list (fast-travel, no selection reset) ─
      const list = document.getElementById('blast-affected-list');
      if (!list) return;
      list.style.display = 'block';
      const items = impact.impactedIds
        .map(id => ({ id, node: nodeMap[id] }))
        .filter(x => x.node)
        .sort((a, b) => String(a.node.name).localeCompare(String(b.node.name)));

      // Resource-type → tag mapping (read STRICTLY from node.resource_type)
      const TAG_STYLES = {
        model:    { label: 'MODEL',              color: '#7ad7ff' }, // soft cyan
        seed:     { label: 'SEED',               color: '#7fff9d' }, // soft green
        source:   { label: 'SOURCE',             color: '#c8a8ff' }, // soft purple
        snapshot: { label: 'SNAPSHOT',           color: '#ffd86b' }, // soft amber
        exposure: { label: 'EXPOSURE / DASHBOARD', color: '#ff7a44' }, // orange
        metric:   { label: 'METRIC',             color: '#ff66c4' }, // pink
      };
      const tagFor = (rt) => {
        const t = TAG_STYLES[String(rt || '').toLowerCase()];
        return t || { label: 'NODE', color: '#888' };
      };

      list.innerHTML =
        '<style>' +
        '#blast-affected-list::-webkit-scrollbar{width:6px;}' +
        '#blast-affected-list::-webkit-scrollbar-track{background:transparent;}' +
        '#blast-affected-list::-webkit-scrollbar-thumb{background:#ff5500;border-radius:4px;box-shadow:0 0 6px rgba(255,85,0,0.6);}' +
        '#blast-affected-list::-webkit-scrollbar-thumb:hover{background:#ff7733;}' +
        '#blast-affected-list{scrollbar-width:thin;scrollbar-color:#ff5500 transparent;}' +
        '</style>' +
        (items.length ? items.map(({ id, node }) => {
          const tag = tagFor(node.resource_type);
          return `<div class="blast-aff-item" data-node-id="${id}" style="padding:6px 10px;font-size:12px;color:#ffd8c8;cursor:pointer;border-radius:6px;letter-spacing:0.3px;display:flex;align-items:center;justify-content:space-between;gap:8px;transition:all 0.15s;">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${node.name}</span>
            <span style="color:${tag.color};font-size:9px;letter-spacing:1.5px;font-weight:700;flex-shrink:0;">${tag.label}</span>
          </div>`;
        }).join('') : '<div style="padding:8px;color:#888;font-size:11px;">No affected nodes.</div>');

      // Hover + click bindings
      list.querySelectorAll('.blast-aff-item').forEach(el => {
        el.addEventListener('mouseenter', () => {
          el.style.background = 'rgba(255,100,20,0.18)';
          el.style.color = '#fff';
          el.style.boxShadow = '0 0 10px rgba(255,100,20,0.35)';
        });
        el.addEventListener('mouseleave', () => {
          el.style.background = 'transparent';
          el.style.color = '#ffd8c8';
          el.style.boxShadow = 'none';
        });
        el.addEventListener('click', () => {
          const id = el.getAttribute('data-node-id');
          // Camera-only fly. Does NOT call applySelection / resetSelection,
          // so the blast highlight on the original source stays intact.
          flyToNodeNoSelect(id);
        });
      });
    });
  }
}

export function closeSidebar() {
  sidebar.classList.remove('open');
  resetSelection();
  // We no longer force autoRotate = true here.
}



// ── SLA Panel ──────────────────────────────────────────
function toggleSlaPanel() {
  // Mutual exclusion — close every other dock panel before opening this one.
  // Without closing AI, both panels overlap at the same z-index/position and
  // the AI (later in DOM) paints over SLA, making the click look like a no-op.
  if (isSettingsOpen) toggleSettingsPanel();
  if (isArchitectureOpen) toggleArchitecturePanel();
  if (isAiPanelOpen) toggleAiPanel();
  isSlaPanelOpen = !isSlaPanelOpen;
  document.getElementById('sla-panel').classList.toggle('open', isSlaPanelOpen);
  document.getElementById('dock-sla').classList.toggle('active', isSlaPanelOpen);
}

// ── Settings Drawer ─────────────────────────────────────
function toggleSettingsPanel() {
  if (isSlaPanelOpen) toggleSlaPanel();
  if (isArchitectureOpen) toggleArchitecturePanel();
  if (isAiPanelOpen) toggleAiPanel();
  isSettingsOpen = !isSettingsOpen;
  document.getElementById('settings-panel').classList.toggle('open', isSettingsOpen);
  document.getElementById('dock-settings').classList.toggle('active', isSettingsOpen);
}

function toggleArchitecturePanel() {
  if (isSlaPanelOpen) toggleSlaPanel();
  if (isSettingsOpen) toggleSettingsPanel();
  if (isAiPanelOpen) toggleAiPanel();
  isArchitectureOpen = !isArchitectureOpen;
  document.getElementById('architecture-panel').classList.toggle('open', isArchitectureOpen);
  document.getElementById('dock-architecture').classList.toggle('active', isArchitectureOpen);
}

function toggleAiPanel() {
  if (isSlaPanelOpen) toggleSlaPanel();
  if (isSettingsOpen) toggleSettingsPanel();
  if (isArchitectureOpen) toggleArchitecturePanel();
  isAiPanelOpen = !isAiPanelOpen;
  const panel = document.getElementById('ai-panel');
  const dockBtn = document.getElementById('dock-ai');
  if (panel) panel.classList.toggle('open', isAiPanelOpen);
  if (dockBtn) dockBtn.classList.toggle('active', isAiPanelOpen);
  if (isAiPanelOpen) {
    renderAiMessages();
    const inputEl = document.getElementById('ai-chat-input');
    if (inputEl) setTimeout(() => inputEl.focus(), 0);
  }
}

function appendAiMessage(role, content) {
  aiHistory.push({ role, content });
  renderAiMessages();
}

function renderAiMessages() {
  const body = document.getElementById('ai-chat-body');
  if (!body) return;
  body.innerHTML = aiHistory.map((m) => {
    const cls = m.role === 'user' ? 'user' : (m.role === 'assistant' ? 'assistant' : 'system');
    const safe = String(m.content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<div class="ai-msg ${cls}">${safe}</div>`;
  }).join('');
  body.scrollTop = body.scrollHeight;
}

function triggerFocusAction(target) {
  if (!target) return;
  flyToNode(target);
}

async function handleAiSubmit() {
  const inputEl = document.getElementById('ai-chat-input');
  if (!inputEl) return;
  const text = inputEl.value.trim();
  if (!text) return;

  if (!aiClient.hasApiKey()) {
    appendAiMessage('system', 'Save your OpenAI API key first in Settings > AI Copilot.');
    return;
  }

  appendAiMessage('user', text);
  inputEl.value = '';
  const sendBtn = document.getElementById('ai-chat-send');
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '...'; }

  try {
    const payload = await aiClient.chat(text, aiHistory);
    appendAiMessage('assistant', payload.message || '');
    if (payload.action === 'FOCUS_NODE' && payload.target) {
      triggerFocusAction(payload.target);
    }
  } catch (err) {
    appendAiMessage('system', err?.message || 'AI request failed.');
  } finally {
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'SEND'; }
  }
}

export function initAiCopilot() {
  const dockAi = document.getElementById('dock-ai');
  const dockEl = document.getElementById('ide-dock');
  const closeAi = document.getElementById('ai-close');
  const sendBtn = document.getElementById('ai-chat-send');
  const inputEl = document.getElementById('ai-chat-input');
  const keyInput = document.getElementById('input-openai-key');
  const saveKeyBtn = document.getElementById('btn-save-openai-key');
  const keyStatus = document.getElementById('openai-key-status');
  const engineSelect = document.getElementById('select-ai-engine');

  if (dockAi) dockAi.addEventListener('click', toggleAiPanel);
  if (closeAi) closeAi.addEventListener('click', toggleAiPanel);
  if (sendBtn) sendBtn.addEventListener('click', handleAiSubmit);
  if (inputEl) {
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleAiSubmit();
      }
    });
  }

  if (engineSelect) {
    engineSelect.value = aiClient.getProvider();
    engineSelect.addEventListener('change', () => {
      aiClient.setProvider(engineSelect.value);
    });
  }

  if (keyInput) {
    keyInput.value = aiClient.hasApiKey() ? '••••••••••••' : '';
  }
  if (keyStatus) {
    keyStatus.textContent = aiClient.hasApiKey()
      ? 'API key stored locally. You can overwrite it anytime.'
      : 'Stored locally in this browser.';
  }

  if (saveKeyBtn && keyInput) {
    saveKeyBtn.addEventListener('click', () => {
      const val = keyInput.value.trim();
      if (!val || val.startsWith('••••')) return;
      aiClient.setApiKey(val);
      keyInput.value = '••••••••••••';
      if (keyStatus) keyStatus.textContent = 'API key stored locally ✓';
    });
  }

  if (!aiHistory.length) {
    appendAiMessage('system', 'DagCity AI ready. Ask for bottlenecks, SLA risks, or say "focus on X" to fly there.');
  }
}

export function initSettings() {
  const dSet = document.getElementById('dock-settings');
  const sCls = document.getElementById('settings-close');
  if (dSet) dSet.addEventListener('click', toggleSettingsPanel);
  if (sCls) sCls.addEventListener('click', toggleSettingsPanel);

  const checkAutoRotate = document.getElementById('check-auto-rotate');
  if (checkAutoRotate) {
    checkAutoRotate.checked = !!controls?.autoRotate;
    checkAutoRotate.addEventListener('change', () => {
      setAutoRotateEnabled(checkAutoRotate.checked);
    });
  }

  const btnResetView = document.getElementById('btn-reset-view');
  if (btnResetView) {
    btnResetView.addEventListener('click', () => {
      zoomToFitAll(GLOBAL_VIEW_FLIGHT_MS);
      setAutoRotateEnabled(true, false);
      if (sidebar) sidebar.classList.remove('open');
      resetSelection();
    });
  }

  const btnGlobalViewSettings = document.getElementById('btn-global-view-settings');
  if (btnGlobalViewSettings) {
    btnGlobalViewSettings.addEventListener('click', () => {
      zoomToFitAll(GLOBAL_VIEW_FLIGHT_MS);
      setAutoRotateEnabled(true, false);
      if (sidebar) sidebar.classList.remove('open');
      resetSelection();
    });
  }

  // Neon Bloom
  const inputBloom = document.getElementById('input-bloom');
  const valBloom   = document.getElementById('val-bloom');
  const fillBloom  = document.getElementById('fill-bloom');
  if (inputBloom && valBloom && fillBloom) {
    inputBloom.addEventListener('input', () => {
      const val = (inputBloom.value / 100);
      valBloom.textContent = val.toFixed(1);
      fillBloom.style.width = (inputBloom.value / 200 * 100) + '%';
      State.set('neonIntensity', val);
    });
  }

  // Visibility Toggles
  const checkLabels = document.getElementById('check-labels');
  if (checkLabels) {
    checkLabels.addEventListener('change', () => {
      State.set('showLabels', checkLabels.checked);
    });
  }

  const checkVfx = document.getElementById('check-vfx');
  if (checkVfx) {
    checkVfx.addEventListener('change', () => {
      State.set('showParticles', checkVfx.checked);
    });
  }
}

function initArchitecturePanel() {
  const dArch = document.getElementById('dock-architecture');
  const aCls = document.getElementById('architecture-close');
  if (dArch) dArch.addEventListener('click', toggleArchitecturePanel);
  if (aCls) aCls.addEventListener('click', toggleArchitecturePanel);

  const checkDataVolume = document.getElementById('check-data-volume');
  const archControls = document.getElementById('arch-swell-controls');
  const metricSelect = document.getElementById('select-swell-metric');
  const intensityInput = document.getElementById('input-swell-intensity');
  const intensityVal = document.getElementById('val-swell-intensity');
  const intensityFill = document.getElementById('fill-swell-intensity');
  const warnInput = document.getElementById('input-warn-threshold');
  const warnVal = document.getElementById('val-warn-threshold');
  const warnFill = document.getElementById('fill-warn-threshold');
  const criticalInput = document.getElementById('input-critical-threshold');
  const criticalVal = document.getElementById('val-critical-threshold');
  const criticalFill = document.getElementById('fill-critical-threshold');
  const legendLow = document.getElementById('legend-low-range');
  const legendMid = document.getElementById('legend-mid-range');
  const legendHigh = document.getElementById('legend-high-range');
  const checkAutoThreshold = document.getElementById('check-auto-threshold');
  const thresholdInput = document.getElementById('input-reference-threshold');
  const autoThresholdHint = document.getElementById('auto-threshold-hint');
  const selectedMetricEl = document.getElementById('arch-selected-metric-value');
  const selectedMetricCard = selectedMetricEl ? selectedMetricEl.closest('.arch-preview') : null;

  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const metricValue = (n, metric) => {
    if (metric === 'rows') {
      const directRows = toNum(n.row_count) ||
        toNum(n.rows) ||
        toNum(n.num_rows) ||
        toNum(n.rowCount) ||
        toNum(n.stats?.row_count) ||
        toNum(n.stats?.rows) ||
        toNum(n.stats?.num_rows) ||
        toNum(n.meta?.row_count) ||
        toNum(n.meta?.rows) ||
        toNum(n.meta?.num_rows);
      if (directRows > 0) return directRows;

      const cols = Math.max(1, (n.columns || []).length || 0);
      const deps = ((n.upstream || []).length + (n.downstream || []).length);
      const nameFactor = Math.max(1, (n.name || '').length);
      return Math.max(1000, Math.round((cols * 12000) + (deps * 26000) + (nameFactor * 350)));
    }

    if (metric === 'code_length') {
      return toNum(n.code_length) ||
        toNum(n.sql_length) ||
        toNum(n.stats?.code_length) ||
        toNum(n.meta?.code_length) ||
        Math.max(1, ((n.columns || []).length * 2500) + ((n.name || '').length * 500));
    }
    if (metric === 'connections') {
      return Math.max(1, ((n.upstream || []).length + (n.downstream || []).length));
    }
    return Math.max(1, toNum(n.execution_time) * 100000);
  };

  const formatCompact = (value) => {
    const n = Math.max(0, Number(value) || 0);
    if (n >= 1000000000) return (n / 1000000000).toFixed(1) + 'B';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return Math.round(n).toString();
  };

  const updateSelectedMetricPreview = () => {
    if (!selectedMetricEl) return;
    selectedMetricEl.classList.remove('severity-low', 'severity-mid', 'severity-high');
    if (selectedMetricCard) {
      selectedMetricCard.classList.remove('severity-low', 'severity-mid', 'severity-high');
    }

    const selected = State.selectedNode;
    if (!selected) {
      selectedMetricEl.textContent = 'Select a building to inspect metric value.';
      return;
    }

    const metric = State.dataSwellMetric || 'execution_time';
    const rawValue = metricValue(selected, metric);
    const refThreshold = Math.max(1, Number(State.referenceThreshold || State.autoMaxThreshold || 1));
    const ratio = rawValue / refThreshold;

    const warnPct = Math.max(10, Math.min(95, Number(State.swellWarnThresholdPct) || 60));
    const criticalPct = Math.max(warnPct + 1, Math.min(200, Number(State.swellCriticalThresholdPct) || 100));
    const warnRatio = warnPct / 100;
    const criticalRatio = criticalPct / 100;

    if (ratio >= criticalRatio) {
      selectedMetricEl.classList.add('severity-high');
      if (selectedMetricCard) selectedMetricCard.classList.add('severity-high');
    } else if (ratio >= warnRatio) {
      selectedMetricEl.classList.add('severity-mid');
      if (selectedMetricCard) selectedMetricCard.classList.add('severity-mid');
    } else {
      selectedMetricEl.classList.add('severity-low');
      if (selectedMetricCard) selectedMetricCard.classList.add('severity-low');
    }

    if (metric === 'rows') {
      const val = metricValue(selected, metric);
      const hasRealRows =
        toNum(selected.row_count) ||
        toNum(selected.rows) ||
        toNum(selected.num_rows) ||
        toNum(selected.rowCount) ||
        toNum(selected.stats?.row_count) ||
        toNum(selected.stats?.rows) ||
        toNum(selected.stats?.num_rows) ||
        toNum(selected.meta?.row_count) ||
        toNum(selected.meta?.rows) ||
        toNum(selected.meta?.num_rows);
      const marker = hasRealRows > 0 ? '✓' : '~';
      selectedMetricEl.textContent = `${selected.name}: ${marker}${formatCompact(val)} rows (${(ratio * 100).toFixed(0)}%)`;
      return;
    }

    if (metric === 'connections') {
      const links = (selected.upstream || []).length + (selected.downstream || []).length;
      selectedMetricEl.textContent = `${selected.name}: ${links} links (${(ratio * 100).toFixed(0)}%)`;
      return;
    }

    if (metric === 'code_length') {
      selectedMetricEl.textContent = `${selected.name}: ${formatCompact(rawValue)} code (${(ratio * 100).toFixed(0)}%)`;
      return;
    }

    const sec = Number(selected.execution_time || 0);
    selectedMetricEl.textContent = `${selected.name}: ${sec.toFixed(2)}s (${(ratio * 100).toFixed(0)}%)`;
  };

  const computeAutoMaxThreshold = () => {
    const rawNodes = State.raw?.nodes || [];
    if (!rawNodes.length) return 1;
    const metric = State.dataSwellMetric || 'execution_time';
    const maxVal = rawNodes.reduce((acc, node) => {
      return Math.max(acc, metricValue(node, metric));
    }, 1);
    return Math.max(1, Math.round(maxVal));
  };

  const syncThresholdUi = () => {
    const auto = !!State.autoAdjustThreshold;
    if (checkAutoThreshold) checkAutoThreshold.checked = auto;
    if (thresholdInput) {
      thresholdInput.disabled = auto;
      thresholdInput.value = String(Math.max(1, Math.round(State.referenceThreshold || 1)));
    }
    if (autoThresholdHint) {
      const mode = auto ? 'AUTO' : 'MANUAL';
      autoThresholdHint.textContent = `${mode} · Max project value: ${Math.round(State.autoMaxThreshold || 1).toLocaleString()}`;
    }
    const warnExactEl = document.getElementById('val-warn-threshold-exact');
    const criticalExactEl = document.getElementById('val-critical-threshold-exact');
    const refThreshold = Math.max(1, Number(State.referenceThreshold || State.autoMaxThreshold || 1));
    const warnPct = Math.max(10, Math.min(95, Number(State.swellWarnThresholdPct) || 60));
    const criticalPct = Math.max(warnPct + 1, Math.min(200, Number(State.swellCriticalThresholdPct) || 100));
    const currentMetric = State.dataSwellMetric || 'rows';
    const unit = getMetricUnit(currentMetric);
    if (warnExactEl) {
      const warnExactValue = Math.round((warnPct / 100) * refThreshold);
      warnExactEl.textContent = `${warnExactValue.toLocaleString()} ${unit}`;
    }
    if (criticalExactEl) {
      const criticalExactValue = Math.round((criticalPct / 100) * refThreshold);
      criticalExactEl.textContent = `${criticalExactValue.toLocaleString()} ${unit}`;
    }
  };

  const refreshAutoThreshold = () => {
    const autoMax = computeAutoMaxThreshold();
    State.set('autoMaxThreshold', autoMax);
    if (State.autoAdjustThreshold) {
      State.set('referenceThreshold', autoMax);
    } else if (!State.referenceThreshold || State.referenceThreshold <= 0) {
      State.set('referenceThreshold', autoMax);
    }
    syncThresholdUi();
  };

  const updateArchVisibility = (enabled) => {
    if (!archControls) return;
    archControls.classList.toggle('hidden', !enabled);
  };

  if (checkDataVolume) {
    checkDataVolume.checked = !!State.dataVolumeMode;
    updateArchVisibility(checkDataVolume.checked);
    checkDataVolume.addEventListener('change', () => {
      State.set('dataVolumeMode', checkDataVolume.checked);
      updateArchVisibility(checkDataVolume.checked);
    });
  }

  if (metricSelect) {
    // Fallback to 'rows' if the saved metric was removed from the dropdown.
    const ALLOWED_METRICS = new Set(['rows', 'code_length', 'connections']);
    const initialMetric = ALLOWED_METRICS.has(State.dataSwellMetric)
      ? State.dataSwellMetric
      : 'rows';
    if (initialMetric !== State.dataSwellMetric) State.set('dataSwellMetric', initialMetric);
    metricSelect.value = initialMetric;
    metricSelect.addEventListener('change', () => {
      State.set('dataSwellMetric', metricSelect.value);
      refreshAutoThreshold();
      syncThresholdUi();
      updateSelectedMetricPreview();
    });
  }

  if (checkAutoThreshold) {
    checkAutoThreshold.checked = !!State.autoAdjustThreshold;
    checkAutoThreshold.addEventListener('change', () => {
      State.set('autoAdjustThreshold', checkAutoThreshold.checked);
      if (checkAutoThreshold.checked) {
        State.set('referenceThreshold', State.autoMaxThreshold || 1);
      }
      syncThresholdUi();
      updateSelectedMetricPreview();
    });
  }

  if (thresholdInput) {
    thresholdInput.value = String(Math.max(1, Math.round(State.referenceThreshold || 1)));
    thresholdInput.addEventListener('input', () => {
      const val = Math.max(1, Math.round(toNum(thresholdInput.value) || 1));
      State.set('referenceThreshold', val);
      thresholdInput.value = String(val);
      syncThresholdUi();
      updateSelectedMetricPreview();
    });
  }

  const syncIntensity = (raw) => {
    const val = Math.max(0.5, Math.min(3.0, Number(raw) / 100));
    State.set('dataSwellIntensity', val);
    if (intensityVal) intensityVal.textContent = val.toFixed(1) + 'x';
    if (intensityFill) intensityFill.style.width = ((val - 0.5) / 2.5 * 100) + '%';
  };

  const syncThresholdLegend = () => {
    const warnPct = Math.max(10, Math.min(95, Number(State.swellWarnThresholdPct) || 60));
    const criticalPct = Math.max(warnPct + 1, Math.min(200, Number(State.swellCriticalThresholdPct) || 100));
    if (legendLow) legendLow.textContent = `< ${warnPct}% → Cyan`;
    if (legendMid) legendMid.textContent = `${warnPct}% to ${criticalPct}% → Yellow`;
    if (legendHigh) legendHigh.textContent = `≥ ${criticalPct}% → Red`;
  };

  if (intensityInput) {
    intensityInput.value = String(Math.round((State.dataSwellIntensity || 1.0) * 100));
    syncIntensity(intensityInput.value);
    intensityInput.addEventListener('input', () => syncIntensity(intensityInput.value));
  }

  const getMetricUnit = (metric) => {
    switch (metric) {
      case 'rows': return 'rows';
      case 'code_length': return 'chars';
      case 'connections': return 'connections';
      default: return 'units';
    }
  };

  const syncWarnThreshold = (raw) => {
    const val = Math.max(10, Math.min(95, Number(raw) || 60));
    if ((Number(State.swellCriticalThresholdPct) || 100) <= val) {
      State.set('swellCriticalThresholdPct', val + 1);
      if (criticalInput) criticalInput.value = String(val + 1);
      if (criticalVal) criticalVal.textContent = `${val + 1}% of ref`;
      if (criticalFill) {
        const criticalPct = ((val + 1 - 20) / 180) * 100;
        criticalFill.style.width = Math.max(0, Math.min(100, criticalPct)) + '%';
      }
    }
    State.set('swellWarnThresholdPct', val);
    if (warnVal) warnVal.textContent = `${val}% of ref`;
    if (warnFill) {
      const warnPct = ((val - 10) / 85) * 100;
      warnFill.style.width = Math.max(0, Math.min(100, warnPct)) + '%';
    }
    const warnExactEl = document.getElementById('val-warn-threshold-exact');
    if (warnExactEl) {
      const refThreshold = Math.max(1, Number(State.referenceThreshold || State.autoMaxThreshold || 1));
      const exactValue = Math.round((val / 100) * refThreshold);
      const currentMetric = State.dataSwellMetric || 'rows';
      const unit = getMetricUnit(currentMetric);
      warnExactEl.textContent = `${exactValue.toLocaleString()} ${unit}`;
    }
    syncThresholdLegend();
    updateSelectedMetricPreview();
  };

  const syncCriticalThreshold = (raw) => {
    const minCritical = (Number(State.swellWarnThresholdPct) || 60) + 1;
    const val = Math.max(minCritical, Math.min(200, Number(raw) || 100));
    State.set('swellCriticalThresholdPct', val);
    if (criticalVal) criticalVal.textContent = `${val}% of ref`;
    if (criticalFill) {
      const criticalPct = ((val - 20) / 180) * 100;
      criticalFill.style.width = Math.max(0, Math.min(100, criticalPct)) + '%';
    }
    const criticalExactEl = document.getElementById('val-critical-threshold-exact');
    if (criticalExactEl) {
      const refThreshold = Math.max(1, Number(State.referenceThreshold || State.autoMaxThreshold || 1));
      const exactValue = Math.round((val / 100) * refThreshold);
      const currentMetric = State.dataSwellMetric || 'rows';
      const unit = getMetricUnit(currentMetric);
      criticalExactEl.textContent = `${exactValue.toLocaleString()} ${unit}`;
    }
    syncThresholdLegend();
    updateSelectedMetricPreview();
  };

  if (warnInput) {
    warnInput.value = String(Number(State.swellWarnThresholdPct) || 60);
    syncWarnThreshold(warnInput.value);
    warnInput.addEventListener('input', () => syncWarnThreshold(warnInput.value));
  }

  if (criticalInput) {
    criticalInput.value = String(Number(State.swellCriticalThresholdPct) || 100);
    syncCriticalThreshold(criticalInput.value);
    criticalInput.addEventListener('input', () => syncCriticalThreshold(criticalInput.value));
  }

  syncThresholdLegend();

  refreshAutoThreshold();
  updateSelectedMetricPreview();
  State.on('change:raw', refreshAutoThreshold);
  State.on('city:rebuilt', refreshAutoThreshold);
  State.on('change:selectedNode', updateSelectedMetricPreview);
  State.on('city:rebuilt', updateSelectedMetricPreview);
  State.on('change:swellWarnThresholdPct', updateSelectedMetricPreview);
  State.on('change:swellCriticalThresholdPct', updateSelectedMetricPreview);
}

function handleManualSLAInput(el, onSync) {
  if (!el) return;
  const parseValue = () => {
    let val = parseInt(el.textContent.replace('s','').trim());
    if (isNaN(val)) val = 0;
    val = Math.max(0, Math.min(1000, val));
    onSync(val); el.textContent = val + 's'; el.blur();
  };
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); parseValue(); }
    if (e.key === 'Escape') { el.blur(); updateFires(); }
  });
  el.addEventListener('blur', parseValue);
}

export function renderZoneSliders() {
  const container = document.getElementById('sla-zones');
  if (!container) return;
  const raw = State.raw;
  const nodes = (raw && raw.nodes && raw.nodes.length) ? raw.nodes
                : meshes.map(m => m.userData.node).filter(Boolean);
  const layers = [...new Set(nodes.map(n => n.layer).filter(l => l && l !== 'null' && l !== 'undefined' && l !== 'unclassified'))];
  if (!layers.length) {
    container.innerHTML = '<div class="sla-desc">Load a project to see zone controls.</div>';
    return;
  }
  container.innerHTML = layers.map(l => {
    const isActive = State.slaZones[l] !== undefined;
    const val = isActive ? State.slaZones[l] : State.userDefinedSLA;
    const pct = Math.round((val / 1000) * 100);
    
    return `<div class="zone-row" style="margin-bottom: 16px;">
      <div class="sla-toggle-container">
        <div class="zone-name" style="margin:0">${l.toUpperCase()}</div>
        <label class="switch">
          <input type="checkbox" onchange="window._toggleZoneSLA('${l}', this.checked)" ${isActive ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
      
      ${isActive ? `
      <div id="zone-controls-${l}">
        <div class="sla-row">
          <div class="sla-name" style="font-size:12px">Override</div>
          <div class="sla-val" id="zone-val-${l}" style="font-size:16px" contenteditable="true">${val}s</div>
        </div>
        <div class="sla-slider-track">
          <div class="sla-slider-fill" id="zone-fill-${l}" style="width:${pct}%"></div>
          <input type="range" class="sla-input" id="zone-slider-${l}" min="0" max="1000" value="${val}" oninput="window._onZoneSLA('${l}', this.value)">
        </div>
      </div>
      ` : `
      <div class="sla-inherit-text" id="zone-inherit-${l}">Inheriting Global SLA (${State.userDefinedSLA}s)</div>
      `}
    </div>`;
  }).join('');
  layers.forEach(l => {
    const el = document.getElementById(`zone-val-${l}`);
    if (el) {
      handleManualSLAInput(el, v => {
        const slider = document.getElementById(`zone-slider-${l}`); if (slider) slider.value = v;
        onZoneSLA(l, v);
      });
    }
  });
}

window._toggleZoneSLA = (layer, active) => {
  if (active) {
    State.slaZones[layer] = State.userDefinedSLA;
  } else {
    delete State.slaZones[layer];
  }
  updateFires();
  saveSLAToProject();
  renderZoneSliders();
};

export function renderNodeOverrides() {
  const list = document.getElementById('sla-overrides-list');
  if (!list) return;
  const ids = Object.keys(State.slaNodes);
  if (!ids.length) { list.innerHTML = '<div class="sla-desc">No custom overrides.</div>'; return; }
  const raw = State.raw;
  list.innerHTML = ids.map(id => {
    const node = raw && raw.nodes ? raw.nodes.find(n => n.id === id) : null;
    const name = node ? node.name : id;
    const val  = State.slaNodes[id];
    const pct  = Math.round((val / 1000) * 100);
    return `<div class="sla-override-item">
      <div class="sla-override-label">
        <div class="sla-override-name">${name}</div>
        <div class="sla-slider-track" style="margin-top:8px">
          <div class="sla-slider-fill" id="node-fill-${id}" style="width:${pct}%"></div>
          <input type="range" class="sla-input" min="0" max="1000" value="${val}" oninput="window._onNodeSLA('${id}', this.value)">
        </div>
      </div>
      <div class="sla-override-val" id="node-val-${id}" style="font-size:22px" contenteditable="true">${val}s</div>
      <div class="sla-del" onclick="window._removeNodeSLA('${id}')">✕</div>
    </div>`;
  }).join('');
  ids.forEach(id => {
    const el = document.getElementById(`node-val-${id}`);
    handleManualSLAInput(el, v => {
      const slider = document.querySelector(`[oninput="window._onNodeSLA('${id}', this.value)"]`);
      if (slider) slider.value = v;
      onNodeSLA(id, v);
    });
  });
}

function saveSLAToProject() {
  const projectName = localStorage.getItem('dagcity_active_project');
  if (!projectName) return;
  fetch(`/api/projects/${encodeURIComponent(projectName)}/sla`, {
    method: 'PATCH', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ 
      global: State.userDefinedSLA, 
      zones: {...State.slaZones}, 
      nodes: {...State.slaNodes},
      vfxThresholds: {...State.vfxThresholds}
    })
  }).catch(e => console.warn('[SLA] Save failed:', e));
}

function onZoneSLA(layer, val) {
  val = parseInt(val);
  State.slaZones[layer] = val;
  const fill  = document.getElementById(`zone-fill-${layer}`);
  const valEl = document.getElementById(`zone-val-${layer}`);
  if (fill)  fill.style.width  = Math.round((val/1000)*100) + '%';
  if (valEl) valEl.textContent = val + 's';
  updateFires(); saveSLAToProject();
}

function onNodeSLA(id, val) {
  val = parseInt(val);
  State.slaNodes[id] = val;
  const fill  = document.getElementById(`node-fill-${id}`);
  const valEl = document.getElementById(`node-val-${id}`);
  if (fill)  fill.style.width  = Math.round((val/1000)*100) + '%';
  if (valEl) valEl.textContent = val + 's';
  updateFires(); saveSLAToProject();
}

function removeNodeSLA(id) {
  delete State.slaNodes[id];
  renderNodeOverrides(); updateFires(); saveSLAToProject();
}

function addNodeSLA(id) {
  State.slaNodes[id] = State.userDefinedSLA;
  renderNodeOverrides(); updateFires(); saveSLAToProject();
  document.getElementById('sla-node-search').value = '';
  document.getElementById('sla-node-results').innerHTML = '';
}

export function loadSLAFromProject(graphData) {
  const sla = graphData._sla;
  if (!sla) return;
  State.userDefinedSLA = sla.global ?? 120;
  Object.assign(State.slaZones, sla.zones || {});
  Object.assign(State.slaNodes, sla.nodes || {});
  
  if (sla.vfxThresholds) {
    Object.assign(State.vfxThresholds, sla.vfxThresholds);
    ['smoke', 'sparks', 'fire'].forEach(type => {
      const val = State.vfxThresholds[type];
      const input = document.getElementById(`input-vfx-${type}`);
      const valEl = document.getElementById(`val-vfx-${type}`);
      const fill  = document.getElementById(`fill-vfx-${type}`);
      if (input) {
        input.value = Math.round(val * 100);
        if (valEl) valEl.textContent = val.toFixed(1) + 'x';
        if (fill)  fill.style.width = ((input.value - 50) / 250 * 100) + '%';
      }
    });
  }

  const globalInput = document.getElementById('sla-global-input');
  const globalFill  = document.getElementById('sla-global-fill');
  const globalVal   = document.getElementById('sla-global-val');
  if (globalInput) {
    globalInput.value = State.userDefinedSLA;
    const pct = Math.round((State.userDefinedSLA / 1000) * 100);
    if (globalFill) globalFill.style.width = pct + '%';
    if (globalVal)  globalVal.textContent  = State.userDefinedSLA + 's';
  }
}

// Expose callbacks for inline oninput handlers
window._onZoneSLA    = onZoneSLA;
window._onNodeSLA    = onNodeSLA;
window._removeNodeSLA = removeNodeSLA;

// Inline handlers for new sliders
window._onFlySpeed = (rawValue) => {
  const val = parseFloat(rawValue) / 100;
  const valEl = document.getElementById('val-fly-speed');
  const fill = document.getElementById('fill-fly-speed');
  if (valEl) valEl.textContent = val.toFixed(1) + 'x';
  if (fill) fill.style.width = ((parseFloat(rawValue) - 50) / 250 * 100) + '%';
  State.set('flySpeed', val);
};

window._onFlySpeedChange = () => {
  // Can add save logic if we decide to persist fly speed per project, 
  // but currently it's just a session setting.
};

window._onVFX = (type, rawValue) => {
  const val = parseFloat(rawValue) / 100;
  const valEl = document.getElementById(`val-vfx-${type}`);
  const fill = document.getElementById(`fill-vfx-${type}`);
  if (valEl) valEl.textContent = val.toFixed(1) + 'x';
  if (fill) fill.style.width = ((parseFloat(rawValue) - 50) / 250 * 100) + '%';
  if (!State.vfxThresholds) State.vfxThresholds = { smoke: 1.0, sparks: 1.2, fire: 1.5 };
  State.vfxThresholds[type] = val;
};

window._saveVFX = () => {
  saveSLAToProject();
};

// ── Project Manager ─────────────────────────────────────
const projectModal = document.getElementById('project-modal');
const pmList       = document.getElementById('pm-list');
let pmFilterMode   = 'all';

function initProjectFilters() {
  const allBtn = document.getElementById('pm-filter-all');
  const activeBtn = document.getElementById('pm-filter-active');
  const inactiveBtn = document.getElementById('pm-filter-inactive');
  const setFilter = (mode) => {
    pmFilterMode = mode;
    if (allBtn) allBtn.classList.toggle('active', mode === 'all');
    if (activeBtn) activeBtn.classList.toggle('active', mode === 'active');
    if (inactiveBtn) inactiveBtn.classList.toggle('active', mode === 'inactive');
    openProjectModal();
  };

  if (allBtn) allBtn.onclick = () => setFilter('all');
  if (activeBtn) activeBtn.onclick = () => setFilter('active');
  if (inactiveBtn) inactiveBtn.onclick = () => setFilter('inactive');
}

async function openProjectModal() {
  projectModal.classList.add('open');
  pmList.innerHTML = '<div id="pm-empty">LOADING PROJECTS...</div>';
  try {
    const res = await fetch('/api/projects');
    const projects = await res.json();
    
    // Check for "Live" project availability
    const statusRes = await fetch('/api/status');
    const status = await statusRes.json();
    if (status.live_sync_available) {
      // Add a special entry for the Live project if we want, 
      // but for now the HUD indicator is enough.
    }
    
    renderProjects(projects);
  } catch(e) {

    pmList.innerHTML = '<div id="pm-empty">ERROR LOADING PROJECTS</div>';
  }
}

function renderProjects(projects) {
  const filtered = projects.filter((p) => {
    if (pmFilterMode === 'active') return !p.disabled;
    if (pmFilterMode === 'inactive') return !!p.disabled;
    return true;
  });

  if (!filtered.length) {
    pmList.innerHTML = '<div id="pm-empty">NO SAVED PROJECTS YET<br><span style="font-size:10px;opacity:0.5;margin-top:8px;display:block;">Upload a manifest.json to create your first project</span></div>';
    return;
  }
  const active = localStorage.getItem('dagcity_active_project');
  pmList.innerHTML = '';
  filtered.forEach(p => {
    const isActive = p.name === active;
    const isDisabled = !!p.disabled;
    const date = p.created_at ? new Date(p.created_at).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Unknown date';
    const isLive = p.source === 'local_sync' || p.source === 'live_sync';
    
    const row = document.createElement('div');
    row.className = `pm-project-row ${isActive ? 'active' : ''}`;
    if (isDisabled) row.style.opacity = '0.5';
    
    row.innerHTML = `
      <div class="pm-project-info">
        <div class="pm-project-name" id="pm-name-display-${p.name}">
          ${p.name}
          ${isLive ? `
            <div class="pm-badge pm-badge-live">
              <span class="pm-dot pm-dot-live"></span> LIVE SYNC
            </div>
          ` : `
            <div class="pm-badge pm-badge-static">SNAPSHOT</div>
          `}
        </div>
        <div class="pm-project-meta">
          ${isLive ? '⚡' : '📁'} ${p.node_count} BUILDINGS &nbsp;·&nbsp; ${date}
          ${isDisabled ? `<br><span style="color:#ff9966;font-size:11px">${p.disabled_reason || 'Unavailable'}</span>` : ''}
        </div>
      </div>
      <div class="pm-project-actions">
        <button class="pm-btn pm-btn-load" onclick="window._loadProject('${p.name}')" ${isDisabled ? 'disabled style="opacity:0.4;cursor:not-allowed"' : ''}>${isDisabled ? 'INACTIVE' : 'LOAD'}</button>
        <button class="pm-btn pm-btn-rename" style="opacity:0.4;" onclick="window._startRename('${p.name}')">RENAME</button>
        <button class="pm-btn pm-btn-delete" onclick="window._deleteProject('${p.name}')">DELETE</button>
      </div>`;
    pmList.appendChild(row);
  });
}

async function loadProject(name) {
  const btn = pmList.querySelector(`[onclick="window._loadProject('${name}')"]`);
  if (btn) { btn.textContent = 'LOADING...'; btn.disabled = true; }
  try {
    const res = await fetch('/api/projects/' + encodeURIComponent(name));
    if (!res.ok) {
      if (res.status === 423) {
        localStorage.removeItem('dagcity_active_project');
        alert('This Live Sync project is inactive because the source changed.');
        projectModal.classList.remove('open');
        startNewProject();
        return;
      }
      throw new Error('Not found');
    }
    const data = await res.json();
    localStorage.setItem('dagcity_active_project', name);
    projectModal.classList.remove('open');
    const overlay = document.getElementById('awaiting-overlay');
    if (overlay.style.display !== 'none') await window._dzHideOverlay();
    rebuildCity(data, false);
    
    // Update HUD Sync Status
    const source = data.metadata?.source || (data.saved ? 'offline' : 'live_sync');
    updateSyncHUD(source);

    loadSLAFromProject(data);
    renderZoneSliders();
    renderNodeOverrides();
    updateFires();
    console.log('[📁] Project loaded:', name);
  } catch(e) {
    console.error('[📁] Failed to load project:', e);
    if (btn) { btn.textContent = 'LOAD'; btn.disabled = false; }
  }
}

async function deleteProject(name) {
  if (!confirm(`Are you sure you want to delete the project '${name}'?`)) {
    return;
  }
  
  const active = localStorage.getItem('dagcity_active_project');
  try {
    await fetch('/api/projects/' + encodeURIComponent(name), { method: 'DELETE' });
    if (active === name) {
      localStorage.removeItem('dagcity_active_project');
      startNewProject();
    } else {
      openProjectModal();
    }
  } catch(e) { console.error('[📁] Failed to delete project:', e); }
}

function startRename(name) {
  const nameEl = document.getElementById('pm-name-display-' + name);
  if (!nameEl) return;
  nameEl.innerHTML = `<input id="rename-input-${name}" type="text" value="${name}" maxlength="64" />`;
  const input = document.getElementById('rename-input-' + name);
  input.focus(); input.select();
  input.addEventListener('keydown', async e => {
    if (e.key === 'Enter') await commitRename(name, input.value);
    if (e.key === 'Escape') openProjectModal();
  });
  input.addEventListener('blur', () => setTimeout(openProjectModal, 200));
}

async function commitRename(oldName, newName) {
  newName = newName.trim();
  if (!newName || newName === oldName) { openProjectModal(); return; }
  try {
    const res = await fetch('/api/projects/' + encodeURIComponent(oldName) + '/rename', {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ new_name: newName })
    });
    if (!res.ok) throw new Error('Rename failed');
    const r = await res.json();
    if (localStorage.getItem('dagcity_active_project') === oldName) localStorage.setItem('dagcity_active_project', r.new_name);
    openProjectModal();
  } catch(e) { console.error('[📁] Rename error:', e); openProjectModal(); }
}

// Expose project actions for HTML onclick attributes
window._loadProject  = loadProject;
window._startRename  = startRename;
window._deleteProject = deleteProject;

// ── IDE Dock Controls ─────────────────────────────────
export function initDock() {
  initProjectFilters();
  const sbClose = document.getElementById('sb-close');
  if (sbClose) sbClose.addEventListener('click', closeSidebar);
  
  const dProj = document.getElementById('dock-projects');
  if (dProj) dProj.addEventListener('click', openProjectModal);
  
  const pmClose = document.getElementById('pm-close');
  if (pmClose) pmClose.addEventListener('click', () => projectModal.classList.remove('open'));
  
  const pmNew = document.getElementById('pm-new-project');
  if (pmNew) pmNew.addEventListener('click', startNewProject);

  if (projectModal) {
    projectModal.addEventListener('click', e => { if (e.target === projectModal) projectModal.classList.remove('open'); });
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && projectModal) projectModal.classList.remove('open'); });
  
  initStatusHUD();
  initSettings();
  initArchitecturePanel();
  initAiCopilot();
}

async function initStatusHUD() {
  try {
    const res = await fetch('/api/status');
    const status = await res.json();
    const hud = document.getElementById('live-sync-hud');
    if (!hud) return;
    if (status.live_sync_available) {
      hud.innerHTML = '<span class="status-dot green"></span> LIVE SYNC ACTIVE';
      hud.title = `Watching: ${status.external_path}`;
      hud.classList.add('active');
    } else {
      hud.innerHTML = '<span class="status-dot grey"></span> LIVE SYNC OFF';
      hud.title = "Mount your dbt project folder to /data to enable real-time updates.";
      hud.classList.remove('active');
    }
  } catch(e) {}
}


function startNewProject() {
  projectModal.classList.remove('open');
  window._dzFiles = { manifest: null, run_results: null };
  document.getElementById('slot-manifest').classList.remove('dz-slot-loaded');
  document.getElementById('slot-results').classList.remove('dz-slot-loaded');
  document.getElementById('upload-status').textContent = 'READY FOR NEW METROPOLIS';
  const overlay = document.getElementById('awaiting-overlay');
  overlay.style.display = 'flex'; overlay.classList.remove('hiding');
  const cancelBtn = document.getElementById('dz-cancel');
  const active = localStorage.getItem('dagcity_active_project');
  if (active) cancelBtn.style.display = 'flex';
}

// ── Raycaster & Click ─────────────────────────────────
export function initRaycaster(renderer, camera) {
  if (!renderer || !camera) {
    console.error('[UIManager] Cannot init raycaster: renderer or camera is missing');
    return;
  }
  const raycaster = new THREE.Raycaster();
  raycaster.params.Mesh = { threshold: 0 };
  const mouse    = new THREE.Vector2();
  const tooltip  = document.getElementById('tooltip');
  let hoveredBuilding = null;

  // ── Hover raycasting (rAF-throttled) ────────────────
  // Mousemove can fire 100+ times/sec; intersecting hundreds of meshes that
  // often saturated the CPU. We coalesce events: store latest pointer state
  // and resolve at most once per animation frame.
  let pendingClientX = 0, pendingClientY = 0;
  let hoverFramePending = false;

  function resolveHover() {
    hoverFramePending = false;
    mouse.x = (pendingClientX/window.innerWidth)*2-1;
    mouse.y = -(pendingClientY/window.innerHeight)*2+1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(getRaycastTargets(), true);
    let foundNode = null, foundMesh = null;
    for (const h of hits) {
      foundNode = findNodeInHierarchy(h.object);
      if (foundNode) {
        foundMesh = nodeMeshMap[foundNode.id] || h.object;
        break;
      }
    }
    
    // Handle hover state
    if (hoveredBuilding && hoveredBuilding !== foundMesh) {
      hoveredBuilding.userData.isHovered = false;
      
      // Hide labels when leaving hover in low graphics mode
      if (State.graphicsMode === 'low') {
        if (hoveredBuilding.userData.label) hoveredBuilding.userData.label.visible = false;
        if (hoveredBuilding.userData.timeLabel) hoveredBuilding.userData.timeLabel.visible = false;
      }
      
      hoveredBuilding = null;
    }
    
    if (foundNode) {
      if (foundMesh) { 
        foundMesh.userData.isHovered = true; 
        hoveredBuilding = foundMesh;
        
        // Show labels on hover in low graphics mode
        if (State.graphicsMode === 'low') {
          if (foundMesh.userData.label) foundMesh.userData.label.visible = true;
          if (foundMesh.userData.timeLabel) foundMesh.userData.timeLabel.visible = true;
        }
      }
      
      tooltip.style.display = 'block';
      tooltip.style.left = (pendingClientX+15)+'px'; tooltip.style.top = (pendingClientY-38)+'px';
      tooltip.style.color = foundNode.color;
      tooltip.innerHTML = `<strong>${foundNode.name}</strong><br><span style="color:#555;font-size:11px">${foundNode.layer.toUpperCase()} · ${foundNode.execution_time?.toFixed(2)}s</span>`;
      renderer.domElement.style.cursor = 'pointer';
    } else {
      tooltip.style.display = 'none'; renderer.domElement.style.cursor = 'default';
    }
  }

  renderer.domElement.addEventListener('mousemove', e => {
    pendingClientX = e.clientX;
    pendingClientY = e.clientY;
    if (!hoverFramePending) {
      hoverFramePending = true;
      requestAnimationFrame(resolveHover);
    }
  });

  let mouseDownTime = 0, mouseDownPos = {x:0,y:0};
  renderer.domElement.addEventListener('mousedown', e => { mouseDownTime = performance.now(); mouseDownPos = {x:e.clientX,y:e.clientY}; });
  renderer.domElement.addEventListener('mouseup', e => {
    const dist = Math.sqrt(Math.pow(e.clientX-mouseDownPos.x,2)+Math.pow(e.clientY-mouseDownPos.y,2));
    if (dist > 6) return;
    mouse.x = (e.clientX/window.innerWidth)*2-1;
    mouse.y = -(e.clientY/window.innerHeight)*2+1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(getRaycastTargets(), true);
    let found = null;
    for (const h of hits) { found = findNodeInHierarchy(h.object); if(found) break; }
    if (found) {
      const selectedNode = State.selectedNode;
      if (selectedNode?.id === found.id) {
        if (sidebar.classList.contains('open')) { sidebar.classList.remove('open'); resetSelection(); }
        else { openSidebar(found); applySelection(found); }
        return;
      }
      applySelection(found); openSidebar(found);
      const m = nodeMeshMap[found.id];
      if (m) {
        if (!State.selectedNode) {
          controls.target.copy(new THREE.Vector3(0,0,0));
        } else {
          const m = nodeMeshMap[State.selectedNode.id];
          if (controls) {
            setAutoRotateEnabled(false, false);
          }
          const buildingPos = m.position.clone();
          const currentDir = camera.position.clone().sub(controls.target).normalize();
          const destPos = buildingPos.clone().add(currentDir.multiplyScalar(120));
          tweenCamera(destPos, buildingPos.clone().add(new THREE.Vector3(0,10,0)), 1200);
        }
      }
    } else {
      sidebar.classList.remove('open'); resetSelection();
    }


  });
}

function findNodeInHierarchy(obj) {
  let o = obj; while(o) { if (o.userData && o.userData.node) return o.userData.node; o = o.parent; } return null;
}

// ── SLA Init ──────────────────────────────────────────
export function initSLA() {
  const dSla = document.getElementById('dock-sla');
  const sCls = document.getElementById('sla-close');
  if (dSla) dSla.addEventListener('click', toggleSlaPanel);
  if (sCls) sCls.addEventListener('click', toggleSlaPanel);

  const perfCheck = document.getElementById('check-perf-mode');
  if (perfCheck) {
    perfCheck.checked = !!State.perfMode;
    perfCheck.addEventListener('change', () => {
      setPerfModeEnabled(perfCheck.checked);
    });
  }
  
  // Graphics slider binding is handled in main.js boot (single source of truth).

  const globalInput = document.getElementById('sla-global-input');
  const globalFill  = document.getElementById('sla-global-fill');
  const globalVal   = document.getElementById('sla-global-val');

  const syncGlobal = val => {
    State.userDefinedSLA = val;
    if (globalInput) globalInput.value = val;
    if (globalFill) globalFill.style.width = Math.round((val/1000)*100) + '%';
    if (globalVal) globalVal.textContent  = val + 's';
    updateFires(); saveSLAToProject();
  };

  if (globalInput) {
    globalInput.addEventListener('input', () => syncGlobal(parseInt(globalInput.value)));
  }
  if (globalVal) handleManualSLAInput(globalVal, syncGlobal);

  // VFX Thresholds (Safely initialize if State was not updated correctly in container)
  if (!State.vfxThresholds) {
    console.warn('[SLA] vfxThresholds missing in State, initializing manually...');
    State.vfxThresholds = { smoke: 1.0, sparks: 1.2, fire: 1.5 };
  }

  const searchEl  = document.getElementById('sla-node-search');
  const resultsEl = document.getElementById('sla-node-results');
  const addBtn    = document.getElementById('add-node-override-btn');
  
  if (addBtn && searchEl) {
    addBtn.addEventListener('click', () => {
      addBtn.style.display = 'none';
      searchEl.style.display = 'block';
      searchEl.focus();
    });
  }

  if (searchEl) {
    searchEl.addEventListener('input', () => {
      const q = searchEl.value.toLowerCase().trim();
      if (!q) { resultsEl.innerHTML = ''; return; }
      const raw = State.raw;
      const hits = (raw && raw.nodes ? raw.nodes : []).filter(n => n.name.toLowerCase().includes(q)).slice(0,8);
      resultsEl.innerHTML = hits.map(h => `<div class="sla-result-row" onclick="window._addNodeSLA('${h.id}')">${h.name}<span style="color:#666;margin-left:8px;font-size:11px">${h.layer||''}</span></div>`).join('');
    });
  }

  window._addNodeSLA = (id) => {
    addNodeSLA(id);
    if (addBtn) addBtn.style.display = 'block';
    if (searchEl) { searchEl.style.display = 'none'; searchEl.value = ''; }
    if (resultsEl) resultsEl.innerHTML = '';
  };
}

// ── HUD Logic ─────────────────────────────────────────
export function updateSyncHUD(source) {
  const dot = document.getElementById('sync-hud-dot');
  const text = document.getElementById('sync-hud-text');
  if (!dot || !text) return;

  if (source === 'live_sync' || source === 'local_sync') {
    dot.className = 'status-dot green';
    text.innerHTML = '📡 LIVE SYNC';
    text.style.color = '#39ff14';
  } else {
    dot.className = 'status-dot orange';
    text.innerHTML = '⏸ OFFLINE';
    text.style.color = '#ffaa00';
  }
}

export function initHUD(renderer) {
  if (!renderer) return;
  const smartHUD   = document.getElementById('smart-hud');
  const helpTrigger = document.getElementById('help-trigger-left');
  const helpHint   = document.getElementById('help-hint');
  let userInteracted = false;
  
  function hideHUD() {
    if (!userInteracted && smartHUD && helpHint) { 
      smartHUD.classList.add('hidden'); 
      helpHint.classList.add('fade-out'); 
      userInteracted = true; 
    }
  }
  
  if (helpHint) setTimeout(() => helpHint.classList.add('fade-out'), 10000);
  
  if (renderer.domElement) {
    renderer.domElement.addEventListener('mousedown', hideHUD);
    renderer.domElement.addEventListener('wheel', hideHUD);
  }
  
  if (helpTrigger && smartHUD) {
    helpTrigger.addEventListener('mouseenter', () => smartHUD.classList.remove('hidden'));
    helpTrigger.addEventListener('mouseleave', () => { if(userInteracted) smartHUD.classList.add('hidden'); });
  }
}

// Re-export rebuildCity wrapper that also updates SLA UI
export function rebuildCityWithUI(graphData, isLiveSync = false) {
  rebuildCity(graphData, isLiveSync);
  // State.raw is updated inside rebuildCity via State.set('raw', ...)
  loadSLAFromProject(graphData);
  renderZoneSliders();
  renderNodeOverrides();
  updateFires();
}

// Listen for city rebuild events to refresh SLA sliders
State.on('city:rebuilt', graphData => {
  loadSLAFromProject(graphData);
  renderZoneSliders();
  renderNodeOverrides();
  updateFires();
});
