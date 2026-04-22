// ═══════════════════════════════════════════════════════
// CityEngine.js — Buildings, Edges, Fire, Animation Loop
// ═══════════════════════════════════════════════════════
import { State } from './State.js';
import { scene, camera, renderer, controls, INIT_CAM } from './Visualizer.js';

// ── Constants ──────────────────────────────────────────
export const LAYER_X = { source: -300, staging: -100, intermediate: 100, mart: 300, consumption: 500, default: 650 };

// ── Shared mutable state (city runtime) ───────────────
export const meshes = [];
export const nodeMeshMap = {};
export const edgeObjs = [];
export const voxels  = [];
export const nodeMap = {};

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

export function getFullLineage(id) {
  const vis = new Set(), q = [id];
  while (q.length) {
    const cur = q.shift(); if (vis.has(cur)) continue; vis.add(cur);
    const n = nodeMap[cur];
    if (n) { (n.upstream||[]).forEach(u => q.push(u)); (n.downstream||[]).forEach(d => q.push(d)); }
  }
  return vis;
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
  const w = 13, d = 13;

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
  mesh.userData = { node:n, baseH:h, perfH:ph, targetH:h, currentH:h, baseEmis:emis, voxel };

  if (n.is_dead_end) { const hazard = makeHazardSprite(); mesh.add(hazard); mesh.userData.hazard = hazard; hazard.visible = !State.perfMode; }

  // Neon edges
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({color:col,transparent:true,opacity:0.85})));

  // Halo point light
  const halo = new THREE.PointLight(0xff4400, 3.5, 60);
  halo.position.set(0, h/2, 0); halo.name = 'halo'; halo.visible = false;
  mesh.add(halo);

  // Fire group
  const fireGroup = new THREE.Group(); fireGroup.name = 'fire'; fireGroup.visible = false;
  ensureTextures();
  for (let i = 0; i < 48; i++) {
    const f = new THREE.Sprite(new THREE.SpriteMaterial({map:FLAME_TEX, blending:THREE.AdditiveBlending, transparent:true, opacity:0.6, depthWrite:false}));

    const gx = ((i % 8) / 7 - 0.5) * 14;
    const gz = (Math.floor(i / 8) / 6 - 0.5) * 14;
    const distFromCenter = Math.sqrt(gx*gx + gz*gz);
    const pyramidFactor = Math.max(0.1, 1.0 - (distFromCenter / 12));
    f.position.set(gx, h, gz);
    f.userData = { phase: i * 1.6, speed: 0.06, baseScale: 20 * pyramidFactor, pyramidFactor, offsetX: gx, offsetZ: gz };
    fireGroup.add(f);
  }
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({map:EMBER_TEX, blending:THREE.AdditiveBlending, transparent:true, opacity:0.5, depthWrite:false}));
    s.position.set(((i % 4) - 1.5) * 4, h, (Math.floor(i / 4) - 1.5) * 4);
    s.userData = { phase: i * 3.1, speed: 0.15, baseScale: 2.5, isEmber: true };
    s.scale.setScalar(s.userData.baseScale);
    fireGroup.add(s);
  }
  for (let i = 0; i < 8; i++) {
    const sm = new THREE.Sprite(new THREE.SpriteMaterial({map:SMOKE_TEX, transparent:true, opacity:0.2, depthWrite:false}));

    sm.position.set(((i % 4) - 1.5) * 3, h + 10, (Math.floor(i / 4) - 0.5) * 3);
    sm.userData = { phase: i * 5.0, speed: 0.04, baseScale: 32, isSmoke: true };
    fireGroup.add(sm);
  }
  mesh.add(fireGroup);

  const glow = new THREE.PointLight(col, 1.5, 42);
  glow.position.set(0, 2, 0); mesh.add(glow);

  const sp = makeSprite(n.name, col);
  sp.position.set(0, h + 8, 0); sp.name = 'label'; mesh.add(sp); mesh.userData.label = sp;

  const timeSp = makeTimeSprite(`${n.execution_time.toFixed(2)}s`, n.is_bottleneck);
  timeSp.position.set(0, h + 25, 0); timeSp.visible = false; timeSp.name = 'timeLabel';
  mesh.add(timeSp); mesh.userData.timeLabel = timeSp;

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
  const A = new THREE.Vector3(src.x, 10, src.z);
  const B = new THREE.Vector3(tgt.x, 10, tgt.z);
  const mid = A.clone().lerp(B, 0.5).add(new THREE.Vector3(0, 22, 0));
  const curve = new THREE.QuadraticBezierCurve3(A, mid, B);
  const pts = curve.getPoints(42);
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({color:0x0a3344,transparent:true,opacity:0.45});
  const line = new THREE.Line(geo, mat); scene.add(line);
  const N = 5, particles = [];
  for (let i = 0; i < N; i++) {
    const pGeo = new THREE.SphereGeometry(0.75, 8, 8);
    const pMat = new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.25});
    const p = new THREE.Mesh(pGeo, pMat);
    const tgtNode = nodeMap[tgtId];
    const isAccelerated = tgtNode && tgtNode.layer === 'mart';
    const baseSpeed = 0.005;
    p.userData = { curve, t: i/N, speed: isAccelerated ? baseSpeed * 1.8 : baseSpeed };
    scene.add(p); particles.push(p);
  }
  edgeObjs.push({ line, particles, curve, src: srcId, tgt: tgtId });
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
  critSet = new Set();
  selectedNode = node;
  const highlightColor = node ? new THREE.Color(node.color) : new THREE.Color(0x00d4e8);
  meshes.forEach(m => {
    const n = m.userData.node; if (!n) return;
    const id = n.id;
    let inSet = true;
    if (node) { if (!critSet.size) critSet = getFullLineage(node.id); inSet = critSet.has(id); }
    const alpha = inSet ? 1.0 : 0.07;
    m.material.forEach(mat => { mat.opacity = alpha; mat.transparent = true; mat.depthWrite = (alpha > 0.1); });
    m.children.forEach(child => {
      if (child.isLineSegments) child.material.opacity = inSet ? 0.9 : 0.03;
      if (child.isLight)  child.intensity = inSet ? (node && id===node.id ? 5.0 : 1.5) : 0.05;
      if (child.isSprite) child.material.opacity = inSet ? 1.0 : 0.07;
    });
  });
  edgeObjs.forEach(e => {
    const isConnected = node && (e.src === node.id || e.tgt === node.id);
    const inPath = node ? isConnected : true;
    e.line.material.opacity   = node ? (inPath ? 1.0 : 0.02) : 0.45;
    e.line.material.color.copy(node && inPath ? highlightColor : new THREE.Color(0x0a3344));
    e.line.renderOrder = inPath ? 10 : 0;
    e.particles.forEach(p => {
      p.material.opacity = node ? (inPath ? 1.0 : 0.0) : 0.25;
      p.material.color.copy(node && inPath ? highlightColor : new THREE.Color(0xffffff));
      p.scale.setScalar(inPath && node ? 2.5 : 1.0);
    });
  });
  State.set('selectedNode', node);
}

export function resetSelection() {
  critSet = new Set();
  applySelection(null);
  edgeObjs.forEach(e => e.particles.forEach(p => { p.material.opacity = 0.25; p.scale.setScalar(1.0); }));
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
  selectedNode = null; critSet = new Set();

  maxTime = nodes.length ? Math.max(...nodes.map(n => n.execution_time || 0)) : 0;
  minTime = nodes.length ? Math.min(...nodes.map(n => n.execution_time || 0)) : 0;
  hasReal = graphData.metadata?.has_real_times || false;

  const lC = {}, lI = {};
  nodes.forEach(n => { const l = n.layer||'default'; lC[l]=(lC[l]||0)+1; lI[l]=0; });
  nodes.forEach(n => {
    const l = n.layer||'default';
    n.x = LAYER_X[l] ?? 0;
    n.z = (lI[l] - (lC[l]-1)/2) * 70;
    n.y = 0; lI[l]++;
    nodeMap[n.id] = n;
  });

  State.set('raw', graphData);

  nodes.forEach(n => buildBuilding(n));
  links.forEach(l => buildEdge(l));
  updateSyncMetrics();

  buildStart = performance.now();

  const hasRealNew = graphData.metadata?.has_real_times || false;
  document.getElementById('stats').innerHTML =
    `NODES&nbsp;<span style="color:#fff">${nodes.length}</span><br>EDGES&nbsp;<span style="color:#fff">${links.length}</span><br>${hasRealNew?`<span style="color:var(--green)">✓ REAL TIMES</span>`:`<span style="color:var(--orange)">∼ SIMULATED</span>`}`;

  tweenCamera(INIT_CAM, {x:0,y:0,z:0}, 1800);
  controls.autoRotate = true;
  const dockRotate = document.getElementById('dock-rotate');
  if (dockRotate) {
    dockRotate.classList.add('active');
    const lbl = document.getElementById('label-rotate');
    if (lbl) lbl.textContent = 'AUTO-ROTATE: ON';
  }

  State.emit('city:rebuilt', graphData);
}

// ── Keyboard Drone Controls ────────────────────────────
const keys = {};
export const droneKeys = keys;

window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
    controls.autoRotate = false;
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
  const moveSpeed = 1.8;
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
  const side = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
  if (keys['KeyW'] || keys['ArrowUp'])    { camera.position.addScaledVector(dir,  moveSpeed); controls.target.addScaledVector(dir,  moveSpeed); }
  if (keys['KeyS'] || keys['ArrowDown'])  { camera.position.addScaledVector(dir, -moveSpeed); controls.target.addScaledVector(dir, -moveSpeed); }
  if (keys['KeyA'] || keys['ArrowLeft'])  { camera.position.addScaledVector(side,-moveSpeed); controls.target.addScaledVector(side,-moveSpeed); }
  if (keys['KeyD'] || keys['ArrowRight']) { camera.position.addScaledVector(side, moveSpeed); controls.target.addScaledVector(side, moveSpeed); }
}

// ── Animation Loop ─────────────────────────────────────
let clock;

export function startAnimationLoop() {
  if (!clock) clock = new THREE.Clock();
  function animate() {

    requestAnimationFrame(animate);
    const now = performance.now();
    const t   = clock.getElapsedTime();

    if (camTween) {
      const prog = Math.min(1, (now - camTween.start) / camTween.dur);
      const ease = prog < 0.5 ? 4*prog*prog*prog : 1 - Math.pow(-2*prog+2,3)/2;
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

      // Height tween
      const hDiff = ud.targetH - ud.currentH;
      if (Math.abs(hDiff) > 0.01) ud.currentH += hDiff * 0.08;
      else ud.currentH = ud.targetH;
      const currentScale = ud.currentH / ud.baseH;
      let sY = 0;

      if (ud.voxel) {
        if (globalElapsed < 800) {
          const vProg = Math.min(1, globalElapsed / 800);
          const vScale = vProg < 1 ? easeOutBack(vProg) : 1;
          ud.voxel.scale.setScalar(vScale * 1.3); ud.voxel.visible = true;
          ud.voxel.rotation.y += 0.05; ud.voxel.material.emissiveIntensity = 1.5 + Math.sin(now * 0.02) * 3;
        }
        if (isMimicry) {
          const mElapsed = globalElapsed - 1000;
          const mProg = Math.min(1, mElapsed / 600);
          ud.voxel.material.opacity = 1 - mProg;
          if (mProg > 0.99) ud.voxel.visible = false;
          m.visible = true; sY = mProg * currentScale; m.scale.y = sY;
          m.material.forEach(mat => { mat.transparent = true; mat.opacity = mProg * (ud.node.is_dead_end ? 0.35 : 1.0); });
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
        const safeSY = Math.max(0.001, sY);
        label.position.y = ud.baseH + (12 / safeSY);
        const ratio = label.userData.ratio || 4;
        label.scale.set(13 * ratio, 13 / safeSY, 1);
        const distToLabel = camera.position.distanceTo(m.position);
        if (distToLabel > 850) { label.visible = false; }
        else {
          label.visible = (sY > 0.1) && m.visible;
          const tFade = Math.min(1, Math.max(0, (distToLabel - 550) / 300));
          label.material.opacity = 1.0 - (tFade * tFade * (3 - 2 * tFade));
        }
      }

      if (ud.hazard) {
        const safeSY = Math.max(0.001, sY);
        ud.hazard.position.y = ud.baseH + (22 / safeSY);
        ud.hazard.scale.set(15, 15 / safeSY, 1);
      }

      const isGhost = ud.node.is_dead_end;
      const isBottleneck = ud.node.is_bottleneck;

      m.position.set(ud.node.x, 0, ud.node.z);

      if (m.material && Array.isArray(m.material)) {
        m.material.forEach(mat => {
          if (State.perfMode) {
            mat.color.set(0x00f3ff); mat.opacity = 0.22; mat.metalness = 0.9; mat.roughness = 0.1;
            if (isGhost) { const flash = (Math.sin(t*10)+1)/2; mat.emissive.set(0xff0000); mat.emissiveIntensity = 0.3 + flash*0.5; }
            else if (isBottleneck) { const heat = 0.5+Math.sin(t*4)*0.45; mat.emissive.set(0xff3300); mat.emissiveIntensity = heat*1.5; }
            else { mat.emissive.set(0x00f3ff); mat.emissiveIntensity = 0.2; }
          } else {
            mat.color.set(ud.node.color);
            mat.opacity = isGhost ? 0.35 : (selectedNode && !critSet.has(ud.node.id) ? 0.07 : 1.0);
            mat.metalness = 0.6; mat.roughness = 0.45;
            if (isGhost) { const pulse=(Math.sin(t*4.5)+1)/2; const pSq=Math.pow(pulse,2); mat.emissive.set(0xff0000); mat.emissiveIntensity=0.5+pSq*6.0; }
            else if (isBottleneck && State.perfMode) { const heat=0.5+Math.sin(t*4)*0.45; mat.emissive.set(0xff3300); mat.emissiveIntensity=heat*2.5; }
            else { mat.emissive.set(ud.baseEmis||0x000000); mat.emissiveIntensity=0.1; }
          }
          mat.transparent = true;
        });
      }

      const timeLabel = ud.timeLabel;
      if (timeLabel) {
        const dist = camera.position.distanceTo(m.position);
        const shouldShow = State.perfMode && (isBottleneck || dist < 800 || (selectedNode && selectedNode.id === ud.node.id));
        timeLabel.visible = shouldShow;
        if (shouldShow) {
          const safeSY = Math.max(0.001, sY);
          const yOff = isGhost ? 30 : (isBottleneck ? 42 : 28);
          timeLabel.position.y = ud.baseH + (yOff / safeSY);
          const baseW = isBottleneck ? 55 : 36, baseHt = isBottleneck ? 22 : 14.4;
          timeLabel.scale.set(baseW, baseHt / safeSY, 1);
          if (isBottleneck) { const flash=(Math.sin(t*10)+1)/2; timeLabel.material.opacity=0.7+flash*0.3; }
          else { timeLabel.material.opacity = Math.min(1.0, (800-dist)/150); }
        }
      }

      // Fire animation
      const fire = m.children.find(c => c.name==='fire');
      const halo = m.children.find(c => c.name==='halo');
      if (fire) {
        fire.visible = isBottleneck && State.perfMode && m.visible;
        if (halo) { halo.visible = isBottleneck && State.perfMode && m.visible; halo.intensity = 2.5 + Math.sin(t*8)*1.5; }
        if (fire.visible) {
          fire.children.forEach(f => {
            const udF = f.userData;
            const fsY = Math.max(0.011, m.scale.y);
            const globalPhase = t * udF.speed * 60 + udF.phase;
            const sway = Math.sin(t * 2.5) * 1.8;
            if (udF.isSmoke) {
              const smokeCycle = globalPhase % 70;
              f.position.y = ud.baseH + (12 + smokeCycle) / fsY;
              f.position.x = sway * 1.2;
              f.material.opacity = Math.max(0, 0.2 - smokeCycle/100) * (fsY > 0.05 ? 1 : 0);
              f.scale.setScalar(udF.baseScale * (1 + smokeCycle/30) / fsY);
            } else if (udF.isEmber) {
              const emberCycle = globalPhase % 60;
              f.position.y = ud.baseH + emberCycle / fsY;
              f.position.x = (Math.sin(globalPhase*0.5)*5) / fsY;
              f.position.z = (Math.cos(globalPhase*0.5)*5) / fsY;
              f.material.opacity = Math.max(0, 1.0 - emberCycle/60);
            } else {
              const life = (globalPhase % 25) / 25;
              const ageFactor = 1.0 - life;
              f.position.x = (udF.offsetX * ageFactor) + (sway * ageFactor);
              f.position.z = (udF.offsetZ * ageFactor);
              const finalScale = udF.baseScale * ageFactor;
              f.scale.set(finalScale, (finalScale*1.5)/fsY, 1);
              f.position.y = ud.baseH + ((finalScale*0.4)+(life*32))/fsY;
              const c = f.material.color;
              if      (life < 0.25) c.set(0xffffff);
              else if (life < 0.45) c.set(0xffcc00);
              else if (life < 0.75) c.set(0xff6600);
              else                  c.set(0xaa2200);
              f.material.opacity = ageFactor * ageFactor * 0.98;
            }
          });
        }
      }
      if (halo && !fire) halo.intensity = 3.2 + Math.sin(t*5)*1.5;
    });

    edgeObjs.forEach(e => {
      e.particles.forEach(p => {
        p.userData.t = (p.userData.t + p.userData.speed) % 1;
        const pos = p.userData.curve.getPoint(p.userData.t);
        p.position.set(pos.x, pos.y, pos.z);
      });
    });

    controls.update();
    renderer.render(scene, camera);
  }
  animate();
}

// ── Forward-declare _dzHideOverlay (resolved by DataManager) ──
// DataManager injects this into window so CityEngine can call it.
function _dzHideOverlay() {
  if (window._dzHideOverlay) return window._dzHideOverlay();
  return Promise.resolve();
}
