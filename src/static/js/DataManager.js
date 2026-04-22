// ═══════════════════════════════════════════════════════
// DataManager.js — fetch, SSE, drag-and-drop upload
// ═══════════════════════════════════════════════════════
import { State } from './State.js';
import { rebuildCity } from './CityEngine.js';
import { loadSLAFromProject, renderZoneSliders, renderNodeOverrides } from './UIManager.js';
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
export function initLiveSync() {
  console.log('[📡] Workspace Live Sync: Initiating connection...');
  const evtSource = new EventSource('/api/live-stream');
  evtSource.onmessage = event => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'update') {
        const active = localStorage.getItem('dagcity_active_project');
        if (msg.project === active) {
          console.log(`[📡] Live update for active project: ${msg.project}`);
          fetch(`/api/projects/${encodeURIComponent(msg.project)}`)
            .then(res => res.json())
            .then(data => rebuildCity(data, true))
            .catch(err => console.error('[📡] Live update fetch failed:', err));
        }
      } else {
        rebuildCity(msg, true);
      }
    } catch(e) { console.warn('[📡] Live Sync parse error:', e); }
  };
  evtSource.onerror = () => {
    console.warn('[📡] Live Sync connection lost. Retrying in 5s...');
    evtSource.close(); setTimeout(initLiveSync, 5000);
  };
}
