// ═══════════════════════════════════════════════════════
// UIManager.js — Sidebar, SLA Panel, Project Manager, HUD
// ═══════════════════════════════════════════════════════
import { State } from './State.js';
import {
  meshes, nodeMeshMap, edgeObjs, nodeMap,
  applySelection, resetSelection, tweenCamera, updateFires, rebuildCity,
  makeTimeSprite, getNodeSLA, buildBuilding, buildEdge, updateSyncMetrics
} from './CityEngine.js';
import { controls, camera, INIT_CAM, composer } from './Visualizer.js';


// ── Sidebar ────────────────────────────────────────────
const sidebar   = document.getElementById('sidebar');
const sbContent = document.getElementById('sb-content');

let isSlaPanelOpen = false;
let isSettingsOpen = false;

export function openSidebar(n) {
  const cols      = n.columns || [];
  const execTime  = n.execution_time || 0;
  const isBN      = n.is_bottleneck;
  const statusCol = isBN ? '#ff4400' : '#39ff14';
  const statusLbl = isBN ? 'BOTTLENECK' : 'HEALTHY';
  const tSrc      = n.time_source === 'real' ? '✓ from run_results.json' : '~ simulated (no run_results)';

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
      <div class="perf-time" style="color:${isBN?'#ff6600':'#ffffff'}">${execTime.toFixed(3)}<span class="perf-unit">sec</span></div>
      <div class="perf-source">${tSrc}</div>
    </div>
    <div class="sb-section-title">// STATISTICS</div>
    <div class="sb-grid">
      <div class="sb-stat"><span class="val">${(n.upstream||[]).length}</span><span class="lbl">Upstream</span></div>
      <div class="sb-stat"><span class="val">${(n.downstream||[]).length}</span><span class="lbl">Downstream</span></div>
      <div class="sb-stat"><span class="val">${cols.length||'—'}</span><span class="lbl">Columns</span></div>
      <div class="sb-stat"><span class="val">${(n.upstream||[]).length+(n.downstream||[]).length}</span><span class="lbl">Total Deps</span></div>
    </div>
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
}

export function closeSidebar() {
  sidebar.classList.remove('open');
  resetSelection();
  // We no longer force autoRotate = true here.
}



// ── SLA Panel ──────────────────────────────────────────
function toggleSlaPanel() {
  if (isSettingsOpen) toggleSettingsPanel();
  isSlaPanelOpen = !isSlaPanelOpen;
  document.getElementById('sla-panel').classList.toggle('open', isSlaPanelOpen);
  document.getElementById('dock-sla').classList.toggle('active', isSlaPanelOpen);
}

// ── Settings Drawer ─────────────────────────────────────
function toggleSettingsPanel() {
  if (isSlaPanelOpen) toggleSlaPanel();
  isSettingsOpen = !isSettingsOpen;
  document.getElementById('settings-panel').classList.toggle('open', isSettingsOpen);
  document.getElementById('dock-settings').classList.toggle('active', isSettingsOpen);
}

export function initSettings() {
  document.getElementById('dock-settings').addEventListener('click', toggleSettingsPanel);
  document.getElementById('settings-close').addEventListener('click', toggleSettingsPanel);

  // Camera Sensitivity
  const inputCam = document.getElementById('input-cam-sens');
  const valCam   = document.getElementById('val-cam-sens');
  const fillCam  = document.getElementById('fill-cam-sens');
  inputCam.addEventListener('input', () => {
    const val = inputCam.value / 100;
    valCam.textContent = val.toFixed(1) + 'x';
    fillCam.style.width = ((inputCam.value - 50) / 150 * 100) + '%';
    State.set('camSensitivity', val);
  });

  // Neon Bloom
  const inputBloom = document.getElementById('input-bloom');
  const valBloom   = document.getElementById('val-bloom');
  const fillBloom  = document.getElementById('fill-bloom');
  inputBloom.addEventListener('input', () => {
    const val = (inputBloom.value / 100);
    valBloom.textContent = val.toFixed(1);
    fillBloom.style.width = (inputBloom.value / 200 * 100) + '%';
    State.set('neonIntensity', val);
  });

  // Visibility Toggles
  const checkLabels = document.getElementById('check-labels');
  checkLabels.addEventListener('change', () => {
    State.set('showLabels', checkLabels.checked);
  });

  const checkVfx = document.getElementById('check-vfx');
  checkVfx.addEventListener('change', () => {
    State.set('showParticles', checkVfx.checked);
  });
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
    body: JSON.stringify({ global: State.userDefinedSLA, zones: {...State.slaZones}, nodes: {...State.slaNodes} })
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

// ── Project Manager ─────────────────────────────────────
const projectModal = document.getElementById('project-modal');
const pmList       = document.getElementById('pm-list');

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
  if (!projects.length) {
    pmList.innerHTML = '<div id="pm-empty">NO SAVED PROJECTS YET<br><span style="font-size:10px;opacity:0.5;margin-top:8px;display:block;">Upload a manifest.json to create your first project</span></div>';
    return;
  }
  const active = localStorage.getItem('dagcity_active_project');
  pmList.innerHTML = '';
  projects.forEach(p => {
    const isActive = p.name === active;
    const date = p.created_at ? new Date(p.created_at).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : 'Unknown date';
    const isLive = p.source === 'local_sync' || p.source === 'live_sync';
    
    const row = document.createElement('div');
    row.className = `pm-project-row ${isActive ? 'active' : ''}`;
    
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
        </div>
      </div>
      <div class="pm-project-actions">
        <button class="pm-btn pm-btn-load" onclick="window._loadProject('${p.name}')">LOAD</button>
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
    if (!res.ok) throw new Error('Not found');
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
  const active = localStorage.getItem('dagcity_active_project');
  try {
    await fetch('/api/projects/' + encodeURIComponent(name), { method: 'DELETE' });
    if (active === name) localStorage.removeItem('dagcity_active_project');
    openProjectModal();
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
  const dockRotate = document.getElementById('dock-rotate');
  const dockPerf   = document.getElementById('dock-perf');
  const dockReset  = document.getElementById('dock-reset');
  const labelRotate = document.getElementById('label-rotate');
  const labelPerf   = document.getElementById('label-perf');

  dockRotate.addEventListener('click', () => {
    resetSelection();
    if (!controls) return;
    controls.autoRotate = !controls.autoRotate;
    dockRotate.classList.toggle('active', controls.autoRotate);
    labelRotate.textContent = controls.autoRotate ? 'AUTO-ROTATE: ON' : 'AUTO-ROTATE: OFF';
    if (controls.autoRotate) {
      const farPos = camera.position.clone().normalize().multiplyScalar(450); farPos.y = 110;
      tweenCamera(farPos, {x:0,y:0,z:0}, 2000);
    }
  });

  dockPerf.addEventListener('click', () => {
    State.set('perfMode', !State.perfMode);
    dockPerf.classList.toggle('perf-on', State.perfMode);
    labelPerf.textContent = State.perfMode ? 'PERFORMANCE 3D: ON' : 'PERFORMANCE 3D: OFF';
    meshes.forEach(m => {
      const ud = m.userData;
      ud.targetH = State.perfMode ? ud.perfH : ud.baseH;
      if (ud.hazard) ud.hazard.visible = !State.perfMode;
    });
  });

  dockReset.addEventListener('click', () => {
    tweenCamera(INIT_CAM, {x:0,y:0,z:0}, 1200);
    if (controls) {
      controls.autoRotate = true;
      dockRotate.classList.add('active'); labelRotate.textContent = 'AUTO-ROTATE: ON';
    }
    sidebar.classList.remove('open'); resetSelection();
  });

  document.getElementById('sb-close').addEventListener('click', closeSidebar);
  document.getElementById('dock-projects').addEventListener('click', openProjectModal);
  document.getElementById('pm-close').addEventListener('click', () => projectModal.classList.remove('open'));
  document.getElementById('pm-new-project').addEventListener('click', startNewProject);
  projectModal.addEventListener('click', e => { if (e.target === projectModal) projectModal.classList.remove('open'); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') projectModal.classList.remove('open'); });
  initStatusHUD();
  initSettings();
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

  renderer.domElement.addEventListener('mousemove', e => {
    mouse.x = (e.clientX/window.innerWidth)*2-1;
    mouse.y = -(e.clientY/window.innerHeight)*2+1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(meshes, true);
    let foundNode = null, foundMesh = null;
    for (const h of hits) {
      foundNode = findNodeInHierarchy(h.object);
      if (foundNode) { let o = h.object; while(o && !meshes.includes(o)) o = o.parent; foundMesh = o; break; }
    }
    if (hoveredBuilding && hoveredBuilding !== foundMesh) {
      hoveredBuilding.userData.isHovered = false;
      hoveredBuilding = null;
    }
    if (foundNode) {
      if (foundMesh) { foundMesh.userData.isHovered = true; hoveredBuilding = foundMesh; }
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX+15)+'px'; tooltip.style.top = (e.clientY-38)+'px';
      tooltip.style.color = foundNode.color;
      tooltip.innerHTML = `<strong>${foundNode.name}</strong><br><span style="color:#555;font-size:11px">${foundNode.layer.toUpperCase()} · ${foundNode.execution_time?.toFixed(2)}s</span>`;
      renderer.domElement.style.cursor = 'pointer';
    } else {
      tooltip.style.display = 'none'; renderer.domElement.style.cursor = 'default';
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
    const hits = raycaster.intersectObjects(meshes, false);
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
        if (controls) {
          controls.autoRotate = false;
          document.getElementById('dock-rotate').classList.remove('active');
          const lbl = document.getElementById('label-rotate'); if (lbl) lbl.textContent = 'AUTO-ROTATE: OFF';
        }
        const buildingPos = m.position.clone();
        const currentDir = camera.position.clone().sub(controls.target).normalize();
        const destPos = buildingPos.clone().add(currentDir.multiplyScalar(120));
        tweenCamera(destPos, buildingPos.clone().add(new THREE.Vector3(0,10,0)), 1200);
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
  document.getElementById('dock-sla').addEventListener('click', toggleSlaPanel);
  document.getElementById('sla-close').addEventListener('click', toggleSlaPanel);

  const globalInput = document.getElementById('sla-global-input');
  const globalFill  = document.getElementById('sla-global-fill');
  const globalVal   = document.getElementById('sla-global-val');

  const syncGlobal = val => {
    State.userDefinedSLA = val;
    globalInput.value = val;
    globalFill.style.width = Math.round((val/1000)*100) + '%';
    globalVal.textContent  = val + 's';
    updateFires(); saveSLAToProject();
  };

  globalInput.addEventListener('input', () => syncGlobal(parseInt(globalInput.value)));
  handleManualSLAInput(globalVal, syncGlobal);

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
    text.textContent = 'LIVE SYNC';
    text.style.color = '#39ff14';
  } else {
    dot.className = 'status-dot orange';
    text.textContent = 'OFFLINE';
    text.style.color = '#ffaa00';
  }
}

export function initHUD(renderer) {
  const smartHUD   = document.getElementById('smart-hud');
  const helpTrigger = document.getElementById('help-trigger-left');
  const helpHint   = document.getElementById('help-hint');
  let userInteracted = false;
  function hideHUD() {
    if (!userInteracted) { smartHUD.classList.add('hidden'); helpHint.classList.add('fade-out'); userInteracted = true; }
  }
  setTimeout(() => helpHint.classList.add('fade-out'), 10000);
  renderer.domElement.addEventListener('mousedown', hideHUD);
  renderer.domElement.addEventListener('wheel', hideHUD);
  helpTrigger.addEventListener('mouseenter', () => smartHUD.classList.remove('hidden'));
  helpTrigger.addEventListener('mouseleave', () => { if(userInteracted) smartHUD.classList.add('hidden'); });
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
