// ═══════════════════════════════════════════════════════
// DataManager.js — fetch, SSE, drag-and-drop upload
// ═══════════════════════════════════════════════════════
import { State } from './State.js';
import { rebuildCity } from './CityEngine.js';
import { loadSLAFromProject, renderZoneSliders, renderNodeOverrides, updateSyncHUD } from './UIManager.js';
import { updateFires } from './CityEngine.js';

// ── Drag & Drop upload ─────────────────────────────────
const _dzFiles = { manifest: null, run_results: null };
window._dzFiles = _dzFiles; // Exported for startNewProject in UIManager

export function dzDragOver(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.add('dz-hover');
  document.getElementById('dz-icon').className = 'dz-icon-hover';
}
export function dzDragLeave(e) {
  document.getElementById('drop-zone').classList.remove('dz-hover');
  document.getElementById('dz-icon').className = 'dz-icon-idle';
}
export function dzDrop(e) { e.preventDefault(); dzDragLeave(e); dzIngestFiles(Array.from(e.dataTransfer.files)); }
export function dzFileInput(input) { dzIngestFiles(Array.from(input.files)); input.value = ''; }

function dzIngestFiles(files) {
  const status = document.getElementById('upload-status');
  status.textContent = '';
  for (const file of files) {
    if (!file.name.endsWith('.json')) {
      status.style.color = '#ff4444';
      status.textContent = `✗ Only .json files accepted (got: ${file.name})`;
      return;
    }
    if (file.name.startsWith('manifest')) { _dzFiles.manifest = file; dzMarkSlot('manifest', file.name); }
    else if (file.name.startsWith('run_results')) { _dzFiles.run_results = file; dzMarkSlot('results', file.name); }
    else if (!_dzFiles.manifest) { _dzFiles.manifest = file; dzMarkSlot('manifest', file.name); }
    else { _dzFiles.run_results = file; dzMarkSlot('results', file.name); }
  }
  const btn = document.getElementById('az-launch-btn');
  if (_dzFiles.manifest) {
    btn.disabled = false; btn.classList.add('ready');
    status.style.color = '#00f3ff';
    status.textContent = _dzFiles.run_results
      ? '✓ manifest.json + run_results.json ready. Click LAUNCH CITY.'
      : '✓ manifest.json ready. Click LAUNCH CITY.';
  }
}

function dzMarkSlot(slotId, filename) {
  const slot  = document.getElementById('slot-' + slotId);
  const name  = document.getElementById('slot-' + slotId + '-name');
  const check = document.getElementById('slot-' + slotId + '-check');
  if (slot)  slot.classList.add('dz-slot-loaded');
  if (name)  name.textContent = filename;
  if (check) check.style.display = 'inline';
}

export async function dzLaunch() {
  if (!_dzFiles.manifest) return;
  const status = document.getElementById('upload-status');
  const loader = document.getElementById('az-loader');
  const btn    = document.getElementById('az-launch-btn');
  const lblEl  = document.getElementById('az-loader-label');
  btn.disabled = true; btn.classList.remove('ready'); loader.style.display = 'block'; status.textContent = '';

  const msgs = ['READING MANIFEST…','MAPPING DAG GRAPH…','CLASSIFYING LAYERS…','DETECTING BOTTLENECKS…','ACTIVATING GHOST PROTOCOL…','BUILDING ARCHITECTURE…'];
  let msgIdx = 0;
  const msgTimer = setInterval(() => { lblEl.textContent = msgs[Math.min(msgIdx++, msgs.length-1)]; }, 400);

  try {
    const manifestText = await _dzReadFile(_dzFiles.manifest);
    let manifestObj;
    try { manifestObj = JSON.parse(manifestText); }
    catch(e) { throw new Error(`manifest.json is not valid JSON: ${e.message}`); }
    let runResultsObj = null;
    if (_dzFiles.run_results) {
      try { runResultsObj = JSON.parse(await _dzReadFile(_dzFiles.run_results)); } catch(_) {}
    }
    lblEl.textContent = 'CALLING PARSER ENGINE…';
    const resp = await fetch('/api/upload', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ manifest: manifestObj, run_results: runResultsObj, project_name: '' }),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error || json.detail || `Server error ${resp.status}`);
    if (json.project) { localStorage.setItem('dagcity_active_project', json.project); console.log('[📁] Project saved:', json.project); }
    clearInterval(msgTimer);
    lblEl.textContent = `CITY READY — ${json.nodes.length} BUILDINGS DETECTED`;
    await _dzHideOverlay();
    rebuildCity(json, false);
  } catch(err) {
    clearInterval(msgTimer); loader.style.display = 'none';
    btn.disabled = false; btn.classList.add('ready');
    status.style.color = '#ff4444'; status.textContent = `✗ ${err.message}`;
    console.error('[DagCity] Upload error:', err);
  }
}

function _dzReadFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });
}

export function _dzHideOverlay() {
  return new Promise(resolve => {
    const overlay = document.getElementById('awaiting-overlay');
    overlay.classList.add('hiding');
    setTimeout(() => { overlay.style.display = 'none'; overlay.classList.remove('hiding'); resolve(); }, 650);
  });
}
// Also expose on window so CityEngine can call it
window._dzHideOverlay = _dzHideOverlay;

// Also expose drag-drop functions on window (called from HTML attributes)
window.dzDragOver  = dzDragOver;
window.dzDragLeave = dzDragLeave;
window.dzDrop      = dzDrop;
window.dzFileInput = dzFileInput;
window.dzLaunch    = dzLaunch;

document.getElementById('dz-cancel')?.addEventListener('click', () => _dzHideOverlay());

// ── Auto-restore project from localStorage ────────────
export async function autoRestoreProject() {
  const savedProject = localStorage.getItem('dagcity_active_project');
  if (!savedProject) return;
  const raw = State.raw;
  if (raw && raw.status !== 'awaiting_upload') {
    console.log('[📁] Active project in localStorage (city already loaded):', savedProject);
    return;
  }
  console.log('[📁] Auto-restoring project:', savedProject);
  try {
    const res = await fetch('/api/projects/' + encodeURIComponent(savedProject));
    if (!res.ok) { localStorage.removeItem('dagcity_active_project'); return; }
    const data = await res.json();
    await _dzHideOverlay();
    rebuildCity(data, false);
    console.log('[📁] Auto-restore complete:', savedProject);
  } catch(e) {
    console.error('[📁] Auto-restore failed:', e);
    localStorage.removeItem('dagcity_active_project');
  }
}

// ── Live Sync (SSE) ────────────────────────────────────
let _evtSource = null;

export async function initLiveSync() {
  if (_evtSource) return; // Already connected

  try {
    const res = await fetch('/api/status');
    const status = await res.json();
    // We connect SSE regardless, as long as it's not already connected, 
    // because it also handles internal project updates.
  } catch(e) { return; }

  console.log('[📡] Workspace Live Sync: Initiating connection...');
  _evtSource = new EventSource('/api/live-stream');

  _evtSource.onmessage = event => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'update') {
        const active = localStorage.getItem('dagcity_active_project');
        // If it's a specific project or the 'live' project signal
        if (msg.project === active || msg.project === 'live') {
          console.log(`[📡] Live update detected: ${msg.project}`);
          
          // If it's the live project, we use launch-local to re-sync
          const url = (msg.project === 'live') ? '/api/launch-local' : `/api/projects/${encodeURIComponent(msg.project)}`;
          
          fetch(url, { method: (msg.project === 'live' ? 'POST' : 'GET') })
            .then(res => res.json())
            .then(data => {
              console.log('[📡] Applying real-time update to 3D scene...');
              rebuildCity(data, true);
            })
            .catch(err => console.error('[📡] Live update fetch failed:', err));
        }
      } else {
        rebuildCity(msg, true);
      }
    } catch(e) { console.warn('[📡] Live Sync parse error:', e); }
  };
  _evtSource.onerror = () => {
    console.warn('[📡] Live Sync connection lost. Retrying in 5s...');
    _evtSource.close(); _evtSource = null; setTimeout(initLiveSync, 5000);
  };
}

// ── One-Click Live Connect ─────────────────────────────
export async function connectLocal() {
  const btn = document.getElementById('btn-connect-local');
  const lpStatus = document.getElementById('lp-status');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
  if (lpStatus) lpStatus.textContent = 'SCANNING VOLUME…';

  try {
    const res = await fetch('/api/check-local');
    const data = await res.json();

    if (data.status === 'ready') {
      if (lpStatus) lpStatus.textContent = '✓ LIVE MANIFEST DETECTED';
      // Fetch and launch the city immediately
      const graphRes = await fetch('/api/upload', { method: 'POST' }).catch(() => null);
      // Assassin's Creed-style: parse the external manifest directly
      const launchRes = await fetch('/api/launch-local', { method: 'POST' });
      if (launchRes.ok) {
        const cityData = await launchRes.json();
        if (cityData.project) {
          localStorage.setItem('dagcity_active_project', cityData.project);
          localStorage.setItem('dagcity_is_live', 'true');
        }
        await _dzHideOverlay();
        rebuildCity(cityData, false);
        initLiveSync();
        updateSyncHUD('live_sync');
      } else {
        throw new Error('Launch failed');
      }
    } else {
      // Show missing–volume modal
      document.getElementById('local-missing-modal').classList.add('open');
      if (lpStatus) lpStatus.textContent = 'NO VOLUME DETECTED';
    }
  } catch(e) {
    console.error('[🔗] connectLocal error:', e);
    document.getElementById('local-missing-modal').classList.add('open');
    if (lpStatus) lpStatus.textContent = 'CONNECTION FAILED';
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  }
}

export async function initLivePipelineStatus() {
  const lpStatus = document.getElementById('lp-status');
  if (!lpStatus) return;
  try {
    const res = await fetch('/api/check-local');
    const data = await res.json();
    if (data.status === 'ready') {
      lpStatus.textContent = '✓ LIVE SYNC READY — CONNECTING…';
      lpStatus.style.color = '#39ff14';
      const btn = document.getElementById('btn-connect-local');
      if (btn) { 
        btn.style.boxShadow = '0 0 50px rgba(57,255,20,0.35)';
        btn.style.borderColor = '#39ff14';
      }
      
      // Zero-Friction: If it's ready on boot, connect automatically
      console.log('[🔗] Auto-detecting live volume. Launching...');
      connectLocal();
    } else {
      lpStatus.textContent = '❌ MANIFEST NOT FOUND — CLICK FOR HELP';
      lpStatus.style.color = '#ff4444';
      lpStatus.style.opacity = '1';
    }
  } catch(e) {
    lpStatus.textContent = 'ENVIRONMENT CHECK FAILED';
  }
}
