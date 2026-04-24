// ═══════════════════════════════════════════════════════
// CityEngine.js — Buildings, Edges, Fire, Animation Loop
// ═══════════════════════════════════════════════════════
import { State } from './State.js';
import {
  scene, camera, renderer, controls, 
  initScene, INIT_CAM, composer
} from './Visualizer.js';
import { VFXManager } from './VFXManager.js';

// CSS2DRenderer para etiquetas flotantes de volumen de datos
let labelRenderer = null;

let vfxManager = null;
const clock = new THREE.Clock();


// ── Constants ──────────────────────────────────────────
export const LAYER_X = { source: -300, staging: -100, intermediate: 100, mart: 300, consumption: 500, default: 650 };

// ── Data Volume Scaling ───────────────────────────────
const CRITICAL_VOLUME_THRESHOLD = 100000000; // 100M filas
const LOG_SCALE_FACTOR = 0.3; // Factor de escalado logarítmico

function toPositiveNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function resolveRowMetric(n) {
  const direct =
    toPositiveNumber(n.row_count) ||
    toPositiveNumber(n.rows) ||
    toPositiveNumber(n.num_rows) ||
    toPositiveNumber(n.rowCount) ||
    toPositiveNumber(n.stats?.row_count) ||
    toPositiveNumber(n.stats?.rows) ||
    toPositiveNumber(n.stats?.num_rows) ||
    toPositiveNumber(n.meta?.row_count) ||
    toPositiveNumber(n.meta?.rows) ||
    toPositiveNumber(n.meta?.num_rows);

  if (direct > 0) return { rows: Math.round(direct), estimated: false };

  const cols = Math.max(1, (n.columns || []).length || 0);
  const deps = ((n.upstream || []).length + (n.downstream || []).length);
  const nameFactor = Math.max(1, (n.name || '').length);
  const estimatedRows = Math.max(
    1000,
    Math.round((cols * 12000) + (deps * 26000) + (nameFactor * 350))
  );
  return { rows: estimatedRows, estimated: true };

}

function resolveSwellMetricValue(n, ud, metric) {
  if (metric === 'rows') {
    const { rows } = resolveRowMetric(n);
    return Math.max(1, rows);
  }

  if (metric === 'code_length') {
    const directCode =
      toPositiveNumber(n.code_length) ||
      toPositiveNumber(n.sql_length) ||
      toPositiveNumber(n.stats?.code_length) ||
      toPositiveNumber(n.meta?.code_length);
    if (directCode > 0) return directCode;
    const cols = toPositiveNumber((n.columns || []).length);
    return Math.max(1, (cols * 2500) + ((n.name || '').length * 500));
  }

  if (metric === 'connections') {
    const deps = ((n.upstream || []).length + (n.downstream || []).length);
    return Math.max(1, deps * 50000);
  }

  // Default: execution_time (mapped to larger domain for stable log scaling)
  const exec = toPositiveNumber(n.execution_time);
  return Math.max(1, exec * 100000);
}

function getSwellScaleForNode(n, ud) {
  const metric = State.dataSwellMetric || 'execution_time';
  const intensity = Math.max(0.5, Math.min(3.0, Number(State.dataSwellIntensity) || 1.0));
  const metricValue = resolveSwellMetricValue(n, ud, metric);
  const userDefinedThreshold = Math.max(
    1,
    Number(State.referenceThreshold || State.autoMaxThreshold || 1)
  );

  const weight = Math.min(metricValue / userDefinedThreshold, 1.0);
  const finalWeight = Math.sqrt(weight);
  const blendedWeight = (weight * 0.3) + (finalWeight * 0.7);

  const metricProfile = {
    rows: { gamma: 0.72, widthGain: 2.55, heightGain: 0.92 },
    execution_time: { gamma: 0.95, widthGain: 1.75, heightGain: 0.58 },
    code_length: { gamma: 0.82, widthGain: 2.15, heightGain: 0.70 },
    connections: { gamma: 0.78, widthGain: 2.30, heightGain: 0.76 },
  }[metric] || { gamma: 0.82, widthGain: 2.10, heightGain: 0.70 };

  const profiledWeight = Math.pow(Math.max(0, blendedWeight), metricProfile.gamma);

  const widthScale = 1.0 + (profiledWeight * intensity * metricProfile.widthGain);
  const heightScale = 1.0 + (profiledWeight * intensity * metricProfile.heightGain);

  return {
    widthScale: Math.max(1.0, Math.min(widthScale, 12.0)),
    heightScale: Math.max(1.0, Math.min(heightScale, 4.5)),
    weight: profiledWeight,
  };
}

function getSwellThresholdRatios() {
  const warnPct = Math.max(10, Math.min(95, Number(State.swellWarnThresholdPct) || 60));
  const criticalPct = Math.max(warnPct + 1, Math.min(200, Number(State.swellCriticalThresholdPct) || 100));
  return { warnRatio: warnPct / 100, criticalRatio: criticalPct / 100 };
}

function getSwellSeverity(n, ud) {
  const metric = State.dataSwellMetric || 'execution_time';
  const metricValue = resolveSwellMetricValue(n, ud, metric);
  const threshold = Math.max(1, Number(State.referenceThreshold || State.autoMaxThreshold || 1));
  const ratio = metricValue / threshold;
  const { warnRatio, criticalRatio } = getSwellThresholdRatios();

  if (ratio >= criticalRatio) return { level: 'high', ratio };
  if (ratio >= warnRatio) return { level: 'mid', ratio };
  return { level: 'low', ratio };
}

function getSeverityStyle(level) {
  if (level === 'high') {
    return {
      color: '#ff4400',
      borderColor: '#ff4400',
      boxShadow: '0 0 10px rgba(255,68,0,0.5)',
      textShadow: '0 0 5px rgba(255,68,0,0.5)',
    };
  }
  if (level === 'mid') {
    return {
      color: '#ffd700',
      borderColor: '#ffd700',
      boxShadow: '0 0 10px rgba(255,215,0,0.45)',
      textShadow: '0 0 5px rgba(255,215,0,0.45)',
    };
  }
  return {
    color: '#00f3ff',
    borderColor: '#00f3ff',
    boxShadow: '0 0 10px rgba(0,243,255,0.3)',
    textShadow: '0 0 5px rgba(0,243,255,0.5)',
  };
}

function formatCompactNumber(value) {
  if (!value || value < 0) return '0';
  if (value >= 1000000000) return (value / 1000000000).toFixed(1) + 'B';
  if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
  if (value >= 1000) return (value / 1000).toFixed(1) + 'k';
  return Math.round(value).toString();
}

function formatSwellLabel(n, ud) {
  const metric = State.dataSwellMetric || 'execution_time';

  if (metric === 'rows') {
    const { rows, estimated } = resolveRowMetric(n);
    const base = formatRowCount(rows);
    return estimated ? `~${base}` : `✓${base}`;
  }

  if (metric === 'code_length') {
    const value = resolveSwellMetricValue(n, ud, metric);
    return `${formatCompactNumber(value)} code`;
  }

  if (metric === 'connections') {
    const deps = ((n.upstream || []).length + (n.downstream || []).length);
    return `${deps} links`;
  }

  const exec = toPositiveNumber(n.execution_time);
  return `${exec.toFixed(2)}s`;
}

/**
 * Calcula la escala normalizada usando escalado logarítmico.
 * Esto asegura que tablas de 1B de filas no rompan la cámara 
 * y las de 1k sean visibles.
 * @param {number} value - Valor numérico (ej. número de filas)
 * @param {string} metricType - Tipo de métrica ('rows', 'bytes', etc.)
 * @returns {number} - Factor de escala
 */
export function getNormalizedScale(value, metricType = 'rows') {
  if (!value || value <= 0) return 1.0;
  
  // Escalado logarítmico: scale = Math.log10(value + 1) * factor
  const scale = Math.log10(value + 1) * LOG_SCALE_FACTOR;
  
  // Clamp para evitar extremos
  return Math.max(1.08, Math.min(scale, 8.0));
}

/**
 * Formatea el número de filas para mostrar (ej. "1.2M rows", "450k rows")
 * @param {number} rows - Número de filas
 * @returns {string} - Texto formateado
 */
export function formatRowCount(rows) {
  if (!rows || rows < 0) return '0 rows';
  
  if (rows >= 1000000000) {
    return (rows / 1000000000).toFixed(1) + 'B rows';
  } else if (rows >= 1000000) {
    return (rows / 1000000).toFixed(1) + 'M rows';
  } else if (rows >= 1000) {
    return (rows / 1000).toFixed(1) + 'k rows';
  }
  return rows + ' rows';
}

/**
 * Verifica si el volumen es crítico (>100M filas)
 * @param {number} rows - Número de filas
 * @returns {boolean}
 */
export function isCriticalVolume(rows) {
  return rows > CRITICAL_VOLUME_THRESHOLD;
}

// ── Shared mutable state (city runtime) ───────────────
export const meshes = [];
export const nodeMeshMap = {};
export const edgeObjs = [];
export const voxels  = [];
export const nodeMap = {};
export const islandLabels = [];

export let maxTime = 0, minTime = 0, hasReal = false;
export let buildStart = performance.now();
export let selectedNode = null;
export let critSet = new Set();

// Camera tween state
let camTween = null;

// Build animation state
const VOXEL_PROG = 400;
let syncComplete = false;
let maxRadius = 0;

// ── Texture factories ─────────────────────────────────
function makeFlameTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(S/2, S, S/2, 0);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.2, '#fff700');
  g.addColorStop(0.4, '#ff6600'); g.addColorStop(0.7, '#ff3300'); g.addColorStop(1, 'transparent');
  ctx.fillStyle = g; ctx.beginPath();
  ctx.moveTo(S/2, 0);
  ctx.bezierCurveTo(S*0.8, S*0.2, S*0.9, S*0.6, S*0.75, S);
  ctx.lineTo(S*0.25, S);
  ctx.bezierCurveTo(S*0.1, S*0.6, S*0.2, S*0.2, S/2, 0);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.moveTo(S/2, S*0.3); ctx.bezierCurveTo(S*0.6, S*0.5, S*0.6, S*0.8, S/2, S*0.9);
  ctx.bezierCurveTo(S*0.4, S*0.8, S*0.4, S*0.5, S/2, S*0.3);
  ctx.fill();
  return new THREE.CanvasTexture(c);
}
function makeSmokeTexture() {
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
  g.addColorStop(0, 'rgba(40,40,45,0.3)'); g.addColorStop(1, 'transparent');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}
function makeEmberTexture() {
  const S = 32, c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#ffaa00'); g.addColorStop(1, 'transparent');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

let FLAME_TEX, SMOKE_TEX, EMBER_TEX;

function ensureTextures() {
  if (FLAME_TEX) return;
  console.log('[CityEngine] Creating procedural textures...');
  FLAME_TEX = makeFlameTexture();
  SMOKE_TEX = makeSmokeTexture();
  EMBER_TEX = makeEmberTexture();
}


// ── Helper functions ───────────────────────────────────
export function easeOutBack(x) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

export function getLineageSets(id) {
  const ancestors = new Set(), descendants = new Set();
  const n = nodeMap[id];
  if (n) {
    // Level 1 only: Direct parents and children
    (n.upstream || []).forEach(u => ancestors.add(u));
    (n.downstream || []).forEach(d => descendants.add(d));
  }
  return { ancestors, descendants };
}

export function findNodeInHierarchy(obj) {
  let o = obj;
  while (o) { if (o.userData && o.userData.node) return o.userData.node; o = o.parent; }
  return null;
}

function makeFaceTex(label, hex, layer) {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, S, S);
  const bg = layer==='source'?['#05200a','#0a3010']:layer==='staging'?['#200520','#300830']:layer==='mart'?['#001e22','#003035']:['#0d0d12','#181820'];
  g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]); ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = hex+'22'; ctx.lineWidth = 1;
  for (let i = 0; i < S; i += 28) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke(); }
  for (let y = 0; y < S; y += 4) { ctx.fillStyle = 'rgba(0,0,0,0.1)'; ctx.fillRect(0, y, S, 2); }
  ctx.strokeStyle = hex; ctx.lineWidth = 3;
  [[14,14,1,1],[S-14,14,-1,1],[14,S-14,1,-1],[S-14,S-14,-1,-1]].forEach(([x,y,dx,dy]) => {
    ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+dx*26,y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x,y+dy*26); ctx.stroke();
  });
  ctx.shadowColor = hex; ctx.shadowBlur = 26; ctx.strokeStyle = hex+'99'; ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, S-36, S-36); ctx.shadowBlur = 0;
  return new THREE.CanvasTexture(c);
}

export function makeTimeSprite(text, isBottleneck) {
  const S = 512, c = document.createElement('canvas'); c.width = S; c.height = 200;
  const ctx = c.getContext('2d');
  const col = isBottleneck ? '#ff0000' : '#00f3ff';
  const fontSize = isBottleneck ? 120 : 80;
  ctx.font = `bold ${fontSize}px 'Courier New'`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = col; ctx.shadowBlur = 30; ctx.fillStyle = col;
  ctx.fillText(text, S/2, 100);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, transparent:true, depthTest:false, blending: THREE.AdditiveBlending}));
  const scaleMult = isBottleneck ? 2.5 : 1.2;
  sp.scale.set(30 * scaleMult, 12 * scaleMult, 1);
  sp.raycast = () => {};
  return sp;
}

function makeSprite(text, hex) {
  const fontSize = text.length > 30 ? 38 : text.length > 20 ? 48 : 64;
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.font = `bold ${fontSize}px 'Courier New'`;
  const textWidth = tempCtx.measureText(text).width;
  const padding = 100;
  const SW = Math.max(512, textWidth + padding), SH = 120;
  const c = document.createElement('canvas'); c.width = SW; c.height = SH;
  const ctx = c.getContext('2d'); ctx.clearRect(0, 0, SW, SH);
  ctx.fillStyle = 'rgba(0,5,14,0.88)';
  const r = 24;
  ctx.beginPath(); ctx.moveTo(r,0); ctx.lineTo(SW-r,0); ctx.quadraticCurveTo(SW,0,SW,r);
  ctx.lineTo(SW,SH-r); ctx.quadraticCurveTo(SW,SH,SW-r,SH); ctx.lineTo(r,SH);
  ctx.quadraticCurveTo(0,SH,0,SH-r); ctx.lineTo(0,r); ctx.quadraticCurveTo(0,0,r,0); ctx.fill();
  ctx.font = tempCtx.font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = hex; ctx.shadowBlur = 40; ctx.fillStyle = hex; ctx.fillText(text, SW/2, SH/2);
  ctx.shadowBlur = 15; ctx.fillStyle = '#fff'; ctx.fillText(text, SW/2, SH/2);
  ctx.shadowBlur = 4; ctx.fillStyle = '#fff'; ctx.fillText(text, SW/2, SH/2);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, transparent:true, depthTest:false}));
  const ratio = SW/SH;
  sp.scale.set(13 * ratio, 13, 1); sp.userData.ratio = ratio; sp.raycast = () => {};
  return sp;
}

function makeHazardSprite() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 90px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(255,0,0,0.8)'; ctx.shadowBlur = 15; ctx.fillStyle = '#ff2222';
  ctx.fillText('⚠️', S/2, S/2);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, transparent:true, depthTest:false}));
  sp.scale.set(15, 15, 1);
  return sp;
}

function makeVoxelMesh(col) {
  const geo = new THREE.BoxGeometry(10, 10, 10);
  const mat = new THREE.MeshStandardMaterial({color:col, emissive:'#00f2ff', emissiveIntensity:2.0, transparent:true, opacity:0.9, blending:THREE.AdditiveBlending});
  const m = new THREE.Mesh(geo, mat); m.scale.setScalar(0);
  return m;
}

// ── Height Calculation ─────────────────────────────────
export function calcHeight(n, perf) {
  if (perf) {
    const norm = maxTime > minTime ? (n.execution_time - minTime) / (maxTime - minTime) : 0.5;
    return 6 + norm * 64;
  }
  return 14 + (n.downstream?.length || 0) * 5 + (n.upstream?.length || 0) * 2;
}

// ── Building Factory ───────────────────────────────────
export function buildBuilding(n) {
  const col = n.color || '#ffffff', emis = n.emissive || '#000000';
  const h = calcHeight(n, false), ph = calcHeight(n, true);
  
  // Calcular escala basada en volumen de datos (para modo Data Swell)
  const { rows: rowCount, estimated: rowCountEstimated } = resolveRowMetric(n);
  const swellScale = getSwellScaleForNode(n, null);
  const volumeScale = swellScale.widthScale;
  const severity = getSwellSeverity(n, null);
  const isCritical = severity.level === 'high';
  
  // Ancho y profundidad base
  const baseW = 13, baseD = 13;
  // En modo Data Swell, X y Z se escalan por volumen, Y (altura) permanece igual
  const w = baseW, d = baseD;
  const swellW = baseW * volumeScale;
  const swellD = baseD * volumeScale;

  const ftex  = makeFaceTex(n.name, col, n.layer || 'default');
  const sideM = new THREE.MeshStandardMaterial({color:col,emissive:emis,emissiveIntensity:0.1,roughness:0.45,metalness:0.6});
  const topM  = new THREE.MeshStandardMaterial({color:new THREE.Color(col).multiplyScalar(0.7),emissive:emis,emissiveIntensity:0.1,roughness:0.3,metalness:0.9});
  const botM  = new THREE.MeshStandardMaterial({color:new THREE.Color(col).multiplyScalar(0.15),roughness:1});
  const faceM = new THREE.MeshStandardMaterial({map:ftex,emissive:emis,emissiveIntensity:0.1,roughness:0.2});

  if (n.is_dead_end) { [sideM, topM, faceM].forEach(m => { m.transparent = true; m.opacity = 0.35; }); }

  const geo  = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, h/2, 0);
  const mesh = new THREE.Mesh(geo, [sideM, sideM, topM, botM, faceM, sideM]);
  if (n.is_dead_end) mesh.renderOrder = 5;
  mesh.position.set(n.x, 0, n.z);
  mesh.castShadow = true;

  const voxel = makeVoxelMesh(col);
  voxel.position.set(n.x, 0, n.z);
  voxel.userData.dist = Math.sqrt(n.x * n.x + n.z * n.z);
  scene.add(voxel); voxels.push(voxel);

  mesh.visible = false;
  mesh.userData = { 
    node:n, baseH:h, perfH:ph, targetH:h, currentH:h, baseEmis:emis, voxel,
    volumeScale, swellW, swellD, baseW, baseD, rowCount, rowCountEstimated, isCritical,
    swellHeightScale: swellScale.heightScale
  };

  if (n.is_dead_end) { const hazard = makeHazardSprite(); mesh.add(hazard); mesh.userData.hazard = hazard; hazard.visible = !State.perfMode; }

  // Neon edges
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({color:col,transparent:true,opacity:0.85})));

  // Halo point light
  const halo = new THREE.PointLight(0xff4400, 3.5, 60);
  halo.position.set(0, h/2, 0); halo.name = 'halo'; halo.visible = false;
  mesh.add(halo);

  // Thermal Degradation VFX
  if (!vfxManager) vfxManager = new VFXManager(scene);
  const thermalGroup = vfxManager.createThermalGroup(h);
  mesh.add(thermalGroup);

  const glow = new THREE.PointLight(col, 1.5, 42);
  glow.position.set(0, 2, 0); mesh.add(glow);

  const sp = makeSprite(n.name, col);
  sp.position.set(0, h + 8, 0); sp.name = 'label'; mesh.add(sp); mesh.userData.label = sp;

  const timeSp = makeTimeSprite(`${n.execution_time.toFixed(2)}s`, n.is_bottleneck);
  timeSp.position.set(0, h + 25, 0); timeSp.visible = false; timeSp.name = 'timeLabel';
  mesh.add(timeSp); mesh.userData.timeLabel = timeSp;

  // ── Data Volume Label (CSS2DObject) ────────────────────
  const volumeDiv = document.createElement('div');
  volumeDiv.className = 'data-volume-label';
  volumeDiv.textContent = formatSwellLabel(n, null);
  const initialStyle = getSeverityStyle(severity.level);
  volumeDiv.style.cssText = `
    background: rgba(0,0,0,0.7);
    color: ${initialStyle.color};
    padding: 6px 12px;
    border-radius: 6px;
    font-family: 'Courier New', monospace;
    font-size: 12px;
    font-weight: bold;
    border: 1px solid ${initialStyle.borderColor};
    box-shadow: ${initialStyle.boxShadow};
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s;
    white-space: nowrap;
    text-shadow: ${initialStyle.textShadow};
  `;
  
  const CSS2DObject = window.CSS2DObject || (THREE.CSS2DObject);
  if (CSS2DObject) {
    const volumeLabel = new CSS2DObject(volumeDiv);
    volumeLabel.position.set(0, h + 24, 0);
    volumeLabel.name = 'volumeLabel';
    mesh.add(volumeLabel);
    mesh.userData.volumeLabel = volumeLabel;
    mesh.userData.volumeDiv = volumeDiv;
    mesh.userData.volumeLabelOffset = 28;
    mesh.userData.lastSwellMetric = State.dataSwellMetric || 'execution_time';
    mesh.userData.lastSwellSeverity = severity.level;
  }

  // ── Critical Volume Pulse Effect (dynamic severity) ───
  const pulseLight = new THREE.PointLight(0xff4400, 2.0, 40);
  pulseLight.position.set(0, 2, 0);
  pulseLight.name = 'pulseLight';
  pulseLight.visible = false;
  mesh.add(pulseLight);
  mesh.userData.pulseLight = pulseLight;

  mesh.scale.y = 0;
  scene.add(mesh); meshes.push(mesh); nodeMeshMap[n.id] = mesh;
  return mesh;
}

// ── Edge Factory ───────────────────────────────────────
export function buildEdge(link) {
  const srcId = typeof link.source==='object'?link.source.id:link.source;
  const tgtId = typeof link.target==='object'?link.target.id:link.target;
  const src = nodeMap[srcId], tgt = nodeMap[tgtId];
  if (!src || !tgt) return;
  
  const isInterIsland = (src.group || 'default') !== (tgt.group || 'default');

  const A = new THREE.Vector3(src.x, 10, src.z);
  const B = new THREE.Vector3(tgt.x, 10, tgt.z);
  
  let midY = 22;
  let color = 0x0a3344;
  let opacity = 0.45;
  let particleColor = 0xffffff;
  let pSize = 0.75;
  
  if (isInterIsland) {
    const dist = A.distanceTo(B);
    midY = Math.max(400, dist * 0.35); 
    color = 0xffdf00; // Neon Gold
    opacity = 0.8;
    particleColor = 0xffffff;
    pSize = 2.5;
  }

  const mid = A.clone().lerp(B, 0.5).add(new THREE.Vector3(0, midY, 0));
  const curve = new THREE.QuadraticBezierCurve3(A, mid, B);
  const pts = curve.getPoints(isInterIsland ? 80 : 42);
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({color, transparent:true, opacity});
  const line = new THREE.Line(geo, mat); scene.add(line);
  
  const N = isInterIsland ? 12 : 5;
  const particles = [];
  for (let i = 0; i < N; i++) {
    const pGeo = new THREE.SphereGeometry(pSize, 8, 8);
    const pMat = new THREE.MeshBasicMaterial({color: particleColor, transparent:true, opacity: isInterIsland ? 0.8 : 0.25});
    const p = new THREE.Mesh(pGeo, pMat);
    const tgtNode = nodeMap[tgtId];
    const isAccelerated = tgtNode && tgtNode.layer === 'mart';
    const baseSpeed = isInterIsland ? 0.002 : 0.005;
    p.userData = { curve, t: i/N, speed: isAccelerated ? baseSpeed * 1.8 : baseSpeed };
    scene.add(p); particles.push(p);
  }
  edgeObjs.push({ line, particles, curve, src: srcId, tgt: tgtId, isInterIsland });
}

// ── SLA Fire Logic ─────────────────────────────────────
export function getNodeSLA(node) {
  if (State.slaNodes[node.id]    !== undefined) return State.slaNodes[node.id];
  if (State.slaZones[node.layer] !== undefined) return State.slaZones[node.layer];
  return State.userDefinedSLA;
}

export function updateFires() {
  let count = 0;
  meshes.forEach(m => {
    const n = m.userData.node; if (!n) return;
    const threshold = getNodeSLA(n);
    const wasBottleneck = n.is_bottleneck;
    n.is_bottleneck = (n.execution_time || 0) >= threshold;
    if (n.is_bottleneck) count++;

    const fire = m.children.find(c => c.name === 'fire');
    const halo = m.children.find(c => c.name === 'halo');
    if (fire) fire.visible = n.is_bottleneck && State.perfMode && m.visible;
    if (halo) halo.visible = n.is_bottleneck && State.perfMode && m.visible;

    if (wasBottleneck !== n.is_bottleneck && m.userData.timeLabel) {
      const oldSprite = m.userData.timeLabel;
      const newSprite = makeTimeSprite(`${n.execution_time.toFixed(2)}s`, n.is_bottleneck);
      newSprite.position.copy(oldSprite.position);
      newSprite.scale.copy(oldSprite.scale);
      newSprite.visible   = oldSprite.visible;
      newSprite.name      = 'timeLabel';
      m.remove(oldSprite);
      if (oldSprite.material?.map) oldSprite.material.map.dispose();
      m.add(newSprite);
      m.userData.timeLabel = newSprite;
    }
  });
  const el = document.getElementById('sla-fire-count');
  if (el) el.textContent = count;
}

// ── Selection ──────────────────────────────────────────
export function applySelection(node) {
  const blastMode = !!State.blastRadiusSourceId && Array.isArray(State.blastRadiusIds) && State.blastRadiusIds.length > 0;
  const blastSet = blastMode ? new Set(State.blastRadiusIds) : new Set();
  const blastSourceId = blastMode ? State.blastRadiusSourceId : null;
  let focusNode = node;

  if (blastMode && blastSourceId && nodeMap[blastSourceId]) {
    focusNode = nodeMap[blastSourceId];
  }

  critSet = new Set();
  State.set('selectedNode', focusNode);
  const highlightColor = focusNode ? new THREE.Color(focusNode.color) : new THREE.Color(0x00d4e8);
  
  let ancSet = new Set(), descSet = new Set();
  if (focusNode) {
    if (blastMode) {
      critSet = new Set(blastSet);
    } else {
      const sets = getLineageSets(focusNode.id);
      ancSet = sets.ancestors;
      descSet = sets.descendants;
      critSet = new Set([...ancSet, ...descSet]);
    }
  }

  meshes.forEach(m => {
    const n = m.userData.node; if (!n) return;
    const id = n.id;
    const inSet = focusNode ? critSet.has(id) : true;
    const isBlastSource = blastMode && blastSourceId === id;
    m.children.forEach(child => {
      // GHOST MODE: Subtle outlines and labels for reference
      if (child.isLineSegments) child.material.opacity = inSet ? (isBlastSource ? 1.0 : 0.92) : (blastMode ? 0.03 : 0.05);
      if (child.isLight)  child.intensity = inSet ? (isBlastSource ? 6.2 : 2.0) : 0.0;
      if (child.isSprite) child.material.opacity = inSet ? 1.0 : (blastMode ? 0.03 : 0.08);
    });
  });
  edgeObjs.forEach(e => {
    // CRITICAL FIX: Only light edges that DIRECTLY TOUCH the selected cube
    const inPath = blastMode
      ? (blastSet.has(e.src) && blastSet.has(e.tgt))
      : (focusNode ? (e.src === focusNode.id || e.tgt === focusNode.id) : true);
    
    const ghostColor = new THREE.Color(0x0a1114);
    const blastColor = new THREE.Color(0xff4400);
    const defaultColor = new THREE.Color(e.isInterIsland ? 0xffdf00 : 0x0a3344);
    
    e.line.material.opacity   = focusNode ? (inPath ? (e.isInterIsland ? 0.8 : 1.0) : (blastMode ? 0.0 : 0.0)) : (e.isInterIsland ? 0.8 : 0.45);
    e.line.material.color.copy(focusNode ? (inPath ? (blastMode ? blastColor : highlightColor) : ghostColor) : defaultColor);
    e.line.renderOrder = inPath ? 10 : 0;
    
    e.particles.forEach(p => {
      p.material.opacity = focusNode ? (inPath ? (e.isInterIsland ? 0.8 : 1.0) : 0.0) : (e.isInterIsland ? 0.8 : 0.25);
      p.material.color.copy(focusNode && inPath ? (blastMode ? blastColor : highlightColor) : new THREE.Color(0xffffff));
      p.scale.setScalar(inPath && focusNode ? 2.5 : 1.0);
    });
  });
  State.set('selectedNode', focusNode);
}

export function resetSelection() {
  State.set('blastRadiusSourceId', null);
  State.set('blastRadiusIds', []);
  critSet = new Set();
  applySelection(null);
  edgeObjs.forEach(e => e.particles.forEach(p => { p.material.opacity = 0.25; p.scale.setScalar(1.0); }));
}

export function applyBlastRadius(sourceId, impactedIds) {
  if (!sourceId || !Array.isArray(impactedIds) || !impactedIds.length) {
    State.set('blastRadiusSourceId', null);
    State.set('blastRadiusIds', []);
    applySelection(State.selectedNode || null);
    return;
  }
  State.set('blastRadiusSourceId', sourceId);
  State.set('blastRadiusIds', impactedIds);
  const sourceNode = nodeMap[sourceId] || State.selectedNode;
  applySelection(sourceNode || null);
}

// ── Camera Tween ───────────────────────────────────────
export function tweenCamera(to, toTarget, dur=1200) {
  camTween = {
    sp: camera.position.clone(), st: controls.target.clone(),
    ep: new THREE.Vector3(to.x, to.y, to.z),
    et: new THREE.Vector3(toTarget.x, toTarget.y, toTarget.z),
    start: performance.now(), dur
  };
}

export function flyToNode(nodeNameOrId) {
  if (!nodeNameOrId) return;
  const key = String(nodeNameOrId).toLowerCase();
  const targetNode = Object.values(nodeMap).find((n) => {
    return String(n.id).toLowerCase() === key || String(n.name).toLowerCase() === key;
  });
  if (!targetNode) return;

  const targetMesh = nodeMeshMap[targetNode.id];
  if (!targetMesh || !controls || !camera) return;

  applySelection(targetNode);
  const buildingPos = targetMesh.position.clone();
  const currentDir = camera.position.clone().sub(controls.target).normalize();
  const destPos = buildingPos.clone().add(currentDir.multiplyScalar(140));
  tweenCamera(destPos, buildingPos.clone().add(new THREE.Vector3(0, 12, 0)), 1100);
}

// ── Rebuild City ───────────────────────────────────────
export function updateSyncMetrics() {
  maxRadius = 0;
  meshes.forEach(m => { const d = m.userData.voxel ? m.userData.voxel.userData.dist : 0; if (d > maxRadius) maxRadius = d; });
  syncComplete = false;
}

export function rebuildCity(graphData, isLiveSync = false) {
  const nodes = graphData.nodes || [];
  const links = graphData.links || [];

  const overlay = document.getElementById('awaiting-overlay');
  if (nodes.length > 0 && overlay && overlay.style.display !== 'none') {
    _dzHideOverlay();
  }

  if (isLiveSync && meshes.length > 0 && nodes.length === meshes.length) {
    console.log('[📡] Smooth height transition...');
    nodes.forEach(n => {
      const m = nodeMeshMap[n.id];
      if (m) {
        nodeMap[n.id] = n;
        m.userData.perfH   = calcHeight(n, true);
        m.userData.baseH   = calcHeight(n, false);
        m.userData.targetH = State.perfMode ? m.userData.perfH : m.userData.baseH;
        m.userData.node    = n;
        if (m.userData.timeLabel) {
          m.userData.timeLabel.material.map.dispose();
          const s = makeTimeSprite(`${n.execution_time.toFixed(2)}s`, n.is_bottleneck);
          m.userData.timeLabel.material.map = s.material.map;
        }
      }
    });
    maxTime = nodes.length ? Math.max(...nodes.map(n => n.execution_time || 0)) : 0;
    minTime = nodes.length ? Math.min(...nodes.map(n => n.execution_time || 0)) : 0;
    hasReal = graphData.metadata?.has_real_times || false;
    State.set('raw', graphData);
    State.emit('city:rebuilt', graphData);
    return;
  }

  // Full rebuild
  if (!isLiveSync) {
    tweenCamera(INIT_CAM, {x:0,y:0,z:0}, 1800);
    controls.autoRotate = true;
    const dockRotate = document.getElementById('dock-rotate');
    if (dockRotate) {
      dockRotate.classList.add('active');
      const lbl = document.getElementById('label-rotate');
      if (lbl) lbl.textContent = 'AUTO-ROTATE: ON';
    }
  }

  [...meshes].forEach(m => {
    scene.remove(m);
    if (m.geometry) m.geometry.dispose();
    if (Array.isArray(m.material)) m.material.forEach(mt => mt.dispose());
    else if (m.material) m.material.dispose();
  });
  meshes.length = 0;
  voxels.forEach(v => { scene.remove(v); if (v.geometry) v.geometry.dispose(); if (v.material) v.material.dispose(); });
  voxels.length = 0;
  Object.keys(nodeMeshMap).forEach(k => delete nodeMeshMap[k]);
  edgeObjs.forEach(e => {
    scene.remove(e.line); if (e.line.geometry) e.line.geometry.dispose();
    e.particles.forEach(p => { scene.remove(p); if (p.geometry) p.geometry.dispose(); });
  });
  edgeObjs.length = 0;
  Object.keys(nodeMap).forEach(k => delete nodeMap[k]);
  
  islandLabels.forEach(l => {
    scene.remove(l);
    if (l.material && l.material.map) l.material.map.dispose();
    if (l.material) l.material.dispose();
  });
  islandLabels.length = 0;
  
  // Preserve selection if possible
  const prevSelectedId = selectedNode ? selectedNode.id : null;
  selectedNode = null; critSet = new Set();

  maxTime = nodes.length ? Math.max(...nodes.map(n => n.execution_time || 0)) : 0;
  minTime = nodes.length ? Math.min(...nodes.map(n => n.execution_time || 0)) : 0;
  hasReal = graphData.metadata?.has_real_times || false;

  const projects = [...new Set(nodes.map(n => n.group || 'default'))];
  const projectCenters = {};
  const radius = projects.length > 1 ? Math.max(600, projects.length * 300) : 0;
  projects.forEach((p, i) => {
    const angle = (i / projects.length) * Math.PI * 2;
    projectCenters[p] = {
      dx: projects.length > 1 ? Math.cos(angle) * radius : 0,
      dz: projects.length > 1 ? Math.sin(angle) * radius : 0
    };
    
    const labelSprite = makeSprite(`ISLAND: ${p.toUpperCase()}`, '#ffdf00');
    labelSprite.name = 'islandLabel';
    labelSprite.scale.set(labelSprite.scale.x * 6, labelSprite.scale.y * 6, 1);
    labelSprite.position.set(projectCenters[p].dx, 600, projectCenters[p].dz);
    scene.add(labelSprite);
    islandLabels.push(labelSprite);
  });

  const lC = {}, lI = {};
  nodes.forEach(n => { 
    const p = n.group || 'default';
    const l = n.layer||'default'; 
    const key = p + '_' + l;
    lC[key] = (lC[key]||0)+1; 
    lI[key] = 0; 
  });
  nodes.forEach(n => {
    const p = n.group || 'default';
    const l = n.layer||'default';
    const key = p + '_' + l;
    const center = projectCenters[p];
    n.x = (LAYER_X[l] ?? 0) + center.dx;
    n.z = (lI[key] - (lC[key]-1)/2) * 70 + center.dz;
    n.y = 0; 
    lI[key]++;
    nodeMap[n.id] = n;
  });

  State.set('raw', graphData);

  nodes.forEach(n => buildBuilding(n));
  links.forEach(l => buildEdge(l));
  updateSyncMetrics();

  buildStart = performance.now();

  const hasRealNew = graphData.metadata?.has_real_times || false;
  const statsEl = document.getElementById('stats');
  if (statsEl) {
    statsEl.innerHTML = `NODES&nbsp;<span style="color:#fff">${nodes.length}</span><br>EDGES&nbsp;<span style="color:#fff">${links.length}</span><br>${hasRealNew?`<span style="color:var(--green)">✓ REAL TIMES</span>`:`<span style="color:var(--orange)">∼ SIMULATED</span>`}`;
  }

  // Restore selection
  if (prevSelectedId && nodeMeshMap[prevSelectedId]) {
    const newNode = nodeMap[prevSelectedId];
    if (newNode) applySelection(newNode);
  }

  State.emit('city:rebuilt', graphData);
}

// ── Keyboard Drone Controls ────────────────────────────
const keys = {};
export const droneKeys = keys;

window.addEventListener('keydown', e => {
  const aiInput = document.getElementById('ai-chat-input');
  if (aiInput && document.activeElement === aiInput) return;
  keys[e.code] = true;
  if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
    if (controls) controls.autoRotate = false;
    const dockRotate = document.getElementById('dock-rotate');
    if (dockRotate) {
      dockRotate.classList.remove('active');
      const lbl = document.getElementById('label-rotate');
      if (lbl) lbl.textContent = 'AUTO-ROTATE: OFF';
    }
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

function updateDroneMovement() {
  const moveSpeed = 2.5 * (State.flySpeed || 1.0);
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
  const side = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
  if (keys['KeyW'] || keys['ArrowUp'])    { camera.position.addScaledVector(dir,  moveSpeed); controls.target.addScaledVector(dir,  moveSpeed); }
  if (keys['KeyS'] || keys['ArrowDown'])  { camera.position.addScaledVector(dir, -moveSpeed); controls.target.addScaledVector(dir, -moveSpeed); }
  if (keys['KeyA'] || keys['ArrowLeft'])  { camera.position.addScaledVector(side,-moveSpeed); controls.target.addScaledVector(side,-moveSpeed); }
  if (keys['KeyD'] || keys['ArrowRight']) { camera.position.addScaledVector(side, moveSpeed); controls.target.addScaledVector(side, moveSpeed); }
}

// ── Animation Loop ─────────────────────────────────────
export function startAnimationLoop() {
  function animate() {
    requestAnimationFrame(animate);

    const dt  = clock.getDelta();
    const t   = clock.getElapsedTime();
    const now = performance.now();

    if (camTween) {
      const prog = Math.min(1, (now - camTween.start) / camTween.dur);
      const ease = prog < 0.5 ? 4 * prog * prog * prog : 1 - Math.pow(-2 * prog + 2, 3) / 2;
      camera.position.lerpVectors(camTween.sp, camTween.ep, ease);
      controls.target.lerpVectors(camTween.st, camTween.et, ease);
      if (prog >= 1) camTween = null;
    }

    if (controls.autoRotate && !camTween) {
      camera.position.y = 110 + Math.sin(t * 0.15) * 45;
    }

    updateDroneMovement();

    const globalElapsed = now - buildStart;
    const isMimicry = globalElapsed > 1000;

    meshes.forEach(m => {
      const ud = m.userData;
      const n = ud.node;
      const isGhost = n.is_dead_end;
      const isBottleneck = n.is_bottleneck;

      // Height tween
      const baseTargetH = State.perfMode ? ud.perfH : ud.baseH;
      const dynamicScale = getSwellScaleForNode(n, ud);
      const targetHeightScale = State.dataVolumeMode ? dynamicScale.heightScale : 1.0;
      ud.targetH = baseTargetH * targetHeightScale;

      const hDiff = ud.targetH - ud.currentH;
      if (Math.abs(hDiff) > 0.01) ud.currentH += hDiff * 0.08;
      else ud.currentH = ud.targetH;
      const currentScale = ud.currentH / ud.baseH;
      let sY = 0;

      if (ud.voxel) {
        if (globalElapsed < 800) {
          const vProg = Math.min(1, globalElapsed / 800);
          const vScale = vProg < 1 ? 1.0 : 1; // Simplified ease
          ud.voxel.scale.setScalar(vScale * 1.3); ud.voxel.visible = true;
          ud.voxel.rotation.y += 0.05;
        }
        if (isMimicry) {
          const mElapsed = globalElapsed - 1000;
          const mProg = Math.min(1, mElapsed / 600);
          ud.voxel.material.opacity = 1 - mProg;
          if (mProg > 0.99) ud.voxel.visible = false;
          m.visible = true; sY = mProg * currentScale; m.scale.y = sY;
          
          if (!State.selectedNode) {
            m.material.forEach(mat => { 
              mat.transparent = true; 
              mat.opacity = mProg * (n.is_dead_end ? 0.35 : 1.0); 
            });
          }
        } else {
          m.visible = false;
        }
      }

      const isEmerging = !isMimicry && ud.voxel && ud.voxel.visible;
      if (isEmerging && m.material && Array.isArray(m.material)) {
        m.material.forEach(mat => { mat.emissiveIntensity = 0.5 + Math.sin(now * 0.05) * 5.0; });
      }

      const label = ud.label;
      if (label) {
        const safeSX = Math.max(0.001, m.scale.x || 1);
        const safeSY = Math.max(0.001, sY);
        label.position.y = ud.baseH + (12 / safeSY);
        const ratio = label.userData.ratio || 4;
        label.scale.set((13 * ratio) / safeSX, 13 / safeSY, 1);
        const distToLabel = camera.position.distanceTo(m.position);
        const labelsEnabled = !!State.showLabels;
        const ghostVisible = !labelsEnabled && !!ud.isHovered;
        let targetOpacity = 0;

        if (labelsEnabled) {
          if (distToLabel <= 850 && sY > 0.1 && m.visible) {
            const tFade = Math.min(1, Math.max(0, (distToLabel - 550) / 300));
            targetOpacity = 1.0 - (tFade * tFade * (3 - 2 * tFade));
          }
        } else if (ghostVisible && sY > 0.1 && m.visible) {
          targetOpacity = 1.0;
        }

        const currentOpacity = Number(label.material.opacity) || 0;
        label.material.opacity = currentOpacity + (targetOpacity - currentOpacity) * 0.2;
        label.visible = (sY > 0.1) && m.visible && (label.material.opacity > 0.03);
      }

      m.position.set(n.x, 0, n.z);

      if (m.material && Array.isArray(m.material)) {
        m.material.forEach(mat => {
          if (State.perfMode) {
            mat.color.set(0x00f3ff); mat.opacity = 0.22; mat.metalness = 0.9; mat.roughness = 0.1;
            if (isGhost) { const flash = (Math.sin(t*10)+1)/2; mat.emissive.set(0xff0000); mat.emissiveIntensity = 0.3 + flash*0.5; }
            else if (isBottleneck) { const heat = 0.5+Math.sin(t*4)*0.45; mat.emissive.set(0xff3300); mat.emissiveIntensity = heat*1.5; }
            else { mat.emissive.set(0x00f3ff); mat.emissiveIntensity = 0.2; }
          } else {
            mat.color.set(n.color);
            mat.metalness = 0.6; mat.roughness = 0.45;
            
            let targetOpacity = 1.0;
            let targetEmissiveIntensity = 0.1;
            let targetEmissiveColor = ud.baseEmis || 0x000000;
            
            if (State.selectedNode) {
              const inSet = (n.id === State.selectedNode.id || critSet.has(n.id));
              if (inSet) {
                targetOpacity = 1.0;
                targetEmissiveIntensity = (n.id === State.selectedNode.id) ? 1.5 : 0.8;
                targetEmissiveColor = n.color;
              } else {
                targetOpacity = 0.03;
                targetEmissiveIntensity = 0.0;
                targetEmissiveColor = 0x000000;
              }
            } else {
              // In Normal Mode, do not change color for ghosts or bottlenecks
              targetOpacity = 1.0;
            }

            mat.opacity += (targetOpacity - mat.opacity) * 0.1;
            mat.emissive.lerp(new THREE.Color(targetEmissiveColor), 0.1);
            mat.emissiveIntensity += (targetEmissiveIntensity - mat.emissiveIntensity) * 0.1;
            mat.depthWrite = (mat.opacity > 0.2);
          }
          mat.transparent = true;
        });
      }

      const timeLabel = ud.timeLabel;
      if (timeLabel) {
        const dist = camera.position.distanceTo(m.position);
        const isSelected = (State.selectedNode && State.selectedNode.id === n.id);
        const inFocus = (!State.selectedNode || critSet.has(n.id));
        const labelsEnabled = !!State.showLabels;
        const ghostVisible = !labelsEnabled && !!ud.isHovered;
        
        // Time labels only show in Performance Mode. 
        // We show all of them if close, plus bottlenecks from far away.
        const shouldShow = labelsEnabled
          ? (State.perfMode && (isBottleneck || dist < 2500 || isSelected))
          : (State.perfMode && ghostVisible);

        if (shouldShow && inFocus) {
          const safeSX = Math.max(0.001, m.scale.x || 1);
          const safeSY = Math.max(0.001, sY);
          const yOff = isGhost ? 30 : (isBottleneck ? 42 : 28);
          timeLabel.position.y = ud.baseH + (yOff / safeSY);
          const baseW = isBottleneck ? 55 : 36, baseHt = isBottleneck ? 22 : 14.4;
          timeLabel.scale.set(baseW / safeSX, baseHt / safeSY, 1);
          let targetOpacity = 1.0;
          if (isBottleneck) {
            const flash = (Math.sin(t * 10) + 1) / 2;
            targetOpacity = 0.7 + flash * 0.3;
          } else {
            targetOpacity = ghostVisible ? 1.0 : Math.min(1.0, (800 - dist) / 150);
          }
          const currentOpacity = Number(timeLabel.material.opacity) || 0;
          timeLabel.material.opacity = currentOpacity + (targetOpacity - currentOpacity) * 0.2;
          timeLabel.visible = timeLabel.material.opacity > 0.03;
        } else {
          const currentOpacity = Number(timeLabel.material.opacity) || 0;
          timeLabel.material.opacity = currentOpacity * 0.8;
          timeLabel.visible = timeLabel.material.opacity > 0.03;
        }
      }

      // ── Data Volume Mode: Scaling X/Z (width/depth) ─────
      if (ud.swellW && ud.swellD) {
        const targetScaleX = State.dataVolumeMode ? dynamicScale.widthScale : 1.0;
        const targetScaleZ = State.dataVolumeMode ? dynamicScale.widthScale : 1.0;
        
        // Lerp suave para animación
        const currentScaleX = m.scale.x || 1.0;
        const currentScaleZ = m.scale.z || 1.0;
        const lerpFactor = 0.08;
        
        m.scale.x += (targetScaleX - currentScaleX) * lerpFactor;
        m.scale.z += (targetScaleZ - currentScaleZ) * lerpFactor;
      }

      // ── Data Volume Labels Visibility ──────────────────
      if (ud.volumeLabel && ud.volumeDiv) {
        const labelsEnabled = !!State.showLabels;
        const ghostVisible = !labelsEnabled && !!ud.isHovered;
        const shouldShowLabel = (State.dataVolumeMode && m.visible && sY > 0.1) && (labelsEnabled || ghostVisible);

        const currentOpacity = Number(ud.volumeDiv.style.opacity || 0);
        const targetOpacity = shouldShowLabel ? 1 : 0;
        const nextOpacity = currentOpacity + (targetOpacity - currentOpacity) * 0.25;
        ud.volumeDiv.style.opacity = String(Math.max(0, Math.min(1, nextOpacity)));
        ud.volumeLabel.visible = m.visible && sY > 0.1 && nextOpacity > 0.03;

        const currentMetric = State.dataSwellMetric || 'execution_time';
        const severityNow = getSwellSeverity(n, ud);
        const severityChanged = ud.lastSwellSeverity !== severityNow.level;
        if (ud.lastSwellMetric !== currentMetric || shouldShowLabel) {
          ud.volumeDiv.textContent = formatSwellLabel(n, ud);
          ud.lastSwellMetric = currentMetric;
        }
        if (severityChanged || shouldShowLabel) {
          const style = getSeverityStyle(severityNow.level);
          ud.volumeDiv.style.color = style.color;
          ud.volumeDiv.style.borderColor = style.borderColor;
          ud.volumeDiv.style.boxShadow = style.boxShadow;
          ud.volumeDiv.style.textShadow = style.textShadow;
          ud.lastSwellSeverity = severityNow.level;
        }
        
        // Posicionar por encima del label de nombre para evitar solapamiento
        const safeSY = Math.max(0.001, sY);
        const volumeOffset = ud.volumeLabelOffset || 28;
        const bothModesActive = State.perfMode && State.dataVolumeMode;
        if (bothModesActive) {
          ud.volumeLabel.position.set(40, ud.baseH + (volumeOffset / safeSY) + 10, 0);
        } else {
          ud.volumeLabel.position.y = ud.baseH + (volumeOffset / safeSY);
          ud.volumeLabel.position.x = 0;
        }
      }

      // ── Critical Volume Pulse Effect ─────────────────────
      const pulseSeverity = getSwellSeverity(n, ud).level;
      if (ud.pulseLight && State.dataVolumeMode && pulseSeverity === 'high') {
        ud.pulseLight.visible = true;
        // Pulso de luz tenue: intensidad oscila entre 0.5 y 2.0
        const pulseIntensity = 1.25 + Math.sin(t * 3) * 0.75;
        ud.pulseLight.intensity = pulseIntensity;
      } else if (ud.pulseLight) {
        ud.pulseLight.visible = false;
      }

      if (vfxManager) {
        vfxManager.update([m], t, dt, critSet);
      }
    });

    edgeObjs.forEach(e => {
      e.particles.forEach(p => {
        p.userData.t = (p.userData.t + p.userData.speed) % 1;
        const pos = p.userData.curve.getPoint(p.userData.t);
        p.position.set(pos.x, pos.y, pos.z);
      });
    });

    controls.update();
    
    // Renderizado CSS2D para etiquetas de volumen
    if (labelRenderer) {
      labelRenderer.render(scene, camera);
    }
    
    if (composer) {
      composer.render();
    } else {
      renderer.render(scene, camera);
    }
  }
  animate();
}

function _dzHideOverlay() {
  if (window._dzHideOverlay) return window._dzHideOverlay();
  return Promise.resolve();
}

// ── Data Volume Mode: CSS2DRenderer Init ───────────────
/**
 * Inicializa el CSS2DRenderer para etiquetas flotantes de volumen
 * @param {HTMLElement} container - Contenedor DOM
 */
export function initLabelRenderer(container) {
  if (!container) return;
  
  const CSS2DRenderer = window.CSS2DRenderer || (THREE.CSS2DRenderer);
  if (!CSS2DRenderer) {
    console.warn('[CityEngine] CSS2DRenderer no disponible. Las etiquetas de volumen no se mostrarán.');
    return;
  }
  
  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.left = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  labelRenderer.domElement.style.zIndex = '100';
  container.appendChild(labelRenderer.domElement);
  
  console.log('[CityEngine] CSS2DRenderer inicializado para etiquetas de volumen.');
}

/**
 * Actualiza el tamaño del label renderer en resize
 */
export function updateLabelRendererSize() {
  if (labelRenderer) {
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
  }
}

// Listener para resize
window.addEventListener('resize', updateLabelRendererSize);
