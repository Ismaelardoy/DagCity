// ═══════════════════════════════════════════════════════
// CityEngine.js — Buildings, Edges, Fire, Animation Loop
// ═══════════════════════════════════════════════════════
import { State } from './State.js';
import * as Visualizer from './Visualizer.js';
import {
  scene, camera, renderer, controls, 
  initScene, INIT_CAM, composer, bloomPass,
} from './Visualizer.js';
import { VFXManager } from './VFXManager.js';

// CSS2DRenderer para etiquetas flotantes de volumen de datos
let labelRenderer = null;

let vfxManager = null;
const clock = new THREE.Clock();

// ── Island parent helper ──
function _islandParent(groupName) {
  const key = groupName || 'default';
  if (!islandGroups[key]) {
    const g = new THREE.Group();
    g.name = 'island_' + key;
    g.userData.islandKey = key;
    islandGroups[key] = g;
    scene.add(g);
  }
  return islandGroups[key];
}

// ── Reusable temp objects (avoid per-frame allocations) ──
const _tmpColor = new THREE.Color();
const _tmpVec3 = new THREE.Vector3();
const _tmpVec3b = new THREE.Vector3();
const _vfxBucket = [null]; // reusable single-element array for vfxManager.update
let _frameCount = 0;

// ── FPS Tracking ──
let _lastTime = performance.now();
let _frameCountSinceLastUpdate = 0;
const _fpsUpdateInterval = 500; // Update FPS display every 500ms

// ── Island Center Calculation System ─────────────────────
// Calculates and stores the exact (X, Z) center coordinates for each island
function calculateIslandCenters() {
  const keys = Object.keys(islandMeta);
  
  // Clear existing centers
  Object.keys(islandCenters).forEach(k => delete islandCenters[k]);
  
  // Calculate centers from islandMeta
  keys.forEach(k => {
    const meta = islandMeta[k];
    if (meta && meta.center) {
      islandCenters[k] = {
        x: meta.center.x,
        z: meta.center.z,
        radius: meta.radius || 400
      };
    }
  });
  
  console.log('[Navigation] Island centers calculated:', Object.keys(islandCenters));
  return islandCenters;
}

// ── Island grouping & culling ──
const islandGroups = {};            // group_name -> THREE.Group
const islandMeta = {};              // group_name -> { center: Vector3, radius: number }
const islandCenters = {};           // group_name -> { x: number, z: number } (explicit center coordinates)
let globalArcsGroup = null;         // holds inter-island arcs (never culled)
const TACTICAL_RING_Y = -10;
let MAX_RENDER_DISTANCE = 50000;    // beyond this, hide island entirely (mutated by DRS)
const CULL_INTERVAL_FRAMES = 10;    // re-evaluate visibility every N frames
let _cullFrameCounter = 0;
let _cullDirty = true;              // forces recompute (e.g. after rebuild or controls change)
let _suspendSectorCulling = false;
let _forceFullRenderUntilMs = 0;
const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _islandSphere = new THREE.Sphere();

// ── Intelligent Rendering ──
let needsUpdate = true;
let _lastControlChangeTime = 0;
let _drsWarmupUntilMs = 0;
let _wasIdleLastFrame = false;
let isSystemAnimating = false;
let _lastSystemAnimEndMs = 0;
let _drsDisabledUntilMs = 0; // DRS completely disabled until this time
let _layoutEdgeRefreshPending = false;
let _edgeRefreshFrameTick = 0;
const MIN_CAMERA_FAR = 1200;
const MIN_RENDER_DISTANCE = 800;
const MIN_GLOBAL_DISTANCE = 2400;

// ── LOD (Level of Detail) System ─────────────────────
const LOD_NEAR_DISTANCE = 500;    // Full 3D geometry
const LOD_MEDIUM_DISTANCE = 1500; // Simplified geometry
const LOD_FAR_DISTANCE = 3000;    // Billboard imposters
let lodEnabled = true;

// ── Scene Detachment LOD (Monolith System) ───────────
// Continuous LOD with monolith blocks for Global Mode
const MONOLITH_LOD_DISTANCE = 2200; // Distance to switch to monolith
const MONOLITH_LOD_HYSTERESIS = 250; // Hysteresis to prevent flickering
const ALWAYS_RENDER_DISTANCE = 1e9;

// ── Billboard Imposter System ─────────────────────────
// Simple colored sprites for distant nodes to reduce draw calls
const imposterGroup = new THREE.Group();
imposterGroup.name = 'imposters';

// ── Clustering System for 2D Schematic Mode ─────────────
let clusterGroups = [];
const CLUSTER_DISTANCE_THRESHOLD = 80; // Units for clustering
let clusterZoomLevel = 1.0;

function updateClusters() {
  if (!diagramNodeTargets.length) return;
  
  // Simple clustering based on spatial proximity
  const clusters = [];
  const visited = new Set();
  
  for (let i = 0; i < diagramNodeTargets.length; i++) {
    const sprite = diagramNodeTargets[i];
    if (visited.has(sprite.uuid)) continue;
    
    const node = sprite.userData.node;
    if (!node) continue;
    
    const cluster = { nodes: [node], center: new THREE.Vector3(sprite.position.x, sprite.position.y, sprite.position.z), sprite };
    visited.add(sprite.uuid);
    
    // Find nearby nodes
    for (let j = i + 1; j < diagramNodeTargets.length; j++) {
      const otherSprite = diagramNodeTargets[j];
      if (visited.has(otherSprite.uuid)) continue;
      
      const dist = sprite.position.distanceTo(otherSprite.position);
      if (dist < CLUSTER_DISTANCE_THRESHOLD / clusterZoomLevel) {
        cluster.nodes.push(otherSprite.userData.node);
        cluster.center.add(otherSprite.position);
        visited.add(otherSprite.uuid);
      }
    }
    
    cluster.center.divideScalar(cluster.nodes.length);
    clusters.push(cluster);
  }
  
  clusterGroups = clusters;
}

// ── Radar HUD (Local Radar - Camera Centered) ─────────────
// Shows only nearby islands within radar radius (not entire world)
const islandFireState = {}; // islandKey -> boolean
let radarContainer = null;
let radarCanvas = null;
let radarCtx = null;
const RADAR_SIZE = 200;
const RADAR_PADDING = 22;
const RADAR_CLICK_RADIUS = 12;
const RADAR_VIEW_RADIUS = 3000; // Maximum viewing distance for local radar

// ── Tactical Map (Global Map Overlay) ─────────────────
let tacticalMapOverlay = null;
let tacticalMapCanvas = null;
let tacticalMapCtx = null;
let tacticalMapVisible = false;
let tacticalMapHotkeyBound = false;
let tacticalMapIslandPositions = []; // Cache island positions on canvas
let tacticalMapRenderPending = false; // Flag for deferred rendering

function openTacticalMap() {
  if (!tacticalMapOverlay) {
    initTacticalMap();
  }
  tacticalMapVisible = true;
  tacticalMapOverlay.style.display = 'flex';
  tacticalMapRenderPending = true; // Mark as pending for deferred rendering
}

function closeTacticalMap() {
  tacticalMapVisible = false;
  if (tacticalMapOverlay) {
    tacticalMapOverlay.style.display = 'none';
  }
  tacticalMapRenderPending = false;
}

function toggleTacticalMap() {
  if (tacticalMapVisible) {
    closeTacticalMap();
  } else {
    openTacticalMap();
  }
}

function initTacticalMap() {
  if (typeof document === 'undefined') return;
  
  tacticalMapOverlay = document.getElementById('tactical-map-overlay');
  tacticalMapCanvas = document.getElementById('tactical-map-canvas');
  
  if (!tacticalMapOverlay || !tacticalMapCanvas) return;
  
  // Set canvas size
  const rect = tacticalMapCanvas.getBoundingClientRect();
  tacticalMapCanvas.width = rect.width;
  tacticalMapCanvas.height = rect.height;
  tacticalMapCtx = tacticalMapCanvas.getContext('2d');
  
  // Close button handler
  const closeBtn = document.getElementById('close-tactical-map');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeTacticalMap);
  }
  
  // Canvas click handler for fast travel
  tacticalMapCanvas.addEventListener('click', handleTacticalMapClick);
  
  // Handle window resize
  window.addEventListener('resize', () => {
    if (tacticalMapVisible && tacticalMapCanvas) {
      const rect = tacticalMapCanvas.getBoundingClientRect();
      tacticalMapCanvas.width = rect.width;
      tacticalMapCanvas.height = rect.height;
      renderTacticalMap();
    }
  });

  // Bind keyboard shortcuts:
  // - G: Global View (cinematic camera)
  // - M: Global Map overlay
  bindGlobalHotkeys();
}

function bindGlobalHotkeys() {
  if (tacticalMapHotkeyBound) return;
  if (typeof window === 'undefined') return;

  window.addEventListener('keydown', (ev) => {
    if (ev.defaultPrevented || ev.repeat) return;
    const key = (ev.key || '').toLowerCase();
    if (key !== 'g' && key !== 'm') return;

    const target = ev.target;
    const tag = target && target.tagName ? String(target.tagName).toLowerCase() : '';
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || (target && target.isContentEditable);
    if (typing) return;

    ev.preventDefault();
    if (key === 'g') {
      triggerGlobalView(GLOBAL_VIEW_FLIGHT_MS);
    } else {
      toggleTacticalMap();
    }
  });

  tacticalMapHotkeyBound = true;
}

function renderTacticalMap() {
  if (!tacticalMapCtx || !tacticalMapCanvas || !camera) return;
  
  // Check if canvas has valid dimensions
  const rect = tacticalMapCanvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    console.warn('[TacticalMap] Canvas has zero dimensions, deferring render');
    // Retry after DOM paints
    requestAnimationFrame(() => {
      if (tacticalMapVisible) renderTacticalMap();
    });
    return;
  }
  
  // Set canvas size to match display size
  tacticalMapCanvas.width = rect.width;
  tacticalMapCanvas.height = rect.height;
  
  const ctx = tacticalMapCtx;
  const width = tacticalMapCanvas.width;
  const height = tacticalMapCanvas.height;
  const keys = Object.keys(islandCenters);
  
  // Clear canvas
  ctx.clearRect(0, 0, width, height);
  
  // Draw background
  ctx.fillStyle = 'rgba(0, 10, 20, 0.9)';
  ctx.fillRect(0, 0, width, height);
  
  // Draw grid
  ctx.strokeStyle = 'rgba(0, 243, 255, 0.1)';
  ctx.lineWidth = 1;
  const gridSize = 50;
  for (let x = 0; x < width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  
  if (!keys.length) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('No islands available', width / 2, height / 2);
    return;
  }
  
  // Calculate bounding box of all island centers
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  keys.forEach(k => {
    const center = islandCenters[k];
    if (center) {
      minX = Math.min(minX, center.x - (center.radius || 0));
      maxX = Math.max(maxX, center.x + (center.radius || 0));
      minZ = Math.min(minZ, center.z - (center.radius || 0));
      maxZ = Math.max(maxZ, center.z + (center.radius || 0));
    }
  });
  
  // Add camera position to bounds
  minX = Math.min(minX, camera.position.x);
  maxX = Math.max(maxX, camera.position.x);
  minZ = Math.min(minZ, camera.position.z);
  maxZ = Math.max(maxZ, camera.position.z);
  
  const padding = 100;
  const worldWidth = (maxX - minX) + padding * 2;
  const worldHeight = (maxZ - minZ) + padding * 2;
  const scaleX = width / worldWidth;
  const scaleZ = height / worldHeight;
  const scale = Math.min(scaleX, scaleZ) * 0.8;
  
  const offsetX = (width - worldWidth * scale) / 2 - minX * scale + padding * scale;
  const offsetZ = (height - worldHeight * scale) / 2 - minZ * scale + padding * scale;
  
  // Clear cache
  tacticalMapIslandPositions = [];
  
  // Draw islands
  keys.forEach(k => {
    const center = islandCenters[k];
    if (!center) return;
    
    const canvasX = center.x * scale + offsetX;
    const canvasY = center.z * scale + offsetZ;
    const radius = (center.radius || 400) * scale;
    
    // Cache position for click detection
    tacticalMapIslandPositions.push({
      key: k,
      x: canvasX,
      y: canvasY,
      radius: radius,
      worldX: center.x,
      worldZ: center.z
    });
    
    // Draw island circle
    const isBurning = !!islandFireState[k];
    const group = islandGroups[k];
    const visible = !group || group.visible !== false;
    
    ctx.beginPath();
    ctx.fillStyle = isBurning
      ? 'rgba(255, 68, 48, 0.6)'
      : (visible ? 'rgba(140, 200, 240, 0.4)' : 'rgba(105, 130, 150, 0.3)');
    ctx.arc(canvasX, canvasY, radius, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = isBurning
      ? 'rgba(255, 68, 48, 0.9)'
      : (visible ? 'rgba(140, 200, 240, 0.8)' : 'rgba(105, 130, 150, 0.6)');
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Draw island name
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(k.toUpperCase(), canvasX, canvasY);
  });
  
  // Draw camera position
  const camX = camera.position.x * scale + offsetX;
  const camY = camera.position.z * scale + offsetZ;
  
  ctx.beginPath();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.arc(camX, camY, 8, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.strokeStyle = 'rgba(255, 245, 170, 0.8)';
  ctx.lineWidth = 3;
  ctx.stroke();
  
  // Draw camera direction
  const camDir = _tmpVec3b;
  camera.getWorldDirection(camDir);
  camDir.y = 0;
  if (camDir.lengthSq() < 1e-6) camDir.set(0, 0, -1);
  camDir.normalize();
  
  const dirX = camX + camDir.x * 20;
  const dirY = camY + camDir.z * 20;
  
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(255, 245, 170, 0.8)';
  ctx.lineWidth = 2;
  ctx.moveTo(camX, camY);
  ctx.lineTo(dirX, dirY);
  ctx.stroke();
  
  console.log('[TacticalMap] Rendered', keys.length, 'islands');
}

function handleTacticalMapClick(event) {
  if (!tacticalMapIslandPositions.length) return;
  
  const rect = tacticalMapCanvas.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const clickY = event.clientY - rect.top;
  
  // Check if clicked on an island
  for (const island of tacticalMapIslandPositions) {
    const dx = clickX - island.x;
    const dy = clickY - island.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist <= island.radius) {
      // Fast travel to this island using cached world coordinates
      fastTravelToIsland(island.key, island.worldX, island.worldZ);
      break;
    }
  }
}

function fastTravelToIsland(islandKey, worldX, worldZ) {
  if (!camera || !controls) return;

  console.log('[Navigation] Fast travel to island:', islandKey, 'at', worldX, worldZ);

  // Close Global Map overlay
  closeTacticalMap();

  // Compute a high-angle "helicopter" framing using the island radius (if known)
  const meta = islandMeta[islandKey];
  const radius = Math.max(400, (meta && meta.radius) || 600);

  // Camera target sits at the island center (slightly raised for nicer framing)
  const targetFocus = new THREE.Vector3(worldX, 30, worldZ);

  // Place the camera above and pulled back along -Z (high pitch, isometric feel)
  const heightOffset = Math.max(900, radius * 2.2);
  const distanceOffset = Math.max(700, radius * 1.6);
  const targetPos = new THREE.Vector3(worldX, heightOffset, worldZ + distanceOffset);

  tweenCamera(targetPos, targetFocus, 1500, {
    easing: easeInOutCubic,
    onComplete: () => {
      if (controls) {
        controls.autoRotate = false;
        controls.update();
      }
    }
  });
}

export function flyToIsland(islandKey) {
  const key = islandKey || 'default';
  const meta = islandMeta[key];
  if (!meta || !meta.center) return;
  fastTravelToIsland(key, meta.center.x, meta.center.z);
}

function ensureTacticalMapButton() {
  if (typeof document === 'undefined') return;

  const btn = document.getElementById('btn-tactical-map');
  if (!btn) return;

  btn.title = 'Global Map (M)';
  btn.setAttribute('aria-label', 'Global Map (press M)');

  if (!btn.dataset.mapBound) {
    btn.addEventListener('click', toggleTacticalMap);

    const hint = document.createElement('div');
    hint.id = 'global-map-hint';
    hint.textContent = 'Global Map · M';
    hint.style.cssText = [
      'position: fixed',
      'top: 66px',
      'right: 70px',
      'z-index: 261',
      'padding: 6px 12px',
      'border-radius: 999px',
      'background: rgba(6,14,24,0.92)',
      'border: 1px solid rgba(0,243,255,0.55)',
      'color: #00f3ff',
      'font-family: "JetBrains Mono", monospace',
      'font-size: 11px',
      'font-weight: 700',
      'letter-spacing: 0.8px',
      'box-shadow: 0 0 12px rgba(0,243,255,0.35)',
      'pointer-events: none',
      'opacity: 0',
      'transform: translateY(-6px)',
      'transition: opacity 0.18s, transform 0.18s',
      'white-space: nowrap'
    ].join(';');
    document.body.appendChild(hint);
    btn.addEventListener('mouseenter', () => {
      hint.style.opacity = '1';
      hint.style.transform = 'translateY(0)';
    });
    btn.addEventListener('mouseleave', () => {
      hint.style.opacity = '0';
      hint.style.transform = 'translateY(-6px)';
    });

    btn.dataset.mapBound = '1';
  }
}

// ── View mode (3D only) ─────────────────────────────────────
let globalViewBtn = null;
let viewModeHotkeyBound = false;
let sceneBackground3D = null;

// ── 2D Schematic Mode (Canvas Overlay) ─────────────────
let schematicCanvas = null;
let schematicCtx = null;
let schematicOverlay = null;
let schematicVisible = false;
let schematicClusters = [];
let schematicExpandedClusters = new Set();
let schematicTransitionProgress = 0;
let schematicTransitioning = false;
const SCHEMATIC_FONT_SIZE = 14;
const SCHEMATIC_NODE_WIDTH = 120;
const SCHEMATIC_NODE_HEIGHT = 36;
const SCHEMATIC_CLUSTER_THRESHOLD = 5;

// ── Grid Unfolding System for 2D Mode ─────────────────────
let gridTweenActive = false;
let gridTweenProgress = 0;
let gridTweenDuration = 800; // ms
let gridTweenStartTime = 0;
let gridTargetPositions = new Map(); // mesh.id -> target position

// Schematic pan/zoom state
let schematicPan = { x: 0, y: 0 };
let schematicZoom = 1.0;
let schematicIsDragging = false;
let schematicDragStart = { x: 0, y: 0 };
let schematicPanStart = { x: 0, y: 0 };

function calculateGridLayoutForIsland(islandKey) {
  const islandGroup = islandGroups[islandKey];
  if (!islandGroup) return [];
  
  // Get all meshes in this island
  const islandMeshes = [];
  islandGroup.traverse((obj) => {
    if (obj.isMesh && obj.userData && obj.userData.node) {
      islandMeshes.push(obj);
    }
  });
  
  if (islandMeshes.length === 0) return [];
  
  // Sort nodes by name for consistent layout
  islandMeshes.sort((a, b) => {
    const nameA = a.userData.node?.name || '';
    const nameB = b.userData.node?.name || '';
    return nameA.localeCompare(nameB);
  });
  
  // Grid Wrap Layout Parameters (same as main layout)
  const maxPerRow = 20;
  const spacingZ = 150;
  const spacingX = 150;
  
  // Get island center
  let centerX = 0, centerZ = 0;
  for (let i = 0; i < islandMeshes.length; i++) {
    const orig = islandMeshes[i].userData.originalPosition;
    if (orig) {
      centerX += orig.x;
      centerZ += orig.z;
    }
  }
  centerX /= islandMeshes.length;
  centerZ /= islandMeshes.length;
  
  // Calculate grid positions using Grid Wrap logic
  const targetPositions = [];
  for (let i = 0; i < islandMeshes.length; i++) {
    const mesh = islandMeshes[i];
    const col = i % maxPerRow;
    const row = Math.floor(i / maxPerRow);
    
    // Center the grid around the island center
    const offsetX = (col - (Math.min(islandMeshes.length, maxPerRow) - 1) / 2) * spacingZ;
    const offsetZ = (row - Math.floor((islandMeshes.length - 1) / maxPerRow) / 2) * spacingX;
    
    const targetX = centerX + offsetX;
    const targetZ = centerZ + offsetZ;
    
    targetPositions.push({
      mesh,
      targetPosition: new THREE.Vector3(targetX, 0, targetZ)
    });
  }
  
  return targetPositions;
}

function startGridUnfolding() {
  // Calculate target positions for all islands
  gridTargetPositions.clear();
  
  const islandKeys = Object.keys(islandGroups);
  for (let i = 0; i < islandKeys.length; i++) {
    const islandKey = islandKeys[i];
    const positions = calculateGridLayoutForIsland(islandKey);
    for (let j = 0; j < positions.length; j++) {
      gridTargetPositions.set(positions[j].mesh.uuid, positions[j].targetPosition);
    }
  }
  
  // Start tween
  gridTweenActive = true;
  gridTweenProgress = 0;
  gridTweenStartTime = performance.now();
}

function startGridFolding() {
  // Target positions are the original 3D positions
  gridTargetPositions.clear();
  
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    const original = mesh.userData.originalPosition;
    if (original) {
      gridTargetPositions.set(mesh.uuid, original.clone());
    }
  }
  
  // Start tween
  gridTweenActive = true;
  gridTweenProgress = 0;
  gridTweenStartTime = performance.now();
}

function updateGridTween(now) {
  if (!gridTweenActive) return;
  
  gridTweenProgress = (now - gridTweenStartTime) / gridTweenDuration;
  if (gridTweenProgress >= 1) {
    gridTweenProgress = 1;
    gridTweenActive = false;
  }
  
  // Easing function (ease-out cubic)
  const t = gridTweenProgress;
  const eased = 1 - Math.pow(1 - t, 3);
  
  // Update mesh positions
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    const target = gridTargetPositions.get(mesh.uuid);
    if (!target) continue;
    
    const original = mesh.userData.originalPosition;
    if (!original) continue;
    
    // Interpolate between original and target
    const isUnfolding = false;
    const start = isUnfolding ? original : gridTargetPositions.get(mesh.uuid);
    const end = isUnfolding ? target : original;
    
    if (start && end) {
      mesh.position.lerpVectors(start, end, eased);
    }
  }
  
  // Update edge geometries to follow nodes
  for (let i = 0; i < edgeObjs.length; i++) {
    const edge = edgeObjs[i];
    const src = nodeMap[edge.src];
    const tgt = nodeMap[edge.tgt];
    const srcMesh = nodeMeshMap[edge.src];
    const tgtMesh = nodeMeshMap[edge.tgt];
    
    if (srcMesh && tgtMesh && src && tgt) {
      // Update curve points if curve exists
      if (edge.curve && edge.curve.points) {
        const start = srcMesh.position.clone();
        const end = tgtMesh.position.clone();
        const mid = new THREE.Vector3().lerpVectors(start, end, 0.5);
        mid.y += 50; // Arc height
        
        // Update curve points array
        edge.curve.points[0].copy(start);
        edge.curve.points[1].copy(mid);
        edge.curve.points[2].copy(end);
      }
      
      // Update line geometry
      if (edge.line && edge.line.geometry) {
        if (edge.curve) {
          const points = edge.curve.getPoints(32);
          edge.line.geometry.setFromPoints(points);
        }
      }
    }
  }
}

function initSchematicOverlay() {
  if (typeof document === 'undefined') return;
  
  // Create canvas overlay for 2D schematic mode
  schematicOverlay = document.createElement('div');
  schematicOverlay.id = 'schematic-overlay';
  schematicOverlay.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    opacity: 0;
    z-index: 10;
    background: linear-gradient(135deg, #0a0f16 0%, #0f141a 100%);
  `;
  
  schematicCanvas = document.createElement('canvas');
  schematicCanvas.style.cssText = `
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
  `;
  
  schematicOverlay.appendChild(schematicCanvas);
  
  // Add to renderer's container AFTER the renderer's canvas to ensure 3D controls work
  const rendererContainer = renderer?.domElement?.parentElement;
  if (rendererContainer) {
    // Ensure renderer canvas has pointer-events auto
    renderer.domElement.style.pointerEvents = 'auto';
    rendererContainer.appendChild(schematicOverlay);
  }
  
  schematicCtx = schematicCanvas.getContext('2d');
  
  // Handle canvas resize
  window.addEventListener('resize', resizeSchematicCanvas);
  resizeSchematicCanvas();
  
  // Handle click events on canvas (only in 2D mode)
  schematicCanvas.addEventListener('click', handleSchematicClick);
  schematicCanvas.addEventListener('mousemove', handleSchematicHover);
  
  // Pan controls (only in 2D mode)
  schematicCanvas.addEventListener('mousedown', (e) => {
    if (!schematicVisible) return;
    if (e.button === 0) { // Left click
      schematicIsDragging = true;
      schematicDragStart = { x: e.clientX, y: e.clientY };
      schematicPanStart = { x: schematicPan.x, y: schematicPan.y };
      e.preventDefault();
    }
  });
  
  window.addEventListener('mousemove', (e) => {
    if (schematicIsDragging && schematicVisible) {
      const dx = e.clientX - schematicDragStart.x;
      const dy = e.clientY - schematicDragStart.y;
      schematicPan.x = schematicPanStart.x + dx;
      schematicPan.y = schematicPanStart.y + dy;
      renderSchematic();
    }
  });
  
  window.addEventListener('mouseup', () => {
    schematicIsDragging = false;
  });
  
  // Zoom controls (only in 2D mode)
  schematicCanvas.addEventListener('wheel', (e) => {
    if (!schematicVisible) return;
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    schematicZoom = Math.max(0.1, Math.min(5.0, schematicZoom * zoomFactor));
    renderSchematic();
  }, { passive: false });
}

function resizeSchematicCanvas() {
  if (!schematicCanvas || !schematicOverlay) return;
  const rect = schematicOverlay.getBoundingClientRect();
  schematicCanvas.width = rect.width * window.devicePixelRatio;
  schematicCanvas.height = rect.height * window.devicePixelRatio;
  schematicCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
  if (schematicVisible) renderSchematic();
}

function computeSchematicClusters() {
  if (!nodeMap || Object.keys(nodeMap).length === 0) return;
  
  const nodes = Object.values(nodeMap);
  const clusterMap = {};
  
  // Cluster by group/package (island)
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const groupKey = node.group || node.package || 'default';
    
    if (!clusterMap[groupKey]) {
      clusterMap[groupKey] = {
        id: groupKey,
        nodes: [],
        center: new THREE.Vector3(),
        bounds: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
      };
    }
    
    clusterMap[groupKey].nodes.push(node);
    
    // Update bounds using X/Z coordinates (project to 2D)
    const x = node.x || 0;
    const z = node.z || 0;
    clusterMap[groupKey].bounds.minX = Math.min(clusterMap[groupKey].bounds.minX, x);
    clusterMap[groupKey].bounds.maxX = Math.max(clusterMap[groupKey].bounds.maxX, x);
    clusterMap[groupKey].bounds.minY = Math.min(clusterMap[groupKey].bounds.minY, z);
    clusterMap[groupKey].bounds.maxY = Math.max(clusterMap[groupKey].bounds.maxY, z);
  }
  
  // Calculate cluster centers
  const clusters = Object.values(clusterMap);
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    cluster.center.x = (cluster.bounds.minX + cluster.bounds.maxX) / 2;
    cluster.center.y = (cluster.bounds.minY + cluster.bounds.maxY) / 2;
    cluster.width = cluster.bounds.maxX - cluster.bounds.minX;
    cluster.height = cluster.bounds.maxY - cluster.bounds.minY;
  }
  
  schematicClusters = clusters;
}

function worldToSchematicCoords(wx, wz, bounds, canvasWidth, canvasHeight) {
  // Project 3D world coordinates to 2D schematic coordinates
  const padding = 100;
  const scaleX = (canvasWidth - padding * 2) / bounds.width;
  const scaleY = (canvasHeight - padding * 2) / bounds.height;
  const scale = Math.min(scaleX, scaleY, 1.0) * schematicZoom;
  
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;
  
  const sx = cx + (wx - bounds.centerX) * scale + schematicPan.x;
  const sy = cy + (wz - bounds.centerY) * scale + schematicPan.y;
  
  return { x: sx, y: sy, scale };
}

function renderSchematic() {
  if (!schematicCtx || !schematicCanvas) return;
  
  const canvas = schematicCanvas;
  const ctx = schematicCtx;
  const width = canvas.width / window.devicePixelRatio;
  const height = canvas.height / window.devicePixelRatio;
  
  // Clear canvas
  ctx.clearRect(0, 0, width, height);
  
  // Calculate bounds for projection
  if (schematicClusters.length === 0) return;
  
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < schematicClusters.length; i++) {
    const cluster = schematicClusters[i];
    minX = Math.min(minX, cluster.bounds.minX);
    maxX = Math.max(maxX, cluster.bounds.maxX);
    minY = Math.min(minY, cluster.bounds.minY);
    maxY = Math.max(maxY, cluster.bounds.maxY);
  }
  
  const bounds = {
    minX, maxX, minY, maxY,
    width: maxX - minX || 1,
    height: maxY - minY || 1,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  };
  
  // Draw connections between clusters (orthogonal lines)
  ctx.strokeStyle = 'rgba(100, 150, 200, 0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  
  const clusterCenters = schematicClusters.map(c => worldToSchematicCoords(c.center.x, c.center.y, bounds, width, height));
  
  for (let i = 0; i < schematicClusters.length; i++) {
    const cluster = schematicClusters[i];
    const clusterPos = clusterCenters[i];
    
    // Draw lines to connected clusters
    for (let j = 0; j < cluster.nodes.length; j++) {
      const node = cluster.nodes[j];
      const ups = Array.isArray(node.upstream) ? node.upstream : [];
      const downs = Array.isArray(node.downstream) ? node.downstream : [];
      
      for (let k = 0; k < ups.length; k++) {
        const targetNode = nodeMap[ups[k]];
        if (targetNode) {
          const targetCluster = schematicClusters.find(c => c.nodes.includes(targetNode));
          if (targetCluster && targetCluster !== cluster) {
            const targetIdx = schematicClusters.indexOf(targetCluster);
            const targetPos = clusterCenters[targetIdx];
            
            // Draw orthogonal line
            ctx.moveTo(clusterPos.x, clusterPos.y);
            const midX = (clusterPos.x + targetPos.x) / 2;
            ctx.lineTo(midX, clusterPos.y);
            ctx.lineTo(midX, targetPos.y);
            ctx.lineTo(targetPos.x, targetPos.y);
          }
        }
      }
    }
  }
  ctx.stroke();
  
  // Draw clusters
  for (let i = 0; i < schematicClusters.length; i++) {
    const cluster = schematicClusters[i];
    const isExpanded = schematicExpandedClusters.has(cluster.id);
    const pos = clusterCenters[i];
    
    if (!isExpanded && cluster.nodes.length >= SCHEMATIC_CLUSTER_THRESHOLD) {
      // Draw collapsed cluster as parent label
      drawClusterLabel(ctx, pos, cluster);
    } else {
      // Draw individual nodes
      for (let j = 0; j < cluster.nodes.length; j++) {
        const node = cluster.nodes[j];
        const nodePos = worldToSchematicCoords(node.x, node.z, bounds, width, height);
        drawNodeLabel(ctx, nodePos, node);
      }
    }
  }
}

function drawClusterLabel(ctx, pos, cluster) {
  const width = SCHEMATIC_NODE_WIDTH * 1.5;
  const height = SCHEMATIC_NODE_HEIGHT * 1.5;
  const x = pos.x - width / 2;
  const y = pos.y - height / 2;
  
  // Draw cluster background
  ctx.fillStyle = 'rgba(15, 25, 40, 0.95)';
  ctx.strokeStyle = '#4a90d9';
  ctx.lineWidth = 2;
  
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 8);
  ctx.fill();
  ctx.stroke();
  
  // Draw cluster label
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${SCHEMATIC_FONT_SIZE}px 'Segoe UI', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  const label = `${cluster.id} (${cluster.nodes.length})`;
  ctx.fillText(label, pos.x, pos.y);
  
  // Store label bounds for click detection
  cluster.labelBounds = { x, y, width, height };
}

function drawNodeLabel(ctx, pos, node) {
  const width = SCHEMATIC_NODE_WIDTH;
  const height = SCHEMATIC_NODE_HEIGHT;
  const x = pos.x - width / 2;
  const y = pos.y - height / 2;
  
  // Draw node background
  const layerColor = getLayerDiagramColor(node.layer);
  ctx.fillStyle = 'rgba(10, 20, 35, 0.95)';
  ctx.strokeStyle = layerColor;
  ctx.lineWidth = 2;
  
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 6);
  ctx.fill();
  ctx.stroke();
  
  // Draw node label
  ctx.fillStyle = '#f0f8ff';
  ctx.font = `${SCHEMATIC_FONT_SIZE}px 'Segoe UI', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  const label = String(node.name || 'NODE').slice(0, 15);
  ctx.fillText(label, pos.x, pos.y);
  
  // Store label bounds for click detection
  node.schematicBounds = { x, y, width, height };
}

function handleSchematicClick(event) {
  const rect = schematicCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  
  // Check if clicked on a cluster
  for (let i = 0; i < schematicClusters.length; i++) {
    const cluster = schematicClusters[i];
    if (cluster.labelBounds) {
      const b = cluster.labelBounds;
      if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
        // Toggle cluster expansion
        if (schematicExpandedClusters.has(cluster.id)) {
          schematicExpandedClusters.delete(cluster.id);
        } else {
          schematicExpandedClusters.add(cluster.id);
        }
        renderSchematic();
        return;
      }
    }
  }
  
  // Check if clicked on a node
  const nodes = Object.values(nodeMap);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.schematicBounds) {
      const b = node.schematicBounds;
      if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
        // Select the node - same behavior as 3D
        applySelection(node);
        return;
      }
    }
  }
}

function handleSchematicHover(event) {
  const rect = schematicCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  
  let cursor = 'default';
  
  // Check if hovering over clickable element
  for (let i = 0; i < schematicClusters.length; i++) {
    const cluster = schematicClusters[i];
    if (cluster.labelBounds) {
      const b = cluster.labelBounds;
      if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
        cursor = 'pointer';
        break;
      }
    }
  }
  
  if (cursor === 'default') {
    const nodes = Object.values(nodeMap);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node.schematicBounds) {
        const b = node.schematicBounds;
        if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
          cursor = 'pointer';
          break;
        }
      }
    }
  }
  
  schematicCanvas.style.cursor = cursor;
}

const diagramNodeTargets = [];

// ── Dynamic Resolution Scaling (DRS) ─────────────────
// Monitors FPS and progressively degrades quality when sustained drops happen.
const DRS = {
  enabled: true,
  // Rolling window of inter-frame deltas (ms). Last 60 frames.
  deltas: new Float32Array(60),
  deltaIdx: 0,
  deltaFilled: 0,
  lastFrameTime: 0,
  // Trigger: avg FPS below this for >= sustainedMs triggers a downgrade step.
  fpsThreshold: 45,
  sustainedMs: 2000,
  belowSinceMs: 0,
  // Step state. Step 0 = native. Each step degrades further.
  step: 0,
  maxSteps: 3,                       // safety floor: don't keep degrading forever
  cooldownMs: 4000,                  // wait this long after a step before considering another
  lastStepAt: 0,
  // Baselines captured on first frame (so we can scale relative to user's setup)
  baseRenderDistance: 6000,
  baseCameraFar: 0,                  // captured lazily
  basePixelRatio: 1,                 // captured lazily
  // Per-step multipliers applied to baselines.
  // POLICY: prioritize sharpness — pixelRatio is NEVER reduced.
  // Instead, be aggressive with render distance: hide far islands first.
  // Step 3 effectively shows only the island the camera is in.
  pixelRatioByStep:    [1.0, 1.0, 1.0, 1.0],
  renderDistanceByStep:[1.0, 0.7, 0.4, 0.2],
};


// ── Constants ──────────────────────────────────────────
export const LAYER_X = { source: -300, staging: -100, intermediate: 100, mart: 300, consumption: 500, default: 650 };

// ─────────────────────────────────────────────────────────
// LAYOUT CONFIG — Tune the city footprint by editing these.
// Increase `nodeSpacingX/Z` to spread cubes inside a block.
// Increase/decrease `groupSpacing` to widen/tighten corridors
// between layer blocks. `maxPerRow` controls grid wrap width.
// ─────────────────────────────────────────────────────────
export const LAYOUT_CONFIG = {
  // Spacing between cubes inside the same color block (Micro-layout)
  nodeSpacingX: 60,
  nodeSpacingZ: 60,
  // Maximum buildings per row before wrapping to a new row
  maxPerRow: 20,
  // Corridor between blocks of different colors (Macro-layout)
  groupSpacing: 250,
};

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
  // Uniform base plate: every node gets the same neutral value.
  if (metric === 'uniform') return 1;

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
    return Math.max(1, deps);
  }

  // Default: execution_time (mapped to larger domain for stable log scaling)
  const exec = toPositiveNumber(n.execution_time);
  return Math.max(1, exec * 100000);
}

function getSwellScaleForNode(n, ud, intensityOverride = null) {
  const metric = State.dataSwellMetric || 'uniform';
  // Uniform base plate: identical 1.0 scale for every node — clean honest look.
  if (metric === 'uniform') {
    return { widthScale: 1.0, heightScale: 1.0, weight: 0 };
  }
  const hasOverride = intensityOverride !== null && intensityOverride !== undefined;
  const rawIntensity = hasOverride
    ? Number(intensityOverride)
    : Number(State.dataSwellIntensity);
  const uiIntensity = Math.max(0.5, Math.min(2.0, rawIntensity || 1.0));
  const intensity = Math.max(1.0, Math.min(3.0, uiIntensity * 2.0));
  const metricValue = resolveSwellMetricValue(n, ud, metric);
  const userDefinedThreshold = Math.max(
    1,
    Number(State.referenceThreshold || State.autoMaxThreshold || 1)
  );

  const weight = Math.min(metricValue / userDefinedThreshold, 1.0);
  const finalWeight = Math.sqrt(weight);
  const blendedWeight = (weight * 0.3) + (finalWeight * 0.7);

  const metricProfile = {
    rows: { gamma: 0.92, widthGain: 4.8, heightGain: 0.95, widthCap: 7.6, overflowHeightGain: 4.2 },
    execution_time: { gamma: 1.00, widthGain: 3.8, heightGain: 0.72, widthCap: 6.8, overflowHeightGain: 3.6 },
    code_length: { gamma: 0.96, widthGain: 4.3, heightGain: 0.82, widthCap: 7.2, overflowHeightGain: 3.9 },
    connections: { gamma: 0.94, widthGain: 4.5, heightGain: 0.86, widthCap: 7.4, overflowHeightGain: 4.0 },
  }[metric] || { gamma: 0.95, widthGain: 4.2, heightGain: 0.82, widthCap: 7.0, overflowHeightGain: 3.8 };

  const profiledWeight = Math.pow(Math.max(0, blendedWeight), metricProfile.gamma);
  const contrastWeight = Math.pow(profiledWeight, 1.18);

  // Stage 1: prioritize width growth for readability.
  const widthRaw = 1.0 + (contrastWeight * intensity * metricProfile.widthGain);
  const widthScale = Math.min(metricProfile.widthCap, widthRaw);

  // Stage 2: once width saturates, push growth into height.
  const preCapHeight = 1.0 + (contrastWeight * intensity * metricProfile.heightGain * 0.35);
  let overflowHeightBoost = 0;
  if (widthRaw > metricProfile.widthCap) {
    const capSpan = Math.max(0.25, metricProfile.widthCap - 1.0);
    const overflow = (widthRaw - metricProfile.widthCap) / capSpan;
    overflowHeightBoost = Math.pow(Math.max(0, overflow), 0.82) * metricProfile.overflowHeightGain * intensity;
  }
  const heightScale = preCapHeight + overflowHeightBoost;

  return {
    widthScale: Math.max(1.0, Math.min(widthScale, metricProfile.widthCap)),
    heightScale: Math.max(1.0, Math.min(heightScale, 9.5)),
    weight: profiledWeight,
  };
}

function refreshEdgeGeometryFromNodes() {
  for (let i = 0; i < edgeObjs.length; i++) {
    const edge = edgeObjs[i];
    const src = nodeMap[edge.src];
    const tgt = nodeMap[edge.tgt];
    const srcMesh = nodeMeshMap[edge.src];
    const tgtMesh = nodeMeshMap[edge.tgt];
    if (!src || !tgt || !edge.curve) continue;

    const start = edge.curve.v0 || (Array.isArray(edge.curve.points) ? edge.curve.points[0] : null);
    const mid = edge.curve.v1 || (Array.isArray(edge.curve.points) ? edge.curve.points[1] : null);
    const end = edge.curve.v2 || (Array.isArray(edge.curve.points) ? edge.curve.points[2] : null);
    if (!start || !mid || !end) continue;

    const sx = srcMesh ? srcMesh.position.x : (Number.isFinite(src?.x) ? src.x : 0);
    const sz = srcMesh ? srcMesh.position.z : (Number.isFinite(src?.z) ? src.z : 0);
    const tx = tgtMesh ? tgtMesh.position.x : (Number.isFinite(tgt?.x) ? tgt.x : 0);
    const tz = tgtMesh ? tgtMesh.position.z : (Number.isFinite(tgt?.z) ? tgt.z : 0);

    start.set(sx, 10, sz);
    end.set(tx, 10, tz);
    const dist = Math.hypot(tx - sx, tz - sz);
    const midY = edge.isInterIsland ? Math.max(400, dist * 0.35) : 22;
    mid.set((sx + tx) * 0.5, midY, (sz + tz) * 0.5);

    if (edge.line && edge.line.geometry) {
      edge.line.geometry.setFromPoints(edge.curve.getPoints(32));
      if (edge.line.geometry.computeBoundingSphere) {
        edge.line.geometry.computeBoundingSphere();
      }
    }

    if (Array.isArray(edge.particles) && edge.particles.length) {
      for (let j = 0; j < edge.particles.length; j++) {
        const p = edge.particles[j];
        if (!p || !p.userData) continue;
        p.userData.curve = edge.curve;
        const t = Number(p.userData.t) || 0;
        edge.curve.getPoint(t, _tmpVec3);
        p.position.copy(_tmpVec3);
      }
    }
  }
}

function applyDynamicSwellLayout() {
  const enabled = !!State.dataVolumeMode;

  const buckets = {};
  for (let i = 0; i < meshes.length; i++) {
    const n = meshes[i]?.userData?.node;
    if (!n) continue;
    const key = `${n.group || 'default'}::${n.layer || 'default'}`;
    (buckets[key] = buckets[key] || []).push(n);
  }

  if (!enabled) {
    let changed = false;
    const keys = Object.keys(buckets);
    for (let i = 0; i < keys.length; i++) {
      const arr = buckets[keys[i]];
      for (let j = 0; j < arr.length; j++) {
        const n = arr[j];
        if (!Number.isFinite(n._baseLayoutX) || !Number.isFinite(n._baseLayoutZ)) continue;
        if (Math.abs(n.x - n._baseLayoutX) > 0.01 || Math.abs(n.z - n._baseLayoutZ) > 0.01) {
          n.x += (n._baseLayoutX - n.x) * 0.2;
          n.z += (n._baseLayoutZ - n.z) * 0.2;
          changed = true;
        } else {
          n.x = n._baseLayoutX;
          n.z = n._baseLayoutZ;
        }
      }
    }
    if (changed) _layoutEdgeRefreshPending = true;
    return;
  }

  let changed = false;
  const keys = Object.keys(buckets);
  for (let i = 0; i < keys.length; i++) {
    const arr = buckets[keys[i]];
    if (!arr.length) continue;

    let cx = 0;
    let cz = 0;
    let maxWidth = 1;
    for (let j = 0; j < arr.length; j++) {
      const n = arr[j];
      const bx = Number.isFinite(n._baseLayoutX) ? n._baseLayoutX : n.x;
      const bz = Number.isFinite(n._baseLayoutZ) ? n._baseLayoutZ : n.z;
      cx += bx;
      cz += bz;
      const w = getSwellScaleForNode(n, null, 1.0).widthScale;
      if (w > maxWidth) maxWidth = w;
    }
    cx /= arr.length;
    cz /= arr.length;

    const blockStretch = 1 + Math.max(0, maxWidth - 1) * 0.26;

    for (let j = 0; j < arr.length; j++) {
      const n = arr[j];
      const bx = Number.isFinite(n._baseLayoutX) ? n._baseLayoutX : n.x;
      const bz = Number.isFinite(n._baseLayoutZ) ? n._baseLayoutZ : n.z;
      const dx = bx - cx;
      const dz = bz - cz;

      const ownW = getSwellScaleForNode(n, null, 1.0).widthScale;
      const ownPush = Math.max(0, ownW - 1) * 8;
      const len = Math.hypot(dx, dz);
      const dirX = len > 1e-4 ? (dx / len) : 0;
      const dirZ = len > 1e-4 ? (dz / len) : 0;

      const tx = cx + dx * blockStretch + dirX * ownPush;
      const tz = cz + dz * blockStretch + dirZ * ownPush;

      if (Math.abs(n.x - tx) > 0.01 || Math.abs(n.z - tz) > 0.01) {
        n.x += (tx - n.x) * 0.2;
        n.z += (tz - n.z) * 0.2;
        changed = true;
      }
    }
  }

  if (changed) _layoutEdgeRefreshPending = true;
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
  const metric = State.dataSwellMetric || 'uniform';

  if (metric === 'uniform') return 'Base';

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

  // execution_time: be honest when there's no real data for this node.
  const exec = toPositiveNumber(n.execution_time);
  if (exec <= 0 || n.time_source === 'none') return 'Time: N/A';
  return `${exec.toFixed(2)}s`;
}

// ─────────────────────────────────────────────────────────
// Single source of truth for the "is this node's execution_time displayable?"
// question. Used by every label and UI surface so we never render a number
// next to a "no data" message simultaneously.
// ─────────────────────────────────────────────────────────
export function hasDisplayableTime(n) {
  if (!n) return false;
  const src = n.time_source;
  if (src !== 'real' && src !== 'marketing') return false;
  const t = Number(n.execution_time);
  return Number.isFinite(t) && t > 0;
}

export function formatTimeLabel(n) {
  return hasDisplayableTime(n) ? `${Number(n.execution_time).toFixed(2)}s` : 'Time: N/A';
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
let cinematicFlightActive = false;
let cinematicPrevDRSEnabled = true;
export const GLOBAL_VIEW_FLIGHT_MS = 4200;
let islandJumpPanel = null;
let islandJumpSelect = null;

// ─────────────────────────────────────────────────────────
// RENDER DISTANCE POLICY — always show everything.
// camera.far and MAX_RENDER_DISTANCE are pinned to a very large value so
// users do not need to tune render distance and the whole city stays visible.
// ─────────────────────────────────────────────────────────
let userRenderDistance = (() => {
  return ALWAYS_RENDER_DISTANCE;
})();
let isGlobalViewActive = false;
// Snapshot of OrbitControls settings BEFORE Global View mutates them, so an
// interrupt or completion can put the user back into their normal navigation.
let _preGlobalViewControlsState = null;
// Flag to prevent immediate interruption when global view is activated programmatically
let _globalViewJustActivated = false;

export function getUserRenderDistance() { return userRenderDistance; }

export function setUserRenderDistance(v) {
  const val = ALWAYS_RENDER_DISTANCE;
  userRenderDistance = val;
  // Apply immediately ONLY if not currently in Global View (which has its own
  // larger far plane). Global View → user-distance restoration happens on
  // controls 'start' (see registerControlsInterruptHandler).
  if (!isGlobalViewActive && camera) {
    camera.far = val;
    camera.updateProjectionMatrix();
  }
  // Sync DRS baselines so the dynamic resolution scaler doesn't push it back.
  if (DRS) {
    DRS.baseCameraFar = val;
    DRS.baseRenderDistance = Math.max(DRS.baseRenderDistance || 0, val);
  }
  needsUpdate = true;
}
const GLOBAL_VIEW_FIT_MULTIPLIER = 1.35;
const GLOBAL_VIEW_ALTITUDE_BIAS = 0.75;
const GLOBAL_VIEW_ALTITUDE_OFFSET = 180;

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

function getDiagramNodeX(n) {
  return Number.isFinite(Number(n?.diagramX)) ? Number(n.diagramX) : Number(n?.x || 0);
}

function getDiagramNodeZ(n) {
  return Number.isFinite(Number(n?.diagramZ)) ? Number(n.diagramZ) : Number(n?.z || 0);
}

function computeDiagramLayout(nodes) {
  if (!Array.isArray(nodes) || !nodes.length) return;

  const layerGapX = 1.35;
  const slotGapZ = 96;
  const smoothPasses = 6;

  const layerBuckets = {};
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const layer = n.layer || 'default';
    if (!layerBuckets[layer]) layerBuckets[layer] = [];
    layerBuckets[layer].push(n);
  }

  const layers = Object.keys(layerBuckets).sort((a, b) => {
    const ax = LAYER_X[a] ?? LAYER_X.default;
    const bx = LAYER_X[b] ?? LAYER_X.default;
    return ax - bx;
  });

  const rankMap = {};
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const bucket = layerBuckets[layer];
    bucket.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
    const center = (bucket.length - 1) * 0.5;
    for (let j = 0; j < bucket.length; j++) {
      const n = bucket[j];
      rankMap[n.id] = (j - center) * slotGapZ;
    }
  }

  const getNeighbors = (n) => {
    const res = [];
    const ups = Array.isArray(n.upstream) ? n.upstream : [];
    const downs = Array.isArray(n.downstream) ? n.downstream : [];
    for (let i = 0; i < ups.length; i++) res.push(ups[i]);
    for (let i = 0; i < downs.length; i++) res.push(downs[i]);
    return res;
  };

  for (let pass = 0; pass < smoothPasses; pass++) {
    for (let li = 0; li < layers.length; li++) {
      const bucket = layerBuckets[layers[li]];
      for (let bi = 0; bi < bucket.length; bi++) {
        const n = bucket[bi];
        const neighbors = getNeighbors(n);
        if (!neighbors.length) continue;

        let sum = 0;
        let count = 0;
        for (let ni = 0; ni < neighbors.length; ni++) {
          const rk = rankMap[neighbors[ni]];
          if (Number.isFinite(rk)) {
            sum += rk;
            count++;
          }
        }
        if (!count) continue;

        const avg = sum / count;
        rankMap[n.id] = (rankMap[n.id] * 0.58) + (avg * 0.42);
      }
    }

    for (let li = 0; li < layers.length; li++) {
      const bucket = layerBuckets[layers[li]];
      bucket.sort((a, b) => (rankMap[a.id] - rankMap[b.id]));
      const center = (bucket.length - 1) * 0.5;
      for (let bi = 0; bi < bucket.length; bi++) {
        const n = bucket[bi];
        rankMap[n.id] = (bi - center) * slotGapZ;
      }
    }
  }

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const baseX = (LAYER_X[n.layer || 'default'] ?? LAYER_X.default) * layerGapX;
    n.diagramX = baseX;
    n.diagramZ = rankMap[n.id] ?? 0;
  }
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

// ─────────────────────────────────────────────────────────
// VOLUME SPRITE — same GPU-only pipeline as makeTimeSprite. Replaces the old
// CSS2DObject + DOM-div approach which was creating per-node DOM elements
// and traversing the entire scene every frame. Uses a single CanvasTexture
// per node, blended additively, raycast-disabled.
// ─────────────────────────────────────────────────────────
const _SEVERITY_COLOR = { high: '#ff4400', mid: '#ffd700', low: '#00f3ff' };

function _drawVolumeCanvas(canvas, text, severityLevel, isLowGfx) {
  const ctx = canvas.getContext('2d');
  const col = _SEVERITY_COLOR[severityLevel] || _SEVERITY_COLOR.low;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `bold 84px 'Courier New'`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // Skip the expensive shadow blur in LOW (canvas shadows are slow).
  if (!isLowGfx) {
    ctx.shadowColor = col; ctx.shadowBlur = 24;
  } else {
    ctx.shadowBlur = 0;
  }
  ctx.fillStyle = col;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
}

export function makeVolumeSprite(text, severityLevel, isLowGfx = false) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 200;
  _drawVolumeCanvas(c, text, severityLevel, isLowGfx);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, blending: THREE.AdditiveBlending
  }));
  sp.scale.set(36, 14.4, 1);
  sp.raycast = () => {};
  // Stash the canvas so the animate loop can repaint without re-allocating.
  sp.userData = { canvas: c, text, severityLevel, isLowGfx };
  return sp;
}

// Repaint sprite texture in-place (cheap-ish: canvas redraw + tex.needsUpdate).
function refreshVolumeSprite(sp, text, severityLevel, isLowGfx) {
  const ud = sp.userData || (sp.userData = {});
  if (ud.text === text && ud.severityLevel === severityLevel && ud.isLowGfx === isLowGfx) return;
  _drawVolumeCanvas(ud.canvas, text, severityLevel, isLowGfx);
  if (sp.material && sp.material.map) sp.material.map.needsUpdate = true;
  ud.text = text; ud.severityLevel = severityLevel; ud.isLowGfx = isLowGfx;
}

function getLayerDiagramColor(layer) {
  const l = String(layer || '').toLowerCase();
  if (l === 'source') return '#7ad8a1';
  if (l === 'staging') return '#39ff14';
  if (l === 'intermediate') return '#66c2ff';
  if (l === 'mart') return '#2f9bff';
  if (l === 'consumption') return '#ffd166';
  return '#8fb3c8';
}

function makeDiagramNodeSprite(node) {
  const text = String(node?.name || 'NODE').slice(0, 42);
  const fill = getLayerDiagramColor(node?.layer);
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const ctx = c.getContext('2d');

  ctx.clearRect(0, 0, c.width, c.height);
  const x = 14;
  const y = 16;
  const w = c.width - 28;
  const h = c.height - 32;
  const r = 24;

  // Schematic technical background
  ctx.fillStyle = 'rgba(8, 12, 18, 0.92)';
  ctx.strokeStyle = fill;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Technical grid pattern
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let i = x + 20; i < x + w; i += 20) {
    ctx.beginPath();
    ctx.moveTo(i, y);
    ctx.lineTo(i, y + h);
    ctx.stroke();
  }

  ctx.font = "bold 44px 'Courier New', monospace";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f0f8ff';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 8;
  ctx.fillText(text, c.width / 2, c.height / 2);

  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  // Larger, more readable size for schematic mode
  const widthWorld = 96;
  const heightWorld = 36;
  sprite.scale.set(widthWorld, heightWorld, 1);
  sprite.name = 'diagramNode';
  sprite.visible = false;
  sprite.renderOrder = 40;
  sprite.userData.node = node;
  sprite.userData.isDiagramSprite = true; // Flag for clustering logic
  return sprite;
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
// HONESTY RULE: when there is no real execution_time data (run_results.json
// missing), the city must render as a flat base-plate. Heights only vary
// when we genuinely know how long each node takes to run.
const FLAT_PLATE_HEIGHT = 14;
export function calcHeight(n, perf) {
  if (perf) {
    if (!hasReal) return FLAT_PLATE_HEIGHT; // no real data → flat
    const norm = maxTime > minTime ? (n.execution_time - minTime) / (maxTime - minTime) : 0.5;
    return 6 + norm * 64;
  }
  // Default (non-perf) city: flat unless we have real data to justify
  // connectivity-based height variations.
  if (!hasReal) return FLAT_PLATE_HEIGHT;
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
  // Store original 3D position for grid unfolding
  mesh.userData.originalPosition = new THREE.Vector3(n.x, 0, n.z);
  // castShadow disabled: 450 dynamic shadow casters were a major GPU cost.
  mesh.castShadow = false;

  const voxel = makeVoxelMesh(col);
  voxel.position.set(n.x, 0, n.z);
  voxel.userData.dist = Math.sqrt(n.x * n.x + n.z * n.z);
  const _islandParentGroup = _islandParent(n.group);
  _islandParentGroup.add(voxel); voxels.push(voxel);

  mesh.visible = false;
  mesh.userData = { 
    node:n, baseH:h, perfH:ph, targetH:h, currentH:h, baseEmis:emis, voxel,
    volumeScale, swellW, swellD, baseW, baseD, rowCount, rowCountEstimated, isCritical,
    swellHeightScale: swellScale.heightScale
  };

  if (n.is_dead_end) { const hazard = makeHazardSprite(); mesh.add(hazard); mesh.userData.hazard = hazard; hazard.visible = !State.perfMode; }

  // Neon edges
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({color:col,transparent:true,opacity:0.85})));

  // PERFORMANCE: PointLights removed (halo, glow, pulseLight).
  // For 450 nodes that was ~1350 dynamic lights → WebGL shader uniform overflow → crash.
  // The visual glow comes from emissive material instead, modulated dynamically below.
  // Bottleneck/halo effect is handled via emissive flash in the render loop (see perfMode branch).

  // Thermal Degradation VFX
  if (!vfxManager) vfxManager = new VFXManager(scene);
  const thermalGroup = vfxManager.createThermalGroup(h);
  mesh.add(thermalGroup);

  const sp = makeSprite(n.name, col);
  sp.position.set(0, h + 8, 0); sp.name = 'label'; mesh.add(sp); mesh.userData.label = sp;

  const timeSp = makeTimeSprite(formatTimeLabel(n), n.is_bottleneck);
  timeSp.position.set(0, h + 25, 0); timeSp.visible = false; timeSp.name = 'timeLabel';
  mesh.add(timeSp); mesh.userData.timeLabel = timeSp;

  // ── Data Volume Label (Sprite, GPU-only) ───────────────
  // Eagerly created exactly like the time label: ONE Sprite per node, with a
  // CanvasTexture that gets repainted in-place when the metric/severity change.
  // No CSS2DObject, no DOM nodes, no labelRenderer pass.
  const volSp = makeVolumeSprite(formatSwellLabel(n, mesh.userData), severity.level, State.graphicsMode === 'low');
  volSp.position.set(0, h + 25, 0);
  volSp.visible = false;
  volSp.material.opacity = 0;
  volSp.name = 'volumeLabel';
  mesh.add(volSp);
  mesh.userData.volumeLabel = volSp;
  mesh.userData.volumeLabelOffset = 28;
  mesh.userData.lastSwellMetric = State.dataSwellMetric || 'uniform';
  mesh.userData.lastSwellSeverity = severity.level;

  // PointLight pulse for critical volume removed (perf). Pulse is now done via
  // emissive intensity modulation in the render loop.

  mesh.scale.y = 0;
  _islandParentGroup.add(mesh); meshes.push(mesh); nodeMeshMap[n.id] = mesh;

  const diagramSprite = makeDiagramNodeSprite(n);
  diagramSprite.position.set(getDiagramNodeX(n), 2.2, getDiagramNodeZ(n));
  _islandParentGroup.add(diagramSprite);
  mesh.userData.diagramSprite = diagramSprite;
  diagramNodeTargets.push(diagramSprite);

  _cullDirty = true;
  return mesh;
}

// ── Edge Factory ───────────────────────────────────────
export function buildEdge(link) {
  const srcId = typeof link.source==='object'?link.source.id:link.source;
  const tgtId = typeof link.target==='object'?link.target.id:link.target;
  const src = nodeMap[srcId], tgt = nodeMap[tgtId];
  if (!src || !tgt) {
    console.warn('[buildEdge] Skipping link, missing node:', { srcId, tgtId, hasSrc: !!src, hasTgt: !!tgt });
    return;
  }
  
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
  const line = new THREE.Line(geo, mat);
  
  // Inter-island arcs go to globalArcsGroup (never culled with islands).
  // Intra-island arcs go to the island's group so they hide together.
  const arcParent = isInterIsland
    ? (globalArcsGroup || (globalArcsGroup = (() => { const g = new THREE.Group(); g.name = 'globalArcs'; scene.add(g); return g; })()))
    : _islandParent(src.group);
  arcParent.add(line);

  // Arrows removed entirely from the visualization. Direction is conveyed by
  // the moving particles in HIGH mode and by the arc curvature itself.
  const arrows = [];

  // Store edge with arrows array
  edgeObjs.push({
    src: srcId,
    tgt: tgtId,
    line,
    arrows, // Array of arrows instead of single arrow
    isInterIsland,
    particles: [],
    curve
  });

  const diagramA = new THREE.Vector3(getDiagramNodeX(src), 2.0, getDiagramNodeZ(src));
  const diagramB = new THREE.Vector3(getDiagramNodeX(tgt), 2.0, getDiagramNodeZ(tgt));
  const diagramLineMat = new THREE.LineBasicMaterial({
    color: isInterIsland ? 0xa4caff : 0x7b9ab6,
    transparent: true,
    opacity: isInterIsland ? 0.9 : 0.72,
    depthTest: false,
  });
  const diagramLineGeo = new THREE.BufferGeometry().setFromPoints([diagramA, diagramB]);
  const diagramLine = new THREE.Line(diagramLineGeo, diagramLineMat);
  diagramLine.visible = false;
  diagramLine.renderOrder = 33;
  arcParent.add(diagramLine);

  const diagramDir = diagramB.clone().sub(diagramA);
  diagramDir.y = 0;
  if (diagramDir.lengthSq() < 1e-6) diagramDir.set(1, 0, 0);
  diagramDir.normalize();
  const headLen = isInterIsland ? 12 : 9;
  const headPos = diagramB.clone().addScaledVector(diagramDir, -headLen * 0.9);
  const diagramArrow = new THREE.ArrowHelper(diagramDir, headPos, headLen, 0xd8ebff, headLen * 0.55, headLen * 0.42);
  diagramArrow.line.material.transparent = true;
  diagramArrow.line.material.opacity = 0.95;
  diagramArrow.line.visible = false;
  diagramArrow.cone.material.transparent = true;
  diagramArrow.cone.material.opacity = 0.95;
  diagramArrow.visible = false;
  diagramArrow.renderOrder = 34;
  arcParent.add(diagramArrow);
  
  // Always create particles. Visibility is controlled by setGraphicsQuality so
  // toggling LOW↔HIGH via slider works without rebuilding edges.
  const N = isInterIsland ? 12 : 5;
  const particles = [];
  for (let i = 0; i < N; i++) {
    const pGeo = new THREE.SphereGeometry(pSize, 8, 8);
    const pMat = new THREE.MeshBasicMaterial({color: particleColor, transparent:true, opacity: isInterIsland ? 0.8 : 0.25});
    const p = new THREE.Mesh(pGeo, pMat);
    const tgtNode = nodeMap[tgtId];
    const isAccelerated = tgtNode && tgtNode.layer === 'mart';
    const baseSpeed = isInterIsland ? 0.002 : 0.005;
    const speed0 = isAccelerated ? baseSpeed * 1.8 : baseSpeed;
    p.userData = { curve, t: i/N, speed: speed0, baseSpeed: speed0 };
    p.visible = true;
    arcParent.add(p); particles.push(p);
  }
  
  // Update the edgeObj with particles and diagram elements
  const edgeObj = edgeObjs[edgeObjs.length - 1];
  edgeObj.particles = particles;
  edgeObj.parent = arcParent;
  edgeObj.diagramLine = diagramLine;
  edgeObj.diagramArrow = diagramArrow;
}

export function zoomToFitAll(durationMs = GLOBAL_VIEW_FLIGHT_MS) {
  triggerGlobalView(durationMs);
}

// ── SLA Fire Logic ─────────────────────────────────────
export function getNodeSLA(node) {
  if (State.slaNodes[node.id]    !== undefined) return State.slaNodes[node.id];
  if (State.slaZones[node.layer] !== undefined) return State.slaZones[node.layer];
  return State.userDefinedSLA;
}

export function updateFires() {
  let count = 0;
  Object.keys(islandFireState).forEach(k => { islandFireState[k] = false; });
  meshes.forEach(m => {
    const n = m.userData.node; if (!n) return;
    const threshold = getNodeSLA(n);
    const wasBottleneck = n.is_bottleneck;
    n.is_bottleneck = (n.execution_time || 0) >= threshold;
    if (n.is_bottleneck) {
      count++;
      islandFireState[n.group || 'default'] = true;
    }

    const fire = m.children.find(c => c.name === 'fire');
    const halo = m.children.find(c => c.name === 'halo');
    if (fire) fire.visible = n.is_bottleneck && State.perfMode && m.visible;
    if (halo) halo.visible = n.is_bottleneck && State.perfMode && m.visible;

    if (wasBottleneck !== n.is_bottleneck && m.userData.timeLabel) {
      const oldSprite = m.userData.timeLabel;
      const newSprite = makeTimeSprite(formatTimeLabel(n), n.is_bottleneck);
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
// ── Focus Mode: Detect nearest island to camera ─────────────
let nearestIsland = null;

function updateNearestIsland() {
  if (!camera || !islandMeta) {
    nearestIsland = null;
    return;
  }

  let nearestDist = Infinity;
  let nearestKey = null;

  for (const key in islandMeta) {
    const meta = islandMeta[key];
    if (!meta || !meta.center) continue;

    const dist = Math.sqrt(
      Math.pow(camera.position.x - meta.center.x, 2) +
      Math.pow(camera.position.z - meta.center.z, 2)
    );

    if (dist < nearestDist) {
      nearestDist = dist;
      nearestKey = key;
    }
  }

  // Only consider island as "nearest" if within reasonable distance
  const newNearestIsland = nearestDist < 400 ? nearestKey : null;
  
  if (newNearestIsland !== nearestIsland) {
    console.log('[CityEngine] Nearest island changed:', nearestIsland, '->', newNearestIsland, '(distance:', nearestDist.toFixed(0), ')');
    nearestIsland = newNearestIsland;
  }
}

// Update nearest island on camera movement
if (controls) {
  controls.addEventListener('change', () => {
    updateNearestIsland();
    // Apply island-based filtering when not in node selection mode
    if (!State.selectedNode) {
      applyIslandFilter();
    }
  });
}

function applyIslandFilter() {
  if (!nearestIsland) {
    // Restore all edges when no island is nearby
    edgeObjs.forEach(e => {
      e.line.material.opacity = e.isInterIsland ? 0.8 : 0.45;
      e.line.material.color.set(e.isInterIsland ? 0xffdf00 : 0x0a3344);
      e.line.renderOrder = 0;
      if (e.arrows && Array.isArray(e.arrows)) {
        const arrowOpacity = e.line.material.opacity;
        e.arrows.forEach(arrow => {
          arrow.line.material.opacity = arrowOpacity;
          arrow.cone.material.opacity = arrowOpacity;
          arrow.line.material.color.copy(e.line.material.color);
          arrow.cone.material.color.copy(e.line.material.color);
          arrow.visible = arrowOpacity > 0.01;
        });
      }
    });
    return;
  }

  // Calculate connected islands - islands that have direct connections to nearestIsland
  const connectedIslands = new Set();
  connectedIslands.add(nearestIsland);
  edgeObjs.forEach(e => {
    const srcNode = nodeMap[e.src];
    const tgtNode = nodeMap[e.tgt];
    const srcGroup = srcNode?.group || 'default';
    const tgtGroup = tgtNode?.group || 'default';
    
    // Add islands directly connected to nearestIsland
    if (srcGroup === nearestIsland && e.isInterIsland) {
      connectedIslands.add(tgtGroup);
    }
    if (tgtGroup === nearestIsland && e.isInterIsland) {
      connectedIslands.add(srcGroup);
    }
  });

  // Filter edges - only show inter-island edges that connect connectedIslands
  edgeObjs.forEach(e => {
    const srcNode = nodeMap[e.src];
    const tgtNode = nodeMap[e.tgt];
    const srcGroup = srcNode?.group || 'default';
    const tgtGroup = tgtNode?.group || 'default';
    
    // For inter-island edges, show only if both islands are in connectedIslands
    const islandsConnected = e.isInterIsland 
      ? (connectedIslands.has(srcGroup) && connectedIslands.has(tgtGroup))
      : true;
    
    const shouldShow = islandsConnected;
    
    e.line.material.opacity = shouldShow ? (e.isInterIsland ? 0.8 : 1.0) : (e.isInterIsland ? 0.0 : 0.45);
    e.line.material.color.set(shouldShow ? (e.isInterIsland ? 0xffdf00 : 0x0a3344) : 0x0a1114);
    e.line.renderOrder = shouldShow ? 10 : 0;
    if (e.arrows && Array.isArray(e.arrows)) {
      const arrowOpacity = e.line.material.opacity;
      e.arrows.forEach(arrow => {
        arrow.line.material.opacity = arrowOpacity;
        arrow.cone.material.opacity = arrowOpacity;
        arrow.line.material.color.copy(e.line.material.color);
        arrow.cone.material.color.copy(e.line.material.color);
        arrow.visible = arrowOpacity > 0.01;
      });
    }
  });
}

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

  // Calculate connected islands for Focus Mode (only for proximity mode, not node selection)
  const connectedIslands = new Set();
  const focusIsland = focusNode ? (focusNode.group || 'default') : nearestIsland;
  
  if (focusIsland && !focusNode) {
    // Only calculate connected islands when in proximity mode (no node selected)
    connectedIslands.add(focusIsland);
    edgeObjs.forEach(e => {
      const srcNode = nodeMap[e.src];
      const tgtNode = nodeMap[e.tgt];
      const srcGroup = srcNode?.group || 'default';
      const tgtGroup = tgtNode?.group || 'default';
      
      // Add islands directly connected to the focus island
      if (srcGroup === focusIsland && e.isInterIsland) {
        connectedIslands.add(tgtGroup);
      }
      if (tgtGroup === focusIsland && e.isInterIsland) {
        connectedIslands.add(srcGroup);
      }
    });
  }

  meshes.forEach(m => {
    const n = m.userData.node; if (!n) return;
    const id = n.id;
    const inSet = focusNode ? critSet.has(id) : true;
    const isBlastSource = blastMode && blastSourceId === id;

    const diagramSprite = m.userData.diagramSprite;
    if (diagramSprite && diagramSprite.material) {
      const spriteOpacity = focusNode ? (inSet ? 1.0 : 0.22) : 1.0;
      diagramSprite.material.opacity = spriteOpacity;
      const targetScale = (focusNode && inSet) ? 1.08 : 1.0;
      diagramSprite.scale.set(72 * targetScale, 27 * targetScale, 1);
    }

    m.children.forEach(child => {
      // GHOST MODE: Subtle outlines and labels for reference
      if (child.isLineSegments) child.material.opacity = inSet ? (isBlastSource ? 1.0 : 0.92) : (blastMode ? 0.03 : 0.05);
      if (child.isLight)  child.intensity = inSet ? (isBlastSource ? 6.2 : 2.0) : 0.0;
      // Skip time/volume labels — they have their own per-frame opacity logic
      // in the animate loop (distance culling + ease-in). Touching them here
      // causes a one-frame flash when clicking on empty space.
      if (child.isSprite && child.name !== 'timeLabel' && child.name !== 'volumeLabel') {
        child.material.opacity = inSet ? 1.0 : (blastMode ? 0.03 : 0.08);
      }
    });
  });
  edgeObjs.forEach(e => {
    // CRITICAL FIX: Only light edges that DIRECTLY TOUCH the selected cube
    const inPath = blastMode
      ? (blastSet.has(e.src) && blastSet.has(e.tgt))
      : (focusNode ? (e.src === focusNode.id || e.tgt === focusNode.id) : true);
    
    // Focus Mode: For inter-island edges, also check if islands are connected
    const srcNode = nodeMap[e.src];
    const tgtNode = nodeMap[e.tgt];
    const srcGroup = srcNode?.group || 'default';
    const tgtGroup = tgtNode?.group || 'default';
    const islandsConnected = connectedIslands.has(srcGroup) && connectedIslands.has(tgtGroup);
    
    const ghostColor = new THREE.Color(0x0a1114);
    const blastColor = new THREE.Color(0xff4400);
    const defaultColor = new THREE.Color(e.isInterIsland ? 0xffdf00 : 0x0a3344);
    
    // Focus Mode: Hide edges completely if they don't touch the focus node or connected islands
    const shouldShow = focusNode 
      ? (inPath || (e.isInterIsland && islandsConnected)) 
      : true;
    
    e.line.material.opacity   = focusNode ? (shouldShow ? (e.isInterIsland ? 0.8 : 1.0) : 0.0) : (e.isInterIsland ? 0.8 : 0.45);
    e.line.material.color.copy(focusNode ? (shouldShow ? (blastMode ? blastColor : highlightColor) : ghostColor) : defaultColor);
    e.line.renderOrder = shouldShow ? 10 : 0;
    if (e.arrows && Array.isArray(e.arrows)) {
      const arrowOpacity = e.line.material.opacity;
      e.arrows.forEach(arrow => {
        arrow.line.material.opacity = arrowOpacity;
        arrow.cone.material.opacity = arrowOpacity;
        arrow.line.material.color.copy(e.line.material.color);
        arrow.cone.material.color.copy(e.line.material.color);
        arrow.visible = arrowOpacity > 0.01;
      });
    }

    if (e.diagramLine) {
      const idleOpacity = e.isInterIsland ? 0.9 : 0.72;
      const ghostOpacity = blastMode ? 0.08 : 0.12;
      e.diagramLine.material.opacity = focusNode ? (inPath ? 0.98 : ghostOpacity) : idleOpacity;
      const c = focusNode
        ? (inPath ? (blastMode ? blastColor : highlightColor) : ghostColor)
        : new THREE.Color(e.isInterIsland ? 0xa4caff : 0x7b9ab6);
      e.diagramLine.material.color.copy(c);
    }
    if (e.diagramArrow) {
      const arrowOpacity = Number(e.diagramLine?.material?.opacity || 0.9);
      const arrowColor = e.diagramLine?.material?.color || new THREE.Color(0xd8ebff);
      e.diagramArrow.cone.material.opacity = arrowOpacity;
      e.diagramArrow.cone.material.color.copy(arrowColor);
      e.diagramArrow.visible = arrowOpacity > 0.03;
    }
    
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
function easeInOutCubic(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

// ─────────────────────────────────────────────────────────
// CONTROLS INTERRUPT HANDLER — bound once, lazily, on first tween.
// When the user grabs the camera (mouse-down / touch / wheel start), we:
//  1) Kill any in-flight cinematic camTween IMMEDIATELY (no further onUpdate
//     calls, no FPS-killing forced re-renders during user interaction).
//  2) If we were in Global View, deactivate it and clamp camera.far back to
//     the user's chosen render distance — instant FPS recovery on huge maps.
// ─────────────────────────────────────────────────────────
// Restore OrbitControls to whatever state they were in BEFORE Global View.
// Idempotent; only restores if a snapshot exists.
function _restoreControlsAfterGlobalView() {
  if (!controls || !_preGlobalViewControlsState) return;
  const s = _preGlobalViewControlsState;
  controls.autoRotate      = s.autoRotate;
  controls.autoRotateSpeed = s.autoRotateSpeed;
  controls.maxDistance     = s.maxDistance;
  controls.minDistance     = s.minDistance;
  controls.enableDamping   = s.enableDamping;
  controls.dampingFactor   = s.dampingFactor;
  controls.zoomSpeed       = s.zoomSpeed;
  controls.enablePan       = s.enablePan;
  _preGlobalViewControlsState = null;
}

let _controlsInterruptBound = false;
function _bindControlsInterruptHandler() {
  if (_controlsInterruptBound || !controls || typeof controls.addEventListener !== 'function') return;
  _controlsInterruptBound = true;
  controls.addEventListener('start', () => {
    // 1. Kill camera tween immediately.
    if (camTween) {
      camTween = null;
      cinematicFlightActive = false;
      isSystemAnimating = false;
      _suspendSectorCulling = false;
      // Restore DRS (was disabled by the cinematic flight).
      if (DRS) DRS.enabled = cinematicPrevDRSEnabled;
    }
    // 2. Exit Global View — keep infinite render distance + restore controls.
    if (isGlobalViewActive && !_globalViewJustActivated) {
      isGlobalViewActive = false;
      if (islandJumpPanel) islandJumpPanel.style.display = 'none';
      if (camera) {
        camera.far = ALWAYS_RENDER_DISTANCE;
        camera.updateProjectionMatrix();
      }
      if (DRS) {
        DRS.baseCameraFar = ALWAYS_RENDER_DISTANCE;
        DRS.baseRenderDistance = ALWAYS_RENDER_DISTANCE;
      }
      MAX_RENDER_DISTANCE = ALWAYS_RENDER_DISTANCE;
      _cullDirty = true;
      // CRITICAL: put OrbitControls back to the user's normal navigation feel
      // (autoRotate off, original min/maxDistance, original zoom/damping).
      _restoreControlsAfterGlobalView();
      console.log('[CityEngine] Global View interrupted — controls + far plane restored');
    } else if (controls && controls.autoRotate) {
      // Edge case: tween already finished but the user never interacted yet.
      // Still kill the auto-rotation on first user input.
      controls.autoRotate = false;
    }
  });
}

export function tweenCamera(to, toTarget, dur=1200, options = null) {
  _bindControlsInterruptHandler();
  const cfg = options || {};
  camTween = {
    sp: camera.position.clone(), st: controls.target.clone(),
    ep: new THREE.Vector3(to.x, to.y, to.z),
    et: new THREE.Vector3(toTarget.x, toTarget.y, toTarget.z),
    start: performance.now(), dur,
    easing: typeof cfg.easing === 'function' ? cfg.easing : easeInOutCubic,
    onUpdate: typeof cfg.onUpdate === 'function' ? cfg.onUpdate : null,
    onComplete: typeof cfg.onComplete === 'function' ? cfg.onComplete : null,
  };
}

export function fitCameraToAll(durationMs = 1500) {
  if (!camera || !controls) return;

  const keys = Object.keys(islandGroups);
  if (!keys.length) return;

  for (let i = 0; i < keys.length; i++) {
    const g = islandGroups[keys[i]];
    if (g) g.visible = true;
  }

  const worldBox = new THREE.Box3().setFromObject(scene);
  if (worldBox.isEmpty()) {
    console.warn('[CityEngine] fitCameraToAll: Box3(scene) vacío, usando fallback con islandMeta.');
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = 0;
    let maxY = 0;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    let found = 0;

    for (let i = 0; i < keys.length; i++) {
      const meta = islandMeta[keys[i]];
      if (!meta || !meta.center) continue;
      const cx = Number(meta.center.x) || 0;
      const cz = Number(meta.center.z) || 0;
      const r = Math.max(120, Number(meta.radius) || 0);
      minX = Math.min(minX, cx - r);
      maxX = Math.max(maxX, cx + r);
      minZ = Math.min(minZ, cz - r);
      maxZ = Math.max(maxZ, cz + r);
      maxY = Math.max(maxY, 420);
      found++;
    }

    if (!found) {
      console.warn('[CityEngine] fitCameraToAll: fallback sin datos en islandMeta; abortando encuadre global.');
      return;
    }
    worldBox.min.set(minX, minY, minZ);
    worldBox.max.set(maxX, maxY, maxZ);
  }

  const center = worldBox.getCenter(new THREE.Vector3());
  const size = worldBox.getSize(new THREE.Vector3());

  // Compute focusCenter from REAL island centroids (not Box3, which is polluted
  // by the 2000x2000 invisible floor plane). Falls back to scene center.
  let _ix = 0, _iz = 0, _in = 0;
  const _ikeys = Object.keys(islandMeta);
  for (let i = 0; i < _ikeys.length; i++) {
    const m = islandMeta[_ikeys[i]];
    if (!m || !m.center) continue;
    _ix += m.center.x; _iz += m.center.z; _in++;
  }
  const focusCenter = _in > 0
    ? new THREE.Vector3(_ix / _in, 0, _iz / _in)
    : new THREE.Vector3(center.x, 0, center.z);
  const spanX = Math.max(220, size.x);
  const spanZ = Math.max(220, size.z);
  const footprintRadius = Math.sqrt((spanX * 0.5) * (spanX * 0.5) + (spanZ * 0.5) * (spanZ * 0.5));

  if (DRS.step > 0) {
    DRS.step = 0;
    DRS.belowSinceMs = 0;
    DRS.deltaFilled = 0;
    DRS.deltaIdx = 0;
    DRS.lastStepAt = performance.now();

    if (DRS.baseRenderDistance > 0) {
      MAX_RENDER_DISTANCE = Math.max(MAX_RENDER_DISTANCE, DRS.baseRenderDistance);
    }
    if (DRS.baseCameraFar > 0 && camera.far < DRS.baseCameraFar) {
      camera.far = DRS.baseCameraFar;
      camera.updateProjectionMatrix();
    }
    if (renderer?.setPixelRatio && DRS.basePixelRatio > 0) {
      renderer.setPixelRatio(DRS.basePixelRatio);
    }
  }

  const fov = THREE.MathUtils.degToRad(Math.max(10, Number(camera.fov) || 55));
  const tanHalfFov = Math.tan(fov * 0.5);
  const sinHalfFov = Math.sin(fov * 0.5);
  const aspect = Math.max(0.2, Number(camera.aspect) || (window.innerWidth / Math.max(1, window.innerHeight)));
  const halfW = Math.max(1, size.x * 0.5);
  const halfH = Math.max(1, size.z * 0.5);
  const fitByHeight = halfH / Math.max(1e-4, tanHalfFov);
  const fitByWidth = halfW / Math.max(1e-4, tanHalfFov * aspect);
  const fitBySphere = footprintRadius / Math.max(0.15, sinHalfFov);
  const fitDistance = Math.max(fitByHeight, fitByWidth, fitBySphere, 420) * GLOBAL_VIEW_FIT_MULTIPLIER;
  const worldDiag = size.length();

  const requiredFar = Math.max(Number(camera.far) || 0, fitDistance + (worldDiag * 1.8) + 800);
  if ((Number(camera.far) || 0) < requiredFar) {
    camera.far = requiredFar;
    camera.updateProjectionMatrix();
  }

  const requiredRenderDistance = Math.max(
    MAX_RENDER_DISTANCE,
    (Math.sqrt((size.x * size.x) + (size.z * size.z)) * 0.75) + 900
  );
  if (MAX_RENDER_DISTANCE < requiredRenderDistance) {
    MAX_RENDER_DISTANCE = requiredRenderDistance;
  }

  const dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1e-6) dir.set(0.14, 0.58, 1.0);
  dir.y = Math.max(0.62, Math.abs(dir.y));
  dir.normalize();

  // ─────────────────────────────────────────────────────────
  // AUTHORITATIVE ORBIT RADIUS — computed from REAL island geometry.
  // The orbit MUST be outside the ring formed by the islands, so we ignore
  // fitDistance (polluted by the 2000x2000 floor plane) for the horizontal
  // placement and use the true reach from focusCenter to the farthest island
  // edge. Multiplier 2.2 keeps a comfortable margin.
  // ─────────────────────────────────────────────────────────
  let islandRingRadius = 0;
  const _metaKeys = Object.keys(islandMeta);
  for (let i = 0; i < _metaKeys.length; i++) {
    const m = islandMeta[_metaKeys[i]];
    if (!m || !m.center) continue;
    const ddx = m.center.x - focusCenter.x;
    const ddz = m.center.z - focusCenter.z;
    const reach = Math.hypot(ddx, ddz) + (m.radius || 800);
    if (reach > islandRingRadius) islandRingRadius = reach;
  }
  // Also fold in real mesh extents in case islandMeta.radius understates them.
  for (let i = 0; i < meshes.length; i++) {
    const ud = meshes[i].userData;
    const node = ud && ud.node;
    if (!node) continue;
    const ddx = node.x - focusCenter.x;
    const ddz = node.z - focusCenter.z;
    const reach = Math.hypot(ddx, ddz) + 60; // building half-width pad
    if (reach > islandRingRadius) islandRingRadius = reach;
  }
  if (islandRingRadius < 200) islandRingRadius = Math.max(footprintRadius, 600);

  const ORBIT_MULTIPLIER = 1.3;             // closer wrap (was 2.2 → too far)
  const ORBIT_R = islandRingRadius * ORBIT_MULTIPLIER;
  const ORBIT_ALT = ORBIT_R * 0.5;          // less zenithal altitude
  console.log('[GlobalView] islandRingRadius=', islandRingRadius.toFixed(0),
              ' orbit=', ORBIT_R.toFixed(0), ' alt=', ORBIT_ALT.toFixed(0),
              ' islands=', _metaKeys.length);

  // CRITICAL #1: OrbitControls.maxDistance clamps the camera back inside the
  // ring when too low. Bump it dynamically. BEFORE bumping, snapshot the
  // user's original control settings so we can restore them on interrupt or
  // completion (otherwise the user keeps the huge maxDistance and the fast
  // autoRotate forever after Global View ends).
  if (controls && !_preGlobalViewControlsState) {
    _preGlobalViewControlsState = {
      autoRotate:      !!controls.autoRotate,
      autoRotateSpeed: Number(controls.autoRotateSpeed) || 0.25,
      maxDistance:     Number(controls.maxDistance) || 1400,
      minDistance:     Number(controls.minDistance) || 40,
      enableDamping:   !!controls.enableDamping,
      dampingFactor:   Number(controls.dampingFactor) || 0.05,
      zoomSpeed:       Number(controls.zoomSpeed) || 1.2,
      enablePan:       !!controls.enablePan,
    };
  }
  if (controls) {
    controls.maxDistance = Math.max(controls.maxDistance || 0, ORBIT_R * 4);
  }

  // CRITICAL #2: prevent the "blackout after 10s" caused by DRS reverting
  // camera.far / MAX_RENDER_DISTANCE to their boot-time baselines (which are
  // smaller than the new orbit distance, clipping the entire scene).
  // Diagonal from camera to far island = sqrt(ORBIT_R^2 + ORBIT_ALT^2 + ringR^2).
  const farRequired = Math.sqrt(ORBIT_R * ORBIT_R + ORBIT_ALT * ORBIT_ALT) + islandRingRadius * 2 + 1000;
  const newFar = Math.max(camera.far || 0, ORBIT_R * 5, farRequired);
  camera.far = newFar;
  camera.updateProjectionMatrix();
  // Persist the bumped baselines so DRS's "reset to baseline" path doesn't
  // shrink them back and black out the scene.
  if (DRS) {
    DRS.baseCameraFar = Math.max(DRS.baseCameraFar || 0, newFar);
    DRS.baseRenderDistance = Math.max(DRS.baseRenderDistance || 0, newFar);
  }
  MAX_RENDER_DISTANCE = Math.max(MAX_RENDER_DISTANCE, newFar);

  // Build dest: keep original elevation direction, but force horizontal
  // distance to ORBIT_R and altitude to ORBIT_ALT relative to focusCenter.
  const horizDir = new THREE.Vector2(dir.x, dir.z);
  if (horizDir.lengthSq() < 1e-6) horizDir.set(1, 0);
  horizDir.normalize();
  const dest = new THREE.Vector3(
    focusCenter.x + horizDir.x * ORBIT_R,
    Math.max(ORBIT_ALT, GLOBAL_VIEW_ALTITUDE_OFFSET + 120),
    focusCenter.z + horizDir.y * ORBIT_R
  );

  const startPos = camera.position.clone();
  const flightVec = dest.clone().sub(startPos);
  const flightDir = flightVec.clone();
  if (flightDir.lengthSq() < 1e-6) flightDir.set(0, 0, 1);
  flightDir.normalize();
  const flightSide = new THREE.Vector3(-flightDir.z, 0, flightDir.x).normalize();

  const arcHeight = Math.max(64, fitDistance * 0.1);
  const driftAmp = Math.max(10, fitDistance * 0.02);
  const tiltAmp = Math.max(5, fitDistance * 0.012);
  const overshootAmp = Math.max(8, fitDistance * 0.011);

  if (!cinematicFlightActive) {
    cinematicPrevDRSEnabled = DRS.enabled;
  }
  cinematicFlightActive = true;
  isGlobalViewActive = true; // user can still interrupt; controls 'start' will reset far
  syncIslandJumpMenuVisibility();
  isSystemAnimating = true;
  DRS.enabled = false;
  _suspendSectorCulling = true;
  _forceFullRenderUntilMs = performance.now() + 8000;
  for (let i = 0; i < keys.length; i++) {
    const group = islandGroups[keys[i]];
    if (group) group.visible = true;
  }

  const bloomBase = bloomPass ? Number(bloomPass.strength || 0) : 0;
  const bloomBoost = Math.max(0.18, bloomBase * 0.25);

  tweenCamera(dest, focusCenter, durationMs, {
    easing: easeInOutCubic,
    onUpdate: (progress) => {
      const p = Math.max(0, Math.min(1, progress));
      const arcLift = Math.sin(Math.PI * p) * arcHeight;
      const drift = Math.sin(Math.PI * p) * driftAmp;
      const tilt = Math.sin(Math.PI * p) * tiltAmp;

      camera.position.y += arcLift;
      camera.position.addScaledVector(flightSide, drift * 0.18);
      controls.target.y += tilt;

      if (p > 0.82) {
        const t = (p - 0.82) / 0.18;
        const damp = Math.exp(-4.5 * t);
        const osc = Math.sin(t * 10.5);
        const k = osc * damp * overshootAmp;
        camera.position.addScaledVector(flightDir, k);
        controls.target.addScaledVector(flightDir, k * 0.24);
      }

      if (bloomPass) {
        const pulse = Math.sin(Math.PI * p);
        bloomPass.strength = bloomBase + (bloomBoost * pulse);
      }
      
      // Force render during animation to ensure scene is visible
      controls.update();
      if (composer) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
    },
    onComplete: () => {
      if (bloomPass) bloomPass.strength = bloomBase;
      camera.position.copy(dest);
      controls.target.copy(focusCenter);
      controls.update();
      
      // Enable fast auto-rotation in global view
      if (controls) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = 1.35;
        controls.update();
      }
      
      _suspendSectorCulling = false;
      DRS.enabled = cinematicPrevDRSEnabled;
      cinematicFlightActive = false;
      isSystemAnimating = false;
      _lastSystemAnimEndMs = performance.now();
      _cullDirty = true;
      
      // Force high quality render but keep engine awake
      const devicePixelRatio = window.devicePixelRatio || 1;
      if (renderer?.setPixelRatio) {
        renderer.setPixelRatio(devicePixelRatio);
      }
      if (camera) camera.updateProjectionMatrix();
      
      // Render immediately to ensure scene is visible
      if (composer) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
    },
  });
}

export function triggerGlobalView(durationMs = GLOBAL_VIEW_FLIGHT_MS) {
  _globalViewJustActivated = true;
  setTimeout(() => { _globalViewJustActivated = false; }, 2000);
  fitCameraToAll(durationMs);
}

export function isGlobalViewMode() {
  return !!isGlobalViewActive;
}

// ── Force High Quality Frame ─────────────────────────────
// Called after system animations (e.g., Global View) to restore
// maximum quality and render a clean "gold frame" before going idle.
function forceHighQualityFrame() {
  if (!renderer || !camera) return;
  
  // Disable DRS for 30 seconds after global view to prevent degradation
  _drsDisabledUntilMs = performance.now() + 30000;
  
  // Reset pixelRatio to device native for crisp rendering
  const devicePixelRatio = window.devicePixelRatio || 1;
  if (renderer.setPixelRatio) {
    renderer.setPixelRatio(devicePixelRatio);
  }
  
  // Keep camera.far and MAX_RENDER_DISTANCE effectively infinite.
  camera.far = ALWAYS_RENDER_DISTANCE;
  camera.updateProjectionMatrix();
  MAX_RENDER_DISTANCE = ALWAYS_RENDER_DISTANCE;
  
  // Reset DRS to baseline to prevent immediate re-degradation
  DRS.step = 0;
  DRS.belowSinceMs = 0;
  DRS.deltaFilled = 0;
  DRS.deltaIdx = 0;
  DRS.lastStepAt = performance.now();
  
  // Force one high-quality render
  if (composer) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
  
  // CSS2D label render removed (volume labels migrated to Sprite pipeline).
  
  // Put engine to sleep
  needsUpdate = false;
  
  console.log('[CityEngine] forceHighQualityFrame: Quality restored to baseline, DRS disabled for 30s, engine sleeping.');
}

// Fast-travel camera to a node WITHOUT touching selection or blast state.
// Used by the Blast Radius affected-nodes list so the analysis context is preserved.
export function flyToNodeNoSelect(nodeId, durationMs = 1100) {
  if (!nodeId) return;
  const targetNode = nodeMap[nodeId];
  if (!targetNode) return;
  const targetMesh = nodeMeshMap[targetNode.id];
  if (!targetMesh || !controls || !camera) return;
  const ud = targetMesh.userData || {};
  const buildingPos = new THREE.Vector3(ud.node.x, (ud.currentH || 40), ud.node.z);
  const currentDir = camera.position.clone().sub(controls.target);
  if (currentDir.lengthSq() < 1e-4) currentDir.set(0.4, 0.6, 0.7);
  currentDir.normalize();
  const destPos = buildingPos.clone().add(currentDir.multiplyScalar(180));
  destPos.y = Math.max(destPos.y, buildingPos.y + 60);
  tweenCamera(destPos, buildingPos.clone().add(new THREE.Vector3(0, 12, 0)), durationMs);
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
  const ud = targetMesh.userData || {};
  const buildingPos = new THREE.Vector3(ud.node.x, ud.currentH, ud.node.z);

  controls.target.copy(buildingPos);
  if (Visualizer.orthoCamera) {
    Visualizer.orthoCamera.position.set(buildingPos.x, Math.max(1200, Visualizer.orthoCamera.position.y), buildingPos.z);
    Visualizer.orthoCamera.lookAt(buildingPos.x, 0, buildingPos.z);
    Visualizer.orthoCamera.updateProjectionMatrix();
  }
  controls.update();
  return;

  const currentDir = camera.position.clone().sub(controls.target).normalize();
  const destPos = buildingPos.clone().add(currentDir.multiplyScalar(140));
  tweenCamera(destPos, buildingPos.clone().add(new THREE.Vector3(0, 12, 0)), 1100);
}

function flyToIslandCenter(islandKey) {
  const key = islandKey || 'default';
  const meta = islandMeta[key];
  if (!meta || !camera || !controls) return;

  const focus = new THREE.Vector3(meta.center.x, 12, meta.center.z);
  const currentDir = camera.position.clone().sub(controls.target).normalize();
  const radiusOffset = Math.max(220, (meta.radius || 250) * 0.75);
  const dest = focus.clone().add(currentDir.multiplyScalar(radiusOffset));
  dest.y = Math.max(110, camera.position.y);
  tweenCamera(dest, focus, 1900);
}

function getCityCenterXZ() {
  const keys = Object.keys(islandMeta);
  if (!keys.length) return { x: 0, z: 0 };
  let sx = 0;
  let sz = 0;
  let n = 0;
  for (let i = 0; i < keys.length; i++) {
    const m = islandMeta[keys[i]];
    if (!m) continue;
    sx += m.center.x;
    sz += m.center.z;
    n++;
  }
  if (!n) return { x: 0, z: 0 };
  return { x: sx / n, z: sz / n };
}

function getCityFitBoundsXZ() {
  const keys = Object.keys(islandMeta);
  if (!keys.length) return { x: 0, z: 0, radius: 700 };

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < keys.length; i++) {
    const meta = islandMeta[keys[i]];
    if (!meta) continue;
    const r = Math.max(80, Number(meta.radius) || 0);
    const x = Number(meta.center?.x) || 0;
    const z = Number(meta.center?.z) || 0;
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minZ = Math.min(minZ, z - r);
    maxZ = Math.max(maxZ, z + r);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    const center = getCityCenterXZ();
    return { x: center.x, z: center.z, radius: 700 };
  }

  const x = (minX + maxX) * 0.5;
  const z = (minZ + maxZ) * 0.5;
  const halfW = (maxX - minX) * 0.5;
  const halfD = (maxZ - minZ) * 0.5;
  const radius = Math.max(260, Math.sqrt((halfW * halfW) + (halfD * halfD)));
  return { x, z, radius };
}

function applySceneStyleForMode() {
  if (!scene) return;
  if (sceneBackground3D === null && scene.background) {
    sceneBackground3D = scene.background.clone ? scene.background.clone() : scene.background;
  }
  if (sceneBackground3D) {
    scene.background = sceneBackground3D.clone ? sceneBackground3D.clone() : sceneBackground3D;
  }

  scene.traverse((obj) => {
    if (!obj || !obj.isGridHelper || !obj.material) return;
    obj.material.opacity = 0.5;
    obj.material.transparent = true;
    obj.visible = true;
    if (obj.material.color && obj.material.color.setHex) {
      obj.material.color.setHex(0x003366);
    }
  });
}

function applyDiagramVisibilityForMode() {
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    m.visible = true;
  }

  const isLow = State.graphicsMode === 'low';
  for (let i = 0; i < edgeObjs.length; i++) {
    const e = edgeObjs[i];
    if (e.line) e.line.visible = true;
    // Particles: all visible in HIGH, half visible in LOW (matches setGraphicsQuality)
    if (Array.isArray(e.particles)) {
      for (let j = 0; j < e.particles.length; j++) {
        e.particles[j].visible = isLow ? (j % 2 === 0) : true;
      }
    }
  }

  for (let i = 0; i < islandLabels.length; i++) {
    islandLabels[i].visible = true;
  }
}

function ensureViewModeToggle() {
  // 2D mode removed - no longer needed
}

function ensureViewModeHotkey() {
  // 2D mode removed - no longer needed
}

function ensureGlobalViewButton() {
  if (typeof document === 'undefined') return;

  let btn = document.getElementById('btn-global-view');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'btn-global-view';
    btn.type = 'button';
    btn.title = 'Global View (G) — orbit camera around the city';
    btn.setAttribute('aria-label', 'Global View (press G)');
    btn.innerHTML = '<span aria-hidden="true">🌎</span>';
    btn.style.cssText = [
      'position: fixed',
      'top: 18px',
      'right: 18px',
      'z-index: 260',
      'width: 44px',
      'height: 44px',
      'border-radius: 12px',
      'border: 1px solid rgba(0,243,255,0.45)',
      'background: rgba(6,14,24,0.82)',
      'color: #e9f9ff',
      'font-size: 22px',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'cursor: pointer',
      'box-shadow: 0 10px 24px rgba(0,0,0,0.35)',
      'backdrop-filter: blur(6px)',
      '-webkit-backdrop-filter: blur(6px)'
    ].join(';');
    document.body.appendChild(btn);
  }

  btn.title = 'Global View (G) — orbit camera around the city';
  btn.setAttribute('aria-label', 'Global View (press G)');

  globalViewBtn = btn;
  if (!btn.dataset.globalBound) {
    btn.addEventListener('click', () => triggerGlobalView(GLOBAL_VIEW_FLIGHT_MS));

    // Force-bind hotkeys here too so they're available BEFORE the user has
    // ever opened the Global Map modal (initTacticalMap was the previous
    // — and only — caller, which meant M was inert until then).
    bindGlobalHotkeys();

    // Floating hint bubble shown below the button on hover.
    const hint = document.createElement('div');
    hint.id = 'global-view-hint';
    hint.textContent = 'Global View · G';
    hint.style.cssText = [
      'position: fixed',
      'top: 66px',
      'right: 18px',
      'z-index: 261',
      'padding: 6px 12px',
      'border-radius: 999px',
      'background: rgba(6,14,24,0.92)',
      'border: 1px solid rgba(0,243,255,0.55)',
      'color: #00f3ff',
      'font-family: "JetBrains Mono", monospace',
      'font-size: 11px',
      'font-weight: 700',
      'letter-spacing: 0.8px',
      'box-shadow: 0 0 12px rgba(0,243,255,0.35)',
      'pointer-events: none',
      'opacity: 0',
      'transform: translateY(-6px)',
      'transition: opacity 0.18s, transform 0.18s',
      'white-space: nowrap'
    ].join(';');
    document.body.appendChild(hint);
    btn.addEventListener('mouseenter', () => {
      hint.style.opacity = '1';
      hint.style.transform = 'translateY(0)';
    });
    btn.addEventListener('mouseleave', () => {
      hint.style.opacity = '0';
      hint.style.transform = 'translateY(-6px)';
    });

    btn.dataset.globalBound = '1';
  }

  ensureIslandJumpMenu();
}

function refreshIslandJumpMenuOptions() {
  if (!islandJumpSelect) return;

  const keys = Object.keys(islandMeta).filter(k => !!islandMeta[k]);
  keys.sort((a, b) => String(a).localeCompare(String(b)));
  const prev = islandJumpSelect.value;

  islandJumpSelect.innerHTML = '';
  if (!keys.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No islands';
    islandJumpSelect.appendChild(opt);
    islandJumpSelect.disabled = true;
    return;
  }

  islandJumpSelect.disabled = false;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = k;
    islandJumpSelect.appendChild(opt);
  }

  if (prev && keys.includes(prev)) islandJumpSelect.value = prev;
}

function syncIslandJumpMenuVisibility() {
  if (!islandJumpPanel) return;
  islandJumpPanel.style.display = isGlobalViewActive ? 'block' : 'none';
}

function ensureIslandJumpMenu() {
  if (typeof document === 'undefined') return;

  if (!islandJumpPanel) {
    islandJumpPanel = document.getElementById('global-island-jump-panel');
    if (!islandJumpPanel) {
      islandJumpPanel = document.createElement('div');
      islandJumpPanel.id = 'global-island-jump-panel';
      islandJumpPanel.style.cssText = [
        'position: fixed',
        'top: 118px',
        'right: 18px',
        'z-index: 261',
        'width: 240px',
        'padding: 10px',
        'box-sizing: border-box',
        'border-radius: 12px',
        'border: 1px solid rgba(0,243,255,0.45)',
        'background: rgba(6,14,24,0.9)',
        'box-shadow: 0 10px 24px rgba(0,0,0,0.35)',
        'backdrop-filter: blur(6px)',
        '-webkit-backdrop-filter: blur(6px)',
        'display: none'
      ].join(';');

      const title = document.createElement('div');
      title.textContent = 'Islands';
      title.style.cssText = [
        'color: #00f3ff',
        'font-family: "JetBrains Mono", monospace',
        'font-size: 11px',
        'font-weight: 700',
        'letter-spacing: 0.8px',
        'margin-bottom: 8px'
      ].join(';');
      islandJumpPanel.appendChild(title);

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;';

      islandJumpSelect = document.createElement('select');
      islandJumpSelect.id = 'global-island-jump-select';
      islandJumpSelect.style.cssText = [
        'flex: 1',
        'min-width: 0',
        'height: 30px',
        'border-radius: 8px',
        'border: 1px solid rgba(0,243,255,0.35)',
        'background: rgba(8,18,30,0.95)',
        'color: #e9f9ff',
        'font-size: 12px',
        'padding: 0 8px'
      ].join(';');
      row.appendChild(islandJumpSelect);

      const goBtn = document.createElement('button');
      goBtn.type = 'button';
      goBtn.textContent = 'Go';
      goBtn.style.cssText = [
        'height: 30px',
        'padding: 0 10px',
        'flex-shrink: 0',
        'white-space: nowrap',
        'border-radius: 8px',
        'border: 1px solid rgba(0,243,255,0.45)',
        'background: rgba(0,243,255,0.08)',
        'color: #dff7ff',
        'cursor: pointer',
        'font-size: 12px',
        'font-weight: 600'
      ].join(';');
      goBtn.addEventListener('click', () => {
        const key = islandJumpSelect ? islandJumpSelect.value : '';
        if (!key) return;
        flyToIslandCenter(key);
      });
      row.appendChild(goBtn);

      islandJumpPanel.appendChild(row);
      document.body.appendChild(islandJumpPanel);
    }
  }

  if (!islandJumpSelect && islandJumpPanel) {
    islandJumpSelect = islandJumpPanel.querySelector('#global-island-jump-select');
  }

  refreshIslandJumpMenuOptions();
  syncIslandJumpMenuVisibility();
}

function ensureRadarHUD() {
  if (radarCanvas && radarCtx) return;
  if (typeof document === 'undefined') return;

  radarContainer = document.getElementById('city-radar-hud');
  if (!radarContainer) {
    radarContainer = document.createElement('div');
    radarContainer.id = 'city-radar-hud';
    // Circular neon-rimmed minimap. NO title, NO inner grid lines.
    radarContainer.style.cssText = [
      'position: fixed',
      'right: 220px',
      'bottom: 24px',
      'width: 220px',
      'height: 220px',
      'border-radius: 50%',
      'background: radial-gradient(circle at 35% 35%, rgba(17,34,52,0.7), rgba(8,16,26,0.92))',
      'border: 2px solid rgba(0, 243, 255, 0.7)',
      'box-shadow: 0 0 22px rgba(0, 243, 255, 0.45), inset 0 0 30px rgba(255, 0, 255, 0.08)',
      'backdrop-filter: blur(4px)',
      '-webkit-backdrop-filter: blur(4px)',
      'overflow: hidden',
      'z-index: 50',
      'pointer-events: auto',
      'user-select: none',
      'font-family: "Courier New", monospace',
      'color: #dff4ff'
    ].join(';');

    document.body.appendChild(radarContainer);
  }

  radarCanvas = document.getElementById('city-radar-canvas');
  if (!radarCanvas) {
    radarCanvas = document.createElement('canvas');
    radarCanvas.id = 'city-radar-canvas';
    radarCanvas.width = RADAR_SIZE;
    radarCanvas.height = RADAR_SIZE;
    radarCanvas.style.cssText = [
      'width: 100%',
      'height: 100%',
      'display: block',
      'border-radius: 50%',
      'background: transparent',
      'cursor: pointer'
    ].join(';');
    radarContainer.appendChild(radarCanvas);
  }

  // Build the legend (bottom-left, English)
  if (!document.getElementById('city-radar-legend')) {
    const legend = document.createElement('div');
    legend.id = 'city-radar-legend';
    legend.style.cssText = [
      'position: fixed',
      'right: 460px',
      'bottom: 28px',
      'display: flex',
      'flex-direction: column',
      'gap: 6px',
      'font-family: "Courier New", monospace',
      'font-size: 10px',
      'letter-spacing: 1.2px',
      'color: rgba(220,240,255,0.85)',
      'pointer-events: none',
      'z-index: 51',
      'text-shadow: 0 0 6px rgba(0,0,0,0.8)'
    ].join(';');
    const item = (color, label) => `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="width:9px;height:9px;border-radius:50%;background:${color};box-shadow:0 0 8px ${color};"></span>
        <span>${label}</span>
      </div>`;
    legend.innerHTML =
      item('rgba(0, 243, 255, 0.95)', 'Active Islands') +
      item('rgba(255, 68, 48, 0.95)', 'Alert Islands') +
      item('rgba(255, 255, 255, 0.95)', 'Current Position');
    document.body.appendChild(legend);
  }

  radarCtx = radarCanvas.getContext('2d');
  if (!radarCtx) return;

  // Click handler — uses the SAME camera-relative mapping as drawRadar so the
  // dot under the cursor matches the island that gets flown to (no key drift).
  radarCanvas.addEventListener('click', (ev) => {
    const keys = Object.keys(islandMeta);
    if (!keys.length || !radarCanvas || !camera || !controls) return;

    const rect = radarCanvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * RADAR_SIZE;
    const y = ((ev.clientY - rect.top) / rect.height) * RADAR_SIZE;

    const cx = RADAR_SIZE / 2;
    const cy = RADAR_SIZE / 2;
    const ringR = cx - RADAR_PADDING;
    const camX = controls.target.x || camera.position.x;
    const camZ = controls.target.z || camera.position.z;
    const scale = ringR / RADAR_VIEW_RADIUS;

    let targetKey = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const meta = islandMeta[k];
      if (!meta) continue;
      const dxw = meta.center.x - camX;
      const dzw = meta.center.z - camZ;
      const distance = Math.sqrt(dxw * dxw + dzw * dzw);
      if (distance > RADAR_VIEW_RADIUS) continue;
      const px = cx + dxw * scale;
      const py = cy + dzw * scale;
      const dx = x - px;
      const dy = y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        targetKey = k;
      }
    }

    if (targetKey && bestD2 <= RADAR_CLICK_RADIUS * RADAR_CLICK_RADIUS) {
      console.log('[Radar] Click → flying to island:', targetKey);
      flyToIslandCenter(targetKey);
    }
  });
}

function getRadarWorldRadius(keys) {
  let far = 1;
  for (let i = 0; i < keys.length; i++) {
    const meta = islandMeta[keys[i]];
    if (!meta) continue;
    const dist = Math.sqrt(meta.center.x * meta.center.x + meta.center.z * meta.center.z) + (meta.radius || 0);
    if (dist > far) far = dist;
  }
  return Math.max(500, far * 1.12);
}

function radarWorldToCanvas(wx, wz, worldRadius) {
  const usable = (RADAR_SIZE / 2) - RADAR_PADDING;
  const scale = usable / Math.max(1, worldRadius);
  return {
    x: (RADAR_SIZE / 2) + (wx * scale),
    y: (RADAR_SIZE / 2) + (wz * scale),
  };
}

function drawRadar(now) {
  if (!radarCtx || !radarCanvas || !camera || !controls) return;
  const keys = Object.keys(islandCenters);

  radarCtx.clearRect(0, 0, RADAR_SIZE, RADAR_SIZE);

  const cx = RADAR_SIZE / 2;
  const cy = RADAR_SIZE / 2;
  const ringR = cx - RADAR_PADDING;

  // No grid lines, no concentric circles — just clean dark transparency.
  if (!keys.length) return;

  // Get camera position as radar center
  const camX = controls.target.x || camera.position.x;
  const camZ = controls.target.z || camera.position.z;

  // Draw only nearby islands within radar view radius
  const blink = (Math.sin(now * 0.012) + 1) * 0.5;
  
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const center = islandCenters[key];
    if (!center) continue;

    // Calculate distance from camera to island
    const dx = center.x - camX;
    const dz = center.z - camZ;
    const distance = Math.sqrt(dx * dx + dz * dz);

    // Only draw if within radar view radius
    if (distance > RADAR_VIEW_RADIUS) continue;

    // Map relative position to radar canvas
    const usable = ringR;
    const scale = usable / RADAR_VIEW_RADIUS;
    const p = {
      x: cx + (dx * scale),
      y: cy + (dz * scale)
    };

    const isBurning = !!islandFireState[key];
    const group = islandGroups[key];
    const visible = !group || group.visible !== false;

    // Vibrant neon dots: red for burning, cyan for active, dim grey for hidden
    const dotColor = isBurning
      ? `rgba(255, 68, 48, ${0.65 + blink * 0.35})`
      : (visible ? 'rgba(0, 243, 255, 0.95)' : 'rgba(105, 130, 150, 0.4)');
    radarCtx.save();
    radarCtx.shadowColor = dotColor;
    radarCtx.shadowBlur = isBurning ? 14 : 10;
    radarCtx.fillStyle = dotColor;
    radarCtx.beginPath();
    radarCtx.arc(p.x, p.y, isBurning ? 5.4 : 4.2, 0, Math.PI * 2);
    radarCtx.fill();
    radarCtx.restore();

    if (visible && distance < RADAR_VIEW_RADIUS * 0.7) {
      radarCtx.fillStyle = 'rgba(220, 240, 255, 0.85)';
      radarCtx.font = '10px "Courier New", monospace';
      radarCtx.textAlign = 'center';
      radarCtx.fillText(key.toUpperCase(), p.x, p.y - 9);
    }
  }

  // Camera position (white core with neon halo)
  radarCtx.save();
  radarCtx.shadowColor = 'rgba(255, 0, 255, 0.9)';
  radarCtx.shadowBlur = 12;
  radarCtx.fillStyle = 'rgba(255, 255, 255, 0.98)';
  radarCtx.beginPath();
  radarCtx.arc(cx, cy, 3.6, 0, Math.PI * 2);
  radarCtx.fill();
  radarCtx.restore();
  
  // Draw camera direction
  const camDir = _tmpVec3b;
  camera.getWorldDirection(camDir);
  camDir.y = 0;
  if (camDir.lengthSq() < 1e-6) camDir.set(0, 0, -1);
  camDir.normalize();

  const angle = Math.atan2(camDir.z, camDir.x);
  const coneLen = 26;
  const spread = 0.34;

  radarCtx.fillStyle = 'rgba(255,245,170,0.18)';
  radarCtx.beginPath();
  radarCtx.moveTo(cx, cy);
  radarCtx.lineTo(cx + Math.cos(angle - spread) * coneLen, cy + Math.sin(angle - spread) * coneLen);
  radarCtx.lineTo(cx + Math.cos(angle + spread) * coneLen, cy + Math.sin(angle + spread) * coneLen);
  radarCtx.closePath();
  radarCtx.fill();
}

// ── Rebuild City ───────────────────────────────────────
export function updateSyncMetrics() {
  maxRadius = 0;
  meshes.forEach(m => { const d = m.userData.voxel ? m.userData.voxel.userData.dist : 0; if (d > maxRadius) maxRadius = d; });
  syncComplete = false;
}

// ─────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for graphics quality.
//
// HARD RULE — DO NOT VIOLATE:
//   • NEVER swap, replace or rebuild node materials based on this slider.
//   • NEVER mutate `.color`, `.emissive`, or `.emissiveIntensity` here.
//   • The buildings keep their original MeshStandardMaterial in BOTH modes,
//     so they look IDENTICAL — just with cheaper post-processing in LOW.
//
// This function only touches the rendering PIPELINE:
//   1) Renderer shadowMap + pixelRatio
//   2) Bloom post-processing pass
//   3) Particle visibility/speed (visibility flag, not materials)
//   4) Persist + sync UI
// ─────────────────────────────────────────────────────────
export function setGraphicsQuality(level) {
  const isHigh = (level === 1 || level === '1');
  const isLow = !isHigh;
  console.log('[CityEngine] setGraphicsQuality:', isHigh ? 'HIGH' : 'LOW');

  // 1. Renderer pipeline only — no material touching.
  if (renderer) {
    renderer.shadowMap.enabled = isHigh;
    renderer.setPixelRatio(isHigh ? Math.min(window.devicePixelRatio || 1, 2) : 1);
  }
  if (camera) {
    camera.far = ALWAYS_RENDER_DISTANCE;
    camera.updateProjectionMatrix();
  }
  MAX_RENDER_DISTANCE = ALWAYS_RENDER_DISTANCE;

  // 2. Post-processing: bloom on in HIGH, off in LOW.
  if (bloomPass) bloomPass.enabled = isHigh;

  // 3. Cheap shadow flags on existing meshes (does NOT alter their materials).
  meshes.forEach(mesh => {
    mesh.castShadow = isHigh;
    mesh.receiveShadow = isHigh;
  });

  // 4. Edges: particles half-count + 3× speed in LOW. Visibility/speed only,
  //    no material/color changes.
  const SPEED_MULT_LOW = 3.0;
  edgeObjs.forEach(e => {
    if (Array.isArray(e.arrows)) e.arrows.forEach(arrow => { arrow.visible = false; });
    if (Array.isArray(e.particles)) {
      e.particles.forEach((p, idx) => {
        const ud = p.userData;
        if (isLow) {
          p.visible = (idx % 2 === 0);
          if (ud.baseSpeed) ud.speed = ud.baseSpeed * SPEED_MULT_LOW;
        } else {
          p.visible = true;
          if (ud.baseSpeed) ud.speed = ud.baseSpeed;
        }
      });
    }
  });

  // 5. Persist (single source of truth) + sync legacy State key.
  try { localStorage.setItem('dagcity_graphics', isHigh ? '1' : '0'); } catch (_) {}
  State.graphicsMode = isHigh ? 'high' : 'low';

  // 6. Sync slider DOM idempotently.
  const slider = document.getElementById('graphics-slider');
  if (slider) slider.value = isHigh ? '1' : '0';

  if (renderer) {
    const pr = (typeof renderer.getPixelRatio === 'function') ? renderer.getPixelRatio() : 'n/a';
    console.log('[GraphicsBoot] applied mode=', isHigh ? 'high' : 'low',
      ' pixelRatio=', pr,
      ' shadowMap=', !!renderer.shadowMap?.enabled,
      ' bloom=', !!bloomPass?.enabled);
  }

  needsUpdate = true;
}

// ── Apply Settings to 3D Engine ───────────────────────────
// Legacy bridge: routes all graphics changes through setGraphicsQuality.
window.applySettingsToEngine = function(settings) {
  console.log('[CityEngine] applySettingsToEngine called with:', settings);

  if (settings.graphicsMode !== undefined) {
    setGraphicsQuality(settings.graphicsMode === 'low' ? 0 : 1);
  }

  // showLabels: toggle CSS2D visibility (in low mode, hide by default)
  if (settings.showLabels !== undefined) {
    const isLow = State.graphicsMode === 'low';
    const shouldShow = settings.showLabels && !isLow;
    meshes.forEach(mesh => {
      if (mesh.userData.label) mesh.userData.label.visible = shouldShow;
      if (mesh.userData.timeLabel) mesh.userData.timeLabel.visible = shouldShow;
    });
  }

  // showParticles: toggle particle systems (always off in low mode)
  if (settings.showParticles !== undefined) {
    const isLow = State.graphicsMode === 'low';
    const shouldShow = settings.showParticles && !isLow;
    edgeObjs.forEach(edge => {
      if (Array.isArray(edge.particles)) {
        edge.particles.forEach(p => p.visible = shouldShow);
      }
    });
  }

  // neonIntensity: update material emissive (only in high mode)
  if (settings.neonIntensity !== undefined) {
    if (State.graphicsMode === 'high') {
      meshes.forEach(mesh => {
        if (mesh.userData.baseEmis) {
          const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
          if (mat.emissive) {
            mat.emissiveIntensity = settings.neonIntensity;
            mat.needsUpdate = true;
          }
        }
      });
    }
  }

  needsUpdate = true;
};

export function rebuildCity(graphData, isLiveSync = false) {
  const nodes = Array.isArray(graphData?.nodes) ? graphData.nodes : [];
  const links = Array.isArray(graphData?.links) ? graphData.links : [];

  // Any node whose time_source is NOT 'real' or 'marketing' must have
  // execution_time = 0. This kills stale/cached values from older builds
  // (e.g. IndexedDB projects parsed when synthetic times were still injected)
  // so the UI cannot display a number next to a "Time: N/A" badge.
  // ─────────────────────────────────────────────────────────
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const src = n.time_source;
    if (src !== 'real' && src !== 'marketing') {
      n.execution_time = 0;
      if (!src) n.time_source = 'none';
    }
  }

  // Notify UI so the LIVE SYNC / OFFLINE indicator follows the active project.
  // Sources: 'live_sync', 'local_sync' → live; anything else → offline.
  try {
    const src = graphData.metadata?.source
      || (isLiveSync ? 'live_sync' : 'offline');
    window.dispatchEvent(new CustomEvent('dagcity:sync-source', { detail: { source: src } }));

    // Also broadcast whether this project actually has real execution_time data
    // so the UI can disable the "Execution Time" metric option when not.
    const hasRealTimes = !!(graphData.metadata?.has_real_times)
      || nodes.some(n => Number(n.execution_time) > 0 && n.time_source === 'real');
    window.dispatchEvent(new CustomEvent('dagcity:metrics-availability', {
      detail: { hasRealTimes }
    }));
  } catch (_) {}

  // Extract project name from metadata for settings persistence
  const projectName = graphData.metadata?.project_name || graphData.metadata?.name || 'default';
  if (State.setProjectName) {
    State.setProjectName(projectName);
    // setProjectName reloaded project-specific settings (perfMode, graphicsMode,
    // showLabels, etc.) but the HUD controls still show boot-time values. Re-sync.
    const perfCheck = document.getElementById('check-perf-mode');
    if (perfCheck) perfCheck.checked = !!State.perfMode;
    // CRITICAL: read directly from `dagcity_graphics` (single source of truth).
    // Previously this read from State.graphicsMode, but State is per-project and
    // gets reset to its default 'high' on every project load — overriding the
    // user's actual choice and causing the slider to "snap back" to High after
    // a reload. localStorage 'dagcity_graphics' is global and authoritative.
    let savedGraphics = '1';
    try { savedGraphics = localStorage.getItem('dagcity_graphics') || '1'; } catch (_) {}
    const graphicsSlider = document.getElementById('graphics-slider');
    if (graphicsSlider) graphicsSlider.value = savedGraphics;
    setGraphicsQuality(savedGraphics);
  }

  // Debug: Log island groups from parsed data
  const uniqueGroups = [...new Set(nodes.map(n => n.group || 'default'))];
  console.log('[CityEngine] Island groups from parsed data:', uniqueGroups);
  console.log('[CityEngine] Sample node groups:', nodes.slice(0, 5).map(n => ({ name: n.name, group: n.group, resource_type: n.resource_type })));

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
          const s = makeTimeSprite(formatTimeLabel(n), n.is_bottleneck);
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
    const diagramSprite = m.userData?.diagramSprite;
    if (diagramSprite) {
      if (diagramSprite.parent) diagramSprite.parent.remove(diagramSprite);
      if (diagramSprite.material?.map) diagramSprite.material.map.dispose();
      if (diagramSprite.material) diagramSprite.material.dispose();
    }
    if (m.parent) m.parent.remove(m);
    if (m.geometry) m.geometry.dispose();
    if (Array.isArray(m.material)) m.material.forEach(mt => mt.dispose());
    else if (m.material) m.material.dispose();
  });
  meshes.length = 0;
  diagramNodeTargets.length = 0;
  voxels.forEach(v => { if (v.parent) v.parent.remove(v); if (v.geometry) v.geometry.dispose(); if (v.material) v.material.dispose(); });
  voxels.length = 0;
  Object.keys(nodeMeshMap).forEach(k => delete nodeMeshMap[k]);
  edgeObjs.forEach(e => {
    if (e.line.parent) e.line.parent.remove(e.line);
    if (e.line.geometry) e.line.geometry.dispose();
    e.particles.forEach(p => { if (p.parent) p.parent.remove(p); if (p.geometry) p.geometry.dispose(); });
    if (e.arrows && Array.isArray(e.arrows)) {
      e.arrows.forEach(arrow => {
        if (arrow.parent) arrow.parent.remove(arrow);
        if (arrow.line?.geometry) arrow.line.geometry.dispose();
        if (arrow.line?.material) arrow.line.material.dispose();
        if (arrow.cone?.geometry) arrow.cone.geometry.dispose();
        if (arrow.cone?.material) arrow.cone.material.dispose();
      });
    }
    if (e.diagramLine) {
      if (e.diagramLine.parent) e.diagramLine.parent.remove(e.diagramLine);
      if (e.diagramLine.geometry) e.diagramLine.geometry.dispose();
      if (e.diagramLine.material) e.diagramLine.material.dispose();
    }
    if (e.diagramArrow) {
      if (e.diagramArrow.parent) e.diagramArrow.parent.remove(e.diagramArrow);
      if (e.diagramArrow.line?.geometry) e.diagramArrow.line.geometry.dispose();
      if (e.diagramArrow.line?.material) e.diagramArrow.line.material.dispose();
      if (e.diagramArrow.cone?.geometry) e.diagramArrow.cone.geometry.dispose();
      if (e.diagramArrow.cone?.material) e.diagramArrow.cone.material.dispose();
    }
  });
  edgeObjs.length = 0;
  Object.keys(nodeMap).forEach(k => delete nodeMap[k]);
  
  islandLabels.forEach(l => {
    if (l.parent) l.parent.remove(l);
    if (l.material && l.material.map) l.material.map.dispose();
    if (l.material) l.material.dispose();
  });
  islandLabels.length = 0;

  // Per-island tactical rings
  Object.keys(islandMeta).forEach(k => {
    const meta = islandMeta[k];
    if (!meta || !meta.tacticalRing) return;
    if (meta.tacticalRing.parent) meta.tacticalRing.parent.remove(meta.tacticalRing);
    if (meta.tacticalRing.geometry) meta.tacticalRing.geometry.dispose();
    if (meta.tacticalRing.material?.map) meta.tacticalRing.material.map.dispose();
    if (meta.tacticalRing.material) meta.tacticalRing.material.dispose();
    if (meta._ringFadeRaf) {
      cancelAnimationFrame(meta._ringFadeRaf);
      meta._ringFadeRaf = null;
    }
    if (meta._ringLabelTimer) {
      clearTimeout(meta._ringLabelTimer);
      meta._ringLabelTimer = null;
    }
    meta.tacticalRing = null;
  });
  
  // Dispose empty island groups (will be recreated on demand)
  Object.keys(islandGroups).forEach(k => {
    const g = islandGroups[k];
    if (g && g.parent) g.parent.remove(g);
    delete islandGroups[k];
    delete islandMeta[k];
  });
  if (globalArcsGroup) {
    // Keep globalArcsGroup but ensure it's empty (children removed above via edgeObjs)
    while (globalArcsGroup.children.length) globalArcsGroup.remove(globalArcsGroup.children[0]);
    // Ensure visibility is restored after any previous selection/cull state
    globalArcsGroup.visible = true;
  }
  _cullDirty = true;
  
  // Preserve selection if possible
  const prevSelectedId = selectedNode ? selectedNode.id : null;
  selectedNode = null; critSet = new Set();

  maxTime = nodes.length ? Math.max(...nodes.map(n => n.execution_time || 0)) : 0;
  minTime = nodes.length ? Math.min(...nodes.map(n => n.execution_time || 0)) : 0;
  hasReal = graphData.metadata?.has_real_times || false;

  // ── Smart Clustering Consolidation ───────────────────────
  // Count nodes per group
  const groupCounts = {};
  nodes.forEach(n => {
    const group = n.group || 'default';
    groupCounts[group] = (groupCounts[group] || 0) + 1;
  });

  console.log('[CityEngine] Group counts before consolidation:', Object.entries(groupCounts).map(([g, c]) => `${g}: ${c}`));

  // Reassign nodes from small groups (< 3 nodes) to CORE_UTILITIES
  let reassignedCount = 0;
  nodes.forEach(n => {
    const group = n.group || 'default';
    if (groupCounts[group] < 3) {
      n.group = 'CORE_UTILITIES';
      reassignedCount++;
    }
  });

  console.log('[CityEngine] Consolidated', reassignedCount, 'nodes to CORE_UTILITIES');

  // ── Slotting System for Uniform Angular Distribution ───────
  // Get unique projects after consolidation
  const projects = [...new Set(nodes.map(n => n.group || 'default'))];
  const N = projects.length;

  // Calculate connection weight (inDegree + outDegree) for each island
  const islandConnections = {};
  projects.forEach(p => {
    islandConnections[p] = { inDegree: 0, outDegree: 0, total: 0 };
  });

  links.forEach(link => {
    const sourceGroup = nodes.find(n => n.id === link.source)?.group || 'default';
    const targetGroup = nodes.find(n => n.id === link.target)?.group || 'default';
    if (islandConnections[sourceGroup]) {
      islandConnections[sourceGroup].outDegree++;
      islandConnections[sourceGroup].total++;
    }
    if (islandConnections[targetGroup]) {
      islandConnections[targetGroup].inDegree++;
      islandConnections[targetGroup].total++;
    }
  });

  console.log('[CityEngine] Island connections:', Object.entries(islandConnections).map(([g, c]) => `${g}: ${c.total}`));

  // Identify poles
  const sourcesIsland = projects.find(p => p.toUpperCase() === 'SOURCES') || projects.find(p => p.toUpperCase() === 'SEEDS');
  const martsIsland = projects.find(p => p.toUpperCase().includes('MART') || p.toUpperCase() === 'AD_REPORTING');

  console.log('[CityEngine] Poles - Sources:', sourcesIsland, 'Marts:', martsIsland);

  // Identify Group A (neighbors of SOURCES) and Group B (neighbors of MARTS)
  const groupA = []; // Neighbors of SOURCES
  const groupB = []; // Neighbors of MARTS
  const groupC = []; // Others

  projects.forEach(p => {
    if (p === sourcesIsland || p === martsIsland) return;

    const hasSourceConnection = links.some(link => {
      const sourceGroup = nodes.find(n => n.id === link.source)?.group || 'default';
      const targetGroup = nodes.find(n => n.id === link.target)?.group || 'default';
      const result = (sourceGroup === p && targetGroup === sourcesIsland) ||
                    (targetGroup === p && sourceGroup === sourcesIsland);
      if (result) {
        console.log(`[DEBUG] Link between ${p} and SOURCES: ${sourceGroup} -> ${targetGroup}`);
      }
      return result;
    });

    const hasMartConnection = links.some(link => {
      const sourceGroup = nodes.find(n => n.id === link.source)?.group || 'default';
      const targetGroup = nodes.find(n => n.id === link.target)?.group || 'default';
      const result = (sourceGroup === p && targetGroup === martsIsland) ||
                    (targetGroup === p && sourceGroup === martsIsland);
      if (result) {
        console.log(`[DEBUG] Link between ${p} and MARTS: ${sourceGroup} -> ${targetGroup}`);
      }
      return result;
    });

    if (hasSourceConnection) {
      groupA.push({ island: p, connections: islandConnections[p].total });
    } else if (hasMartConnection) {
      groupB.push({ island: p, connections: islandConnections[p].total });
    } else {
      groupC.push(p);
    }
  });

  // Sort Group A and Group B by descending connections
  groupA.sort((a, b) => b.connections - a.connections);
  groupB.sort((a, b) => b.connections - a.connections);

  console.log('[CityEngine] Group A (neighbors of SOURCES):', groupA.map(n => `${n.island} (${n.connections})`));
  console.log('[CityEngine] Group B (neighbors of MARTS):', groupB.map(n => `${n.island} (${n.connections})`));
  console.log('[CityEngine] Group C (others):', groupC);

  // Prepare ringSlots array
  const ringSlots = new Array(N).fill(null);

  // Assign SOURCES to slot[0]
  if (sourcesIsland) {
    ringSlots[0] = sourcesIsland;
    console.log('[CityEngine] SOURCES assigned to slot[0]');
  }

  // Distribute Group A alternately around slot[0]
  let leftIndex = 1;
  let rightIndex = N - 1;
  groupA.forEach((neighbor, i) => {
    if (i % 2 === 0) {
      // Even index: assign to right side
      ringSlots[rightIndex] = neighbor.island;
      console.log(`[CityEngine] ${neighbor.island} assigned to slot[${rightIndex}]`);
      rightIndex--;
    } else {
      // Odd index: assign to left side
      ringSlots[leftIndex] = neighbor.island;
      console.log(`[CityEngine] ${neighbor.island} assigned to slot[${leftIndex}]`);
      leftIndex++;
    }
  });

  // Assign MARTS to slot[martIndex]
  const martIndex = Math.floor(N / 2);
  if (martsIsland) {
    ringSlots[martIndex] = martsIsland;
    console.log(`[CityEngine] MARTS assigned to slot[${martIndex}]`);
  }

  // Distribute Group B alternately around martIndex
  let martLeftIndex = martIndex - 1;
  let martRightIndex = martIndex + 1;
  groupB.forEach((neighbor, i) => {
    if (i % 2 === 0) {
      // Even index: assign to left side of mart
      while (martLeftIndex >= 0 && ringSlots[martLeftIndex] !== null) {
        martLeftIndex--;
      }
      if (martLeftIndex >= 0) {
        ringSlots[martLeftIndex] = neighbor.island;
        console.log(`[CityEngine] ${neighbor.island} assigned to slot[${martLeftIndex}]`);
        martLeftIndex--;
      }
    } else {
      // Odd index: assign to right side of mart
      while (martRightIndex < N && ringSlots[martRightIndex] !== null) {
        martRightIndex++;
      }
      if (martRightIndex < N) {
        ringSlots[martRightIndex] = neighbor.island;
        console.log(`[CityEngine] ${neighbor.island} assigned to slot[${martRightIndex}]`);
        martRightIndex++;
      }
    }
  });

  // Fill remaining slots with Group C
  let groupCIndex = 0;
  for (let i = 0; i < N; i++) {
    if (ringSlots[i] === null && groupCIndex < groupC.length) {
      ringSlots[i] = groupC[groupCIndex];
      console.log(`[CityEngine] ${groupC[groupCIndex]} assigned to slot[${i}]`);
      groupCIndex++;
    }
  }

  console.log('[CityEngine] Final ringSlots:', ringSlots);

  // Calculate angles: i * (2 * Math.PI / N)
  const projectCenters = {};
  const radius = projects.length > 1 ? Math.max(600, projects.length * 300) : 0;
  const uniformAngleStep = (Math.PI * 2) / N;

  console.log('[CityEngine] Uniform angle step:', uniformAngleStep.toFixed(3), 'rad', `(${(uniformAngleStep * 180 / Math.PI).toFixed(1)}°)`);

  ringSlots.forEach((island, i) => {
    if (island) {
      const angle = i * uniformAngleStep;
      
      projectCenters[island] = {
        dx: Math.cos(angle) * radius,
        dz: Math.sin(angle) * radius
      };
      
      console.log(`[CityEngine] ${island} at slot[${i}] angle ${angle.toFixed(3)} rad (${(angle * 180 / Math.PI).toFixed(1)}°)`);
    }
  });
  
  console.log('[CityEngine] Final project centers:', Object.keys(projectCenters));
  
  const orderedProjects = Object.keys(projectCenters); // For label rendering
  
  // Render island labels
  orderedProjects.forEach((p, i) => {
    const labelSprite = makeSprite(`ISLAND: ${p.toUpperCase()}`, '#ffdf00');
    labelSprite.name = 'islandLabel';
    labelSprite.userData.islandKey = p;
    labelSprite.userData.islandOrder = i;
    if (labelSprite.material) {
      labelSprite.material.transparent = true;
      labelSprite.material.depthWrite = false;
      labelSprite.material.depthTest = true;
    }
    labelSprite.renderOrder = 1000;
    labelSprite.scale.set(labelSprite.scale.x * 6, labelSprite.scale.y * 6, 1);
    labelSprite.userData.baseScaleX = labelSprite.scale.x;
    labelSprite.userData.baseScaleY = labelSprite.scale.y;
    labelSprite.position.set(projectCenters[p].dx, 600, projectCenters[p].dz);
    _islandParent(p).add(labelSprite);
    islandLabels.push(labelSprite);
    
    // Register island metadata for culling. Bounding sphere radius is generous
    // (we'll refine after positioning nodes, but this is a safe default).
    islandMeta[p || 'default'] = {
      center: new THREE.Vector3(projectCenters[p].dx, 0, projectCenters[p].dz),
      radius: 800
    };

    // Per-island tactical disk with integrated island name (independent LOD toggle)
    const ringRadius = Math.max(360, islandMeta[p || 'default'].radius * 0.75);
    const ringGeo = new THREE.CircleGeometry(ringRadius, 96);
    const islandUpperName = String(p || 'ISLAND').toUpperCase();
    const islandNode = nodes.find(n => (n.group || 'default') === p);
    const islandColor = (islandNode && islandNode.color) ? islandNode.color : 0x00f3ff;
    const ringTex = _createIslandTacticalTexture(islandUpperName, islandColor);
    const ringMat = new THREE.MeshBasicMaterial({
      map: ringTex,
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.name = 'tacticalRing';
    ring.userData.islandKey = p;
    ring.rotation.x = -Math.PI * 0.5;
    ring.position.set(projectCenters[p].dx, TACTICAL_RING_Y, projectCenters[p].dz);
    ring.visible = false;
    ring.material.opacity = 0;
    ring.userData.maxOpacity = 0.9;
    ring.renderOrder = -1000;
    scene.add(ring);
    islandMeta[p || 'default'].tacticalRing = ring;
  });

  // ── Sequential Grid-Wrap Layout ───────────────────────
  // All numeric values come from LAYOUT_CONFIG (top of file). Edit there.
  const { nodeSpacingX, nodeSpacingZ, maxPerRow, groupSpacing } = LAYOUT_CONFIG;
  const LAYER_ORDER = ['source', 'staging', 'intermediate', 'mart', 'consumption', 'default'];

  projects.forEach(p => {
    const center = projectCenters[p];

    // Bucket this project's nodes by layer
    const byLayer = {};
    nodes.forEach(n => {
      if ((n.group || 'default') !== p) return;
      const l = n.layer || 'default';
      (byLayer[l] = byLayer[l] || []).push(n);
    });

    // Order layers by canonical flow (source → mart → ...)
    const layerKeys = Object.keys(byLayer).sort((a, b) => {
      const ia = LAYER_ORDER.indexOf(a); const ib = LAYER_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    // Place each layer block sequentially in X, gap-protected
    let cursorX = center.dx;
    layerKeys.forEach(l => {
      const arr = byLayer[l];
      const count = arr.length;
      const cols = Math.min(count, maxPerRow);
      const rows = Math.ceil(count / maxPerRow);
      arr.forEach((n, i) => {
        const col = i % maxPerRow;
        const row = Math.floor(i / maxPerRow);
        n.x = cursorX + row * nodeSpacingX;
        n.z = (col - (cols - 1) / 2) * nodeSpacingZ + center.dz;
        n._baseLayoutX = n.x;
        n._baseLayoutZ = n.z;
        n.y = 0;
        nodeMap[n.id] = n;
      });
      const blockWidthX = Math.max(0, rows - 1) * nodeSpacingX;
      cursorX += blockWidthX + groupSpacing;
    });
  });

  computeDiagramLayout(nodes);

  // Refine each island's bounding sphere radius from actual node positions.
  Object.keys(islandMeta).forEach(k => {
    const meta = islandMeta[k];
    let maxDistSq = 0;
    nodes.forEach(n => {
      if ((n.group || 'default') !== k) return;
      const dx = n.x - meta.center.x;
      const dz = n.z - meta.center.z;
      const d2 = dx*dx + dz*dz;
      if (d2 > maxDistSq) maxDistSq = d2;
    });
    // +200 padding for building height/extent and safety
    meta.radius = Math.max(400, Math.sqrt(maxDistSq) + 200);
  });

  // Calculate island centers for navigation system
  calculateIslandCenters();
  ensureIslandJumpMenu();

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

  // Initialize / refresh LOD after every rebuild.
  updateLOD();

  // Auto-enter global view on initial project load (not live sync)
  if (!isLiveSync) {
    setTimeout(() => {
      console.log('[CityEngine] Auto-triggering global view after project load');
      triggerGlobalView();
    }, 500);
  }
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
  const moveSpeed = 12.5 * (State.flySpeed || 1.0);
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
  const side = new THREE.Vector3().crossVectors(dir, camera.up).normalize();
  if (keys['KeyW'] || keys['ArrowUp'])    { camera.position.addScaledVector(dir,  moveSpeed); controls.target.addScaledVector(dir,  moveSpeed); }
  if (keys['KeyS'] || keys['ArrowDown'])  { camera.position.addScaledVector(dir, -moveSpeed); controls.target.addScaledVector(dir, -moveSpeed); }
  if (keys['KeyA'] || keys['ArrowLeft'])  { camera.position.addScaledVector(side,-moveSpeed); controls.target.addScaledVector(side,-moveSpeed); }
  if (keys['KeyD'] || keys['ArrowRight']) { camera.position.addScaledVector(side, moveSpeed); controls.target.addScaledVector(side, moveSpeed); }
}

// ── Island Visibility (Sector Culling) ─────────────────
// Hides whole island groups that are far away or fully outside the camera frustum.
// Three.js then skips traversing & frustum-checking each child individually.
function updateIslandVisibility() {
  if (!camera) return;
  _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_projScreenMatrix);

  const camPos = camera.position;
  const keys = Object.keys(islandGroups);
  for (let i = 0, len = keys.length; i < len; i++) {
    const k = keys[i];
    const group = islandGroups[k];
    const meta = islandMeta[k];
    if (!group || !meta) continue;

    const dx = camPos.x - meta.center.x;
    const dz = camPos.z - meta.center.z;
    const distSq = dx*dx + dz*dz;
    const farLimit = MAX_RENDER_DISTANCE + meta.radius;

    let visible = true;
    if (distSq > farLimit * farLimit) {
      visible = false;
    } else {
      _islandSphere.center.copy(meta.center);
      _islandSphere.radius = meta.radius;
      visible = _frustum.intersectsSphere(_islandSphere);
    }
    if (group.visible !== visible) group.visible = visible;
  }
}

// ── Dynamic Resolution Scaling tick ────────────────────
// Records inter-frame delta, computes a 60-frame moving average, and
// triggers a downgrade step when avg FPS stays below threshold for sustainedMs.
function tickDRS(now) {
  if (!DRS.enabled || !camera || !renderer) return;

  // Capture baselines once (after Visualizer has set up camera/renderer)
  if (DRS.baseCameraFar === 0) {
    DRS.baseCameraFar = camera.far;
    DRS.basePixelRatio = renderer.getPixelRatio ? renderer.getPixelRatio() : (window.devicePixelRatio || 1);
    DRS.baseRenderDistance = MAX_RENDER_DISTANCE;
  }

  if (DRS.lastFrameTime === 0) { DRS.lastFrameTime = now; return; }
  const delta = now - DRS.lastFrameTime;
  DRS.lastFrameTime = now;

  // Push into ring buffer
  DRS.deltas[DRS.deltaIdx] = delta;
  DRS.deltaIdx = (DRS.deltaIdx + 1) % DRS.deltas.length;
  if (DRS.deltaFilled < DRS.deltas.length) DRS.deltaFilled++;

  // Need a full window before deciding (avoids triggering on warm-up jank)
  if (DRS.deltaFilled < DRS.deltas.length) return;

  // Moving average FPS over last 60 frames
  let sum = 0;
  for (let i = 0; i < DRS.deltas.length; i++) sum += DRS.deltas[i];
  const avgDelta = sum / DRS.deltas.length;
  const avgFps = 1000 / avgDelta;

  // Track sustained low FPS
  if (avgFps < DRS.fpsThreshold) {
    if (DRS.belowSinceMs === 0) DRS.belowSinceMs = now;
  } else {
    DRS.belowSinceMs = 0;
  }

  if (DRS.step >= DRS.maxSteps) return;                              // safety floor reached
  if (DRS.belowSinceMs === 0) return;                                // not currently below
  if (now - DRS.belowSinceMs < DRS.sustainedMs) return;              // not sustained long enough
  if (now - DRS.lastStepAt < DRS.cooldownMs) return;                 // still in cooldown

  // ── Apply next degradation step ──
  DRS.step++;
  DRS.lastStepAt = now;
  DRS.belowSinceMs = 0;
  // Reset window so we judge the new step fairly
  DRS.deltaFilled = 0;
  DRS.deltaIdx = 0;

  const distMul = DRS.renderDistanceByStep[Math.min(DRS.step, DRS.renderDistanceByStep.length - 1)];
  const prMul   = DRS.pixelRatioByStep[Math.min(DRS.step, DRS.pixelRatioByStep.length - 1)];

  // Keep render distance at maximum - only degrade pixelRatio for performance
  const newRenderDist = DRS.baseRenderDistance; // No distance reduction
  const newCameraFar = Math.max(MIN_GLOBAL_DISTANCE, DRS.baseCameraFar); // Always use global minimum
  
  MAX_RENDER_DISTANCE = newRenderDist;
  camera.far = newCameraFar;
  camera.updateProjectionMatrix();
  if (renderer.setPixelRatio) renderer.setPixelRatio(DRS.basePixelRatio * prMul);
  _cullDirty = true;

  console.warn(
    `DRS Activado (step ${DRS.step}/${DRS.maxSteps}): Reduciendo calidad visual para salvar FPS ` +
    `[avgFPS=${avgFps.toFixed(1)}, renderDist=${MAX_RENDER_DISTANCE.toFixed(0)}, pixelRatio=${(DRS.basePixelRatio * prMul).toFixed(2)}]`
  );
}

// ── Animation Loop control ─────────────────────────────
let _animationFrameId = null;
let _loopRunning = false;

export function pauseAnimationLoop() {
  if (_animationFrameId !== null) {
    cancelAnimationFrame(_animationFrameId);
    _animationFrameId = null;
  }
  _loopRunning = false;
}

// ── Dispose: clean up scene, controls listeners, arrays ─
export function disposeCity({ resetCamera = true } = {}) {
  console.log('[CityEngine] disposeCity called');
  pauseAnimationLoop();

  // Dispose meshes
  [...meshes].forEach(m => {
    const diagramSprite = m.userData?.diagramSprite;
    if (diagramSprite) {
      if (diagramSprite.parent) diagramSprite.parent.remove(diagramSprite);
      if (diagramSprite.material?.map) diagramSprite.material.map.dispose();
      if (diagramSprite.material) diagramSprite.material.dispose();
    }
    if (m.parent) m.parent.remove(m);
    if (m.geometry) m.geometry.dispose();
    if (Array.isArray(m.material)) m.material.forEach(mt => mt && mt.dispose());
    else if (m.material) m.material.dispose();
  });
  meshes.length = 0;
  diagramNodeTargets.length = 0;

  // Dispose voxels
  voxels.forEach(v => {
    if (v.parent) v.parent.remove(v);
    if (v.geometry) v.geometry.dispose();
    if (v.material) v.material.dispose();
  });
  voxels.length = 0;

  // Dispose edges + arrows + diagram lines
  edgeObjs.forEach(e => {
    if (e.line) {
      if (e.line.parent) e.line.parent.remove(e.line);
      if (e.line.geometry) e.line.geometry.dispose();
      if (e.line.material) e.line.material.dispose();
    }
    if (Array.isArray(e.particles)) {
      e.particles.forEach(p => {
        if (p.parent) p.parent.remove(p);
        if (p.geometry) p.geometry.dispose();
        if (p.material) p.material.dispose();
      });
    }
    if (Array.isArray(e.arrows)) {
      e.arrows.forEach(arrow => {
        if (arrow.parent) arrow.parent.remove(arrow);
        if (arrow.line?.geometry) arrow.line.geometry.dispose();
        if (arrow.line?.material) arrow.line.material.dispose();
        if (arrow.cone?.geometry) arrow.cone.geometry.dispose();
        if (arrow.cone?.material) arrow.cone.material.dispose();
      });
    }
    if (e.diagramLine) {
      if (e.diagramLine.parent) e.diagramLine.parent.remove(e.diagramLine);
      if (e.diagramLine.geometry) e.diagramLine.geometry.dispose();
      if (e.diagramLine.material) e.diagramLine.material.dispose();
    }
    if (e.diagramArrow) {
      if (e.diagramArrow.parent) e.diagramArrow.parent.remove(e.diagramArrow);
      if (e.diagramArrow.line?.geometry) e.diagramArrow.line.geometry.dispose();
      if (e.diagramArrow.line?.material) e.diagramArrow.line.material.dispose();
      if (e.diagramArrow.cone?.geometry) e.diagramArrow.cone.geometry.dispose();
      if (e.diagramArrow.cone?.material) e.diagramArrow.cone.material.dispose();
    }
  });
  edgeObjs.length = 0;

  // Island labels
  islandLabels.forEach(l => {
    if (l.parent) l.parent.remove(l);
    if (l.material?.map) l.material.map.dispose();
    if (l.material) l.material.dispose();
  });
  islandLabels.length = 0;

  // Island groups
  Object.keys(islandGroups).forEach(k => {
    const g = islandGroups[k];
    if (g && g.parent) g.parent.remove(g);
    delete islandGroups[k];
    delete islandMeta[k];
    delete islandCenters[k];
  });

  // Clear LOD saved references
  Object.keys(islandMeta).forEach(k => {
    const meta = islandMeta[k];
    if (!meta) return;
    meta._lodSavedParent = null;
    meta._lodSavedLabel = null;
    meta._lodFar = false;
    if (meta.tacticalRing) {
      if (meta.tacticalRing.parent) meta.tacticalRing.parent.remove(meta.tacticalRing);
      if (meta.tacticalRing.geometry) meta.tacticalRing.geometry.dispose();
      if (meta.tacticalRing.material?.map) meta.tacticalRing.material.map.dispose();
      if (meta.tacticalRing.material) meta.tacticalRing.material.dispose();
      meta.tacticalRing = null;
    }
    if (meta._ringFadeRaf) {
      cancelAnimationFrame(meta._ringFadeRaf);
      meta._ringFadeRaf = null;
    }
    if (meta._ringLabelTimer) {
      clearTimeout(meta._ringLabelTimer);
      meta._ringLabelTimer = null;
    }
  });

  // Global arcs group
  if (globalArcsGroup) {
    while (globalArcsGroup.children.length) {
      const c = globalArcsGroup.children[0];
      globalArcsGroup.remove(c);
    }
  }

  // Reset internal data maps
  Object.keys(nodeMap).forEach(k => delete nodeMap[k]);
  Object.keys(nodeMeshMap).forEach(k => delete nodeMeshMap[k]);
  selectedNode = null;
  critSet = new Set();

  // Reset camera/controls to default to avoid landing in dark void
  if (resetCamera && camera && controls) {
    camera.position.set(INIT_CAM.x, INIT_CAM.y, INIT_CAM.z);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  console.log('[CityEngine] disposeCity complete');
}

// ── Animation Loop ─────────────────────────────────────
export function startAnimationLoop() {
  if (_loopRunning) {
    console.log('[CityEngine] startAnimationLoop: already running, skipping');
    return;
  }
  _loopRunning = true;
  ensureRadarHUD();
  ensureViewModeToggle();
  ensureGlobalViewButton();
  ensureViewModeHotkey();
  ensureTacticalMapButton();

  // Add imposter group to scene for LOD billboard system
  if (!scene.getObjectByName('imposters')) {
    scene.add(imposterGroup);
  }

  // Initialize schematic overlay for 2D mode
  initSchematicOverlay();

  _drsWarmupUntilMs = performance.now() + 3000;

  // Force culling recompute when the user moves the camera
  if (controls && !controls.__cullHook) {
    controls.addEventListener('change', () => {
      _cullDirty = true;
      needsUpdate = true;
      _lastControlChangeTime = performance.now();
    });
    controls.__cullHook = true;
  }

  // Bind LOD update to controls change with debounce
  if (controls && !controls.__lodHook) {
    controls.addEventListener('change', () => {
      _scheduleLODUpdate();
    });
    controls.__lodHook = true;
  }

  window.addEventListener('resize', () => {
    needsUpdate = true;
  });

  // Sidebar/panel open/close events
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    const observer = new MutationObserver(() => { needsUpdate = true; });
    observer.observe(sidebar, { attributes: true, attributeFilter: ['class'] });
  }

  // HARD BOOT ENFORCEMENT: before the first RAF, force the exact graphics
  // pipeline through the same toggle path used by the UI (no constructor trust).
  setGraphicsQuality(State.graphicsMode === 'low' ? '0' : '1');

  let _bootRenderLogged = false;

  function animate() {
    // Handle tactical map render pending (deferred rendering after DOM paint)
  if (tacticalMapRenderPending && tacticalMapVisible) {
    renderTacticalMap();
    tacticalMapRenderPending = false;
  }

  _animationFrameId = requestAnimationFrame(animate);

    const dt  = clock.getDelta();
    const t   = clock.getElapsedTime();
    const now = performance.now();
    const fullRenderOverride = now < _forceFullRenderUntilMs;

    // FPS calculation
    _frameCountSinceLastUpdate++;
    if (now - _lastTime >= _fpsUpdateInterval) {
      const fps = Math.round((_frameCountSinceLastUpdate * 1000) / (now - _lastTime));
      const fpsEl = document.getElementById('fps-counter');
      if (fpsEl) fpsEl.textContent = fps;
      _lastTime = now;
      _frameCountSinceLastUpdate = 0;
    }

    // Dynamic Resolution Scaling: degrades quality if avg FPS stays low.
    // Skip during warm-up period, when user is idle, when engine is not rendering,
    // when system animation is in progress (camera priority mode), or when DRS is explicitly disabled
    const isWarmup = now < _drsWarmupUntilMs;
    const idleTime = now - _lastControlChangeTime;
    const isIdle = idleTime > 2000;
    const timeSinceSystemAnim = now - _lastSystemAnimEndMs;
    const systemAnimCooldown = timeSinceSystemAnim < 10000; // Extended to 10s for global view protection
    const drsExplicitlyDisabled = now < _drsDisabledUntilMs;
    
    // Detect transition from idle to active
    const wasIdle = _wasIdleLastFrame;
    _wasIdleLastFrame = isIdle;
    const justBecameActive = wasIdle && !isIdle && needsUpdate;
    
    // Reset DRS buffer when user starts moving after idle to clear stale data
    if (justBecameActive) {
      DRS.step = 0;
      DRS.belowSinceMs = 0;
      DRS.deltaFilled = 0;
      DRS.deltaIdx = 0;
      DRS.lastStepAt = now;
    }
    
    // STRICT DRS BLOCKING: Only run when user is ACTIVELY interacting (not idle)
    // DRS only activates when user is actively moving camera (last change < 2s ago)
    const isUserActivelyInteracting = idleTime < 2000;
    
    // Only run DRS when actively rendering, not in warmup, not blocked by system animation,
    // and user is actively interacting (not idle)
    const drsShouldRun = needsUpdate && !isSystemAnimating && !systemAnimCooldown && !drsExplicitlyDisabled && isUserActivelyInteracting;
    
    if (!fullRenderOverride && !isWarmup && drsShouldRun) {
      tickDRS(now);
    }

    // Throttled island culling: every N frames OR whenever marked dirty
    _cullFrameCounter++;
    if (!fullRenderOverride && !_suspendSectorCulling && (_cullDirty || _cullFrameCounter >= CULL_INTERVAL_FRAMES)) {
      updateIslandVisibility();
      _cullFrameCounter = 0;
      _cullDirty = false;
    } else if (fullRenderOverride) {
      const islandKeys = Object.keys(islandGroups);
      for (let i = 0; i < islandKeys.length; i++) {
        const g = islandGroups[islandKeys[i]];
        if (g) g.visible = true;
      }
    }

    if (camTween) {
      const prog = Math.min(1, (now - camTween.start) / camTween.dur);
      const ease = camTween.easing ? camTween.easing(prog) : easeInOutCubic(prog);
      camera.position.lerpVectors(camTween.sp, camTween.ep, ease);
      controls.target.lerpVectors(camTween.st, camTween.et, ease);
      if (camTween.onUpdate) camTween.onUpdate(prog, ease);
      if (prog >= 1) {
        const done = camTween;
        camTween = null;
        if (done.onComplete) done.onComplete();
      }
    }

    if (controls.autoRotate && !camTween) {
      const distToTarget = camera.position.distanceTo(controls.target);
      if (distToTarget < 1200) {
        camera.position.y = 110 + Math.sin(t * 0.15) * 45;
      }
    }

    updateDroneMovement();
    applyDynamicSwellLayout();

    const globalElapsed = now - buildStart;
    const isMimicry = globalElapsed > 1000;

    meshes.forEach(m => {
      // Sector culling: skip all per-mesh work for islands the camera can't see.
      // This is where the major CPU saving comes from when zoomed/panned away.
      if (m.parent && m.parent.visible === false) return;

      const ud = m.userData;
      const n = ud.node;

      m.visible = true;

      const isGhost = n.is_dead_end;
      const isBottleneck = n.is_bottleneck;

      // Cache per-frame swell calculations (used 2-3 times below)
      const dynamicScale = getSwellScaleForNode(n, ud);
      const swellSeverity = getSwellSeverity(n, ud);

      // OPTIMIZATION: Mesh visibility LOD based on camera distance
      const distToMesh = camera.position.distanceTo(m.position);
      const isSelected = (State.selectedNode && State.selectedNode.id === n.id);
      const inFocus = (!State.selectedNode || critSet.has(n.id));
      
      // Hide meshes that are very far from camera to reduce draw calls
      // Exception: selected nodes, nodes in critical set, and nearby nodes
      const meshLODThreshold = 4000; // Don't render meshes beyond this distance
      const shouldRenderMesh = distToMesh < meshLODThreshold || isSelected || inFocus;
      
      if (!shouldRenderMesh) {
        m.visible = false;
        if (ud.label) ud.label.visible = false;
        if (ud.timeLabel) ud.timeLabel.visible = false;
        // Skip expensive updates for hidden mesh
        return;
      }
      
      // OPTIMIZATION: Simplified rendering for distant nodes (medium LOD)
      // Reduce material updates for nodes beyond medium distance
      const isMediumLOD = distToMesh > LOD_MEDIUM_DISTANCE;
      if (isMediumLOD && !isSelected) {
        // Skip emissive updates for distant nodes to reduce GPU load
        if (m.material && Array.isArray(m.material)) {
          m.material.forEach(mat => {
            mat.emissiveIntensity = 0.05; // Minimal emissive
            if (mat.emissive && mat.emissive.setHex) {
              mat.emissive.setHex(0x000000);
            }
          });
        }
      }

      // Height tween
      const baseTargetH = State.perfMode ? ud.perfH : ud.baseH;
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
        
        // OPTIMIZATION: Only render labels when camera is close enough
        const labelsEnabled = !!State.showLabels;
        const ghostVisible = !labelsEnabled && !!ud.isHovered;
        const isSelected = (State.selectedNode && State.selectedNode.id === n.id);
        const inFocus = (!State.selectedNode || critSet.has(n.id));
        
        // LOD-based label rendering: only show when within reasonable distance
        const labelLODThreshold = 1200; // Don't render labels beyond this distance
        const shouldRenderLabel = labelsEnabled && inFocus && (distToLabel < labelLODThreshold || isSelected || ghostVisible);
        
        let targetOpacity = 0;

        if (shouldRenderLabel) {
          if (sY > 0.1 && m.visible) {
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
            if (isGhost) { 
              const flash = (Math.sin(t*10)+1)/2; 
              if (mat.emissive) mat.emissive.set(0xff0000); 
              mat.emissiveIntensity = 0.3 + flash*0.5; 
            }
            else if (isBottleneck) { 
              const heat = 0.5+Math.sin(t*4)*0.45; 
              if (mat.emissive) mat.emissive.set(0xff3300); 
              mat.emissiveIntensity = heat*1.5; 
            }
            else { 
              if (mat.emissive) mat.emissive.set(0x00f3ff); 
              mat.emissiveIntensity = 0.2; 
            }
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
            _tmpColor.set(targetEmissiveColor);
            if (mat.emissive && mat.emissive.lerp) {
              mat.emissive.lerp(_tmpColor, 0.1);
            }
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
        
        // OPTIMIZATION: Only show time labels when close or for bottlenecks
        const timeLabelLODThreshold = 1000; // Stricter threshold for time labels
        const shouldShow = labelsEnabled
          ? (State.perfMode && (isBottleneck || dist < timeLabelLODThreshold || isSelected))
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
            targetOpacity = ghostVisible ? 1.0 : Math.min(1.0, (600 - dist) / 150);
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

      // ── UNIFIED VOLUME LABEL (Sprite, mirrors timeLabel pipeline) ───────
      // Same GPU-only path used by the name & time labels. No CSS2D, no DOM
      // mutation in the render loop. Distance culling + frustum culling
      // (via m.visible) + ease-in opacity, identical to timeLabel above.
      const volumeLabel = ud.volumeLabel;
      if (volumeLabel) {
        // HARD GATE: volume labels only ever show when Data Volume mode is ON.
        // No exceptions — selection, hover, etc. cannot bypass this.
        if (!State.dataVolumeMode) {
          if (volumeLabel.material.opacity !== 0) volumeLabel.material.opacity = 0;
          if (volumeLabel.visible) volumeLabel.visible = false;
          // skip all per-frame work for this label
          // (continue to next per-mesh logic outside this block)
        } else {
        const dist = camera.position.distanceTo(m.position);
        const isSelected = (State.selectedNode && State.selectedNode.id === n.id);
        const inFocus = (!State.selectedNode || critSet.has(n.id));
        const labelsEnabled = !!State.showLabels;
        const ghostVisible = !labelsEnabled && !!ud.isHovered;

        // OPTIMIZATION: same threshold as timeLabel (1000) → identical FPS profile.
        const volumeLabelLODThreshold = 1000;
        const shouldShow = labelsEnabled
          ? (m.visible && sY > 0.1 && (dist < volumeLabelLODThreshold || isSelected))
          : (ghostVisible && m.visible && sY > 0.1);

        if (shouldShow && inFocus) {
          const safeSX = Math.max(0.001, m.scale.x || 1);
          const safeSY = Math.max(0.001, sY);
          // Stack above the time label when both modes are active.
          const yOff = (State.perfMode ? 50 : 28);
          volumeLabel.position.y = ud.baseH + (yOff / safeSY);
          volumeLabel.position.x = 0;
          const baseW = 36, baseHt = 14.4;
          volumeLabel.scale.set(baseW / safeSX, baseHt / safeSY, 1);

          // Ease-in opacity (identical math to timeLabel, threshold 600/150).
          const targetOpacity = ghostVisible
            ? 1.0
            : Math.min(1.0, (600 - dist) / 150);
          const currentOpacity = Number(volumeLabel.material.opacity) || 0;
          volumeLabel.material.opacity = currentOpacity + (targetOpacity - currentOpacity) * 0.2;
          volumeLabel.visible = volumeLabel.material.opacity > 0.03;

          // Repaint texture only if text or severity changed (cached compare).
          if (volumeLabel.visible) {
            const isLowGfx = State.graphicsMode === 'low';
            refreshVolumeSprite(
              volumeLabel,
              formatSwellLabel(n, ud),
              swellSeverity.level,
              isLowGfx
            );
          }
        } else {
          const currentOpacity = Number(volumeLabel.material.opacity) || 0;
          volumeLabel.material.opacity = currentOpacity * 0.8;
          volumeLabel.visible = volumeLabel.material.opacity > 0.03;
        }
        } // end else (dataVolumeMode ON)
      }

      // ── Critical Volume Pulse Effect ─────────────────────
      const pulseSeverity = swellSeverity.level;
      if (ud.pulseLight && State.dataVolumeMode && pulseSeverity === 'high') {
        ud.pulseLight.visible = true;
        // Pulso de luz tenue: intensidad oscila entre 0.5 y 2.0
        const pulseIntensity = 1.25 + Math.sin(t * 3) * 0.75;
        ud.pulseLight.intensity = pulseIntensity;
      } else if (ud.pulseLight) {
        ud.pulseLight.visible = false;
      }

      if (vfxManager) {
        _vfxBucket[0] = m;
        vfxManager.update(_vfxBucket, t, dt, critSet);
      }
    });

    edgeObjs.forEach(e => {
      // Skip particle updates when the edge's parent group is hidden (intra-island).
      // Inter-island arcs live in globalArcsGroup which is always visible.
      if (e.parent && e.parent.visible === false) return;

      if (e.line) e.line.visible = true;
      // NOTE: do NOT force arrow/particle visibility here. setGraphicsQuality
      // owns it (HIGH=particles on/arrows off, LOW=particles off/arrows on).
      if (e.diagramLine) e.diagramLine.visible = false;
      if (e.diagramArrow) e.diagramArrow.visible = false;

      const parts = e.particles;
      for (let i = 0, len = parts.length; i < len; i++) {
        const p = parts[i];
        if (!State.selectedNode && p.scale.x > 1.01) {
          p.scale.setScalar(1.0);
        }
        const ud = p.userData;
        ud.t = (ud.t + ud.speed) % 1;
        ud.curve.getPoint(ud.t, _tmpVec3);
        p.position.copy(_tmpVec3);
      }
    });

    if (_layoutEdgeRefreshPending) {
      _edgeRefreshFrameTick = (_edgeRefreshFrameTick + 1) % 2;
      if (_edgeRefreshFrameTick === 0) {
        refreshEdgeGeometryFromNodes();
        _layoutEdgeRefreshPending = false;
      }
    }

    controls.update();
    
    // Update grid unfolding/folding animation only when not interacting
    // to prevent blocking camera controls
    if (!schematicIsDragging) {
      updateGridTween(now);
    }
    
    // Always render - no idle-based rendering pause
    const shouldRender = true;
    
    if (shouldRender) {
      // CSS2D label renderer call removed: volume labels now use the same
      // GPU sprite pipeline as time/name labels. No per-frame DOM traversal.
      
      const isLowGraphics = State.graphicsMode === 'low';
      if (isLowGraphics) {
        if (!_bootRenderLogged) {
          _bootRenderLogged = true;
          console.log('[GraphicsBoot] first-frame render path=renderer (LOW)');
        }
        renderer.render(scene, camera);
      } else if (composer) {
        if (!_bootRenderLogged) {
          _bootRenderLogged = true;
          console.log('[GraphicsBoot] first-frame render path=composer (HIGH)');
        }
        composer.render();
      } else {
        if (!_bootRenderLogged) {
          _bootRenderLogged = true;
          console.log('[GraphicsBoot] first-frame render path=renderer-fallback (HIGH without composer)');
        }
        renderer.render(scene, camera);
      }
    }

    drawRadar(now);
  }
  animate();
}

export function getRaycastTargets() {
  // RAYCASTER GUARD CLAUSE: When islands are in FAR state (detached from scene graph),
  // the raycaster should NOT iterate over their meshes to avoid CPU overhead.
  // Only return meshes from islands that are NEAR (detailed mode).
  const targets = [];
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    const ud = m.userData;
    if (!ud || !ud.node) continue;
    const group = ud.node.group || 'default';
    const meta = islandMeta[group];
    // Skip meshes from islands that are FAR (detached from scene graph)
    if (meta && meta._lodFar) continue;
    targets.push(m);
  }

  // Also include visible tactical rings so users can click them to fly to islands.
  const islandKeys = Object.keys(islandMeta);
  for (let i = 0; i < islandKeys.length; i++) {
    const meta = islandMeta[islandKeys[i]];
    const ring = meta && meta.tacticalRing;
    if (!ring || !ring.visible) continue;
    targets.push(ring);
  }

  return targets;
}

// ═══════════════════════════════════════════════════════════
// SCENE DETACHMENT LOD (Monolith System)
// ───────────────────────────────────────────────────────────
// Physically detaches island groups from scene graph when FAR,
// reducing draw calls and CPU overhead to ZERO.
// ═══════════════════════════════════════════════════════════

function _setIslandLodState(key, lodFar) {
  const meta = islandMeta[key];
  if (!meta || meta._lodFar === lodFar) return;
  meta._lodFar = lodFar;
  const group = islandGroups[key];
  if (!group) return;

  const _fadeRingTo = (targetOpacity, durationMs, onDone) => {
    const ring = meta.tacticalRing;
    if (!ring || !ring.material) {
      if (onDone) onDone();
      return;
    }
    if (meta._ringFadeRaf) {
      cancelAnimationFrame(meta._ringFadeRaf);
      meta._ringFadeRaf = null;
    }
    const from = Number(ring.material.opacity) || 0;
    const to = Number(targetOpacity) || 0;
    const start = performance.now();
    const dur = Math.max(1, Number(durationMs) || 1);

    const step = (now) => {
      // Stop stale tween if state changed again.
      if (!!meta._lodFar !== !!lodFar) {
        meta._ringFadeRaf = null;
        return;
      }
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      ring.material.opacity = from + (to - from) * eased;
      ring.material.needsUpdate = true;
      if (t < 1) {
        meta._ringFadeRaf = requestAnimationFrame(step);
      } else {
        meta._ringFadeRaf = null;
        if (onDone) onDone();
      }
    };
    meta._ringFadeRaf = requestAnimationFrame(step);
  };

  // SCENE DETACHMENT (Nuclear Optimization):
  // When FAR: physically detach the entire island group from the scene graph.
  // This removes ALL children (meshes, particles, edges, labels) from the render pipeline.
  // The renderer and raycaster will completely ignore them.
  //
  // EXCEPTION: islandLabel must remain connected.
  if (lodFar) {
    // Save the parent reference before detaching
    if (group.parent && !meta._lodSavedParent) {
      meta._lodSavedParent = group.parent;
      meta._lodSavedParentIndex = meta._lodSavedParent.children.indexOf(group);
    }

    // Extract islandLabel before detaching
    const labelChild = group.children.find(c => c.name === 'islandLabel');

    if (labelChild) {
      group.remove(labelChild);
      meta._lodSavedLabel = labelChild;
      labelChild.visible = false;
    }

    // Reattach label to the parent (stays visible)
    const parent = meta._lodSavedParent || scene;
    if (labelChild) parent.add(labelChild);
    if (meta._lodSavedLabel) {
      meta._lodSavedLabel.visible = false;
    }
    if (meta._ringLabelTimer) {
      clearTimeout(meta._ringLabelTimer);
      meta._ringLabelTimer = null;
    }

    // FAR transition: fade IN ring first; detach detailed group only when ring is fully visible.
    if (meta.tacticalRing) {
      meta.tacticalRing.visible = true;
      meta.tacticalRing.material.opacity = 0;
      const maxOpacity = Number(meta.tacticalRing.userData.maxOpacity) || 0.9;
      _fadeRingTo(maxOpacity, 260, () => {
        if (!meta._lodFar) return;
        if (group.parent) group.parent.remove(group);
      });
    } else {
      if (group.parent) group.parent.remove(group);
    }
  } else {
    // Reattach to scene graph when NEAR
    if (meta._lodSavedParent) {
      meta._lodSavedParent.add(group);
      meta._lodSavedParent = null;
      meta._lodSavedParentIndex = -1;
    } else {
      // Fallback: add to scene if parent reference lost
      scene.add(group);
    }

    // Put label back into the island group
    if (meta._lodSavedLabel) {
      group.add(meta._lodSavedLabel);
      meta._lodSavedLabel.visible = false;
    }

    // NEAR transition: detailed group appears immediately; ring fades out smoothly.
    if (meta.tacticalRing) {
      meta.tacticalRing.visible = true;
      const maxOpacity = Number(meta.tacticalRing.userData.maxOpacity) || 0.9;
      if (meta.tacticalRing.material.opacity <= 0) meta.tacticalRing.material.opacity = maxOpacity;
      if (meta._ringLabelTimer) {
        clearTimeout(meta._ringLabelTimer);
        meta._ringLabelTimer = null;
      }
      // Show floating label around half of the fade-out.
      meta._ringLabelTimer = setTimeout(() => {
        if (meta._lodFar) return;
        if (meta._lodSavedLabel) {
          const lbl = meta._lodSavedLabel;
          lbl.visible = true;
          const baseX = Number(lbl.userData?.baseScaleX) || lbl.scale.x;
          const baseY = Number(lbl.userData?.baseScaleY) || lbl.scale.y;
          lbl.scale.set(baseX, baseY, 1);
          meta._lodSavedLabel = null;
        }
      }, 110);
      _fadeRingTo(0, 220, () => {
        if (meta._lodFar) return;
        if (meta.tacticalRing) meta.tacticalRing.visible = false;
      });
    } else if (meta._lodSavedLabel) {
      meta._lodSavedLabel.visible = true;
      const lbl = meta._lodSavedLabel;
      const baseX = Number(lbl.userData?.baseScaleX) || lbl.scale.x;
      const baseY = Number(lbl.userData?.baseScaleY) || lbl.scale.y;
      lbl.scale.set(baseX, baseY, 1);
      meta._lodSavedLabel = null;
    }
  }

}

function _createIslandTacticalTexture(islandName, ringColorHex) {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  const cx = size * 0.5;
  const cy = size * 0.5;
  const outerR = size * 0.455;
  const innerR = size * 0.30;
  const colorHex = `#${(Number(ringColorHex) >>> 0).toString(16).padStart(6, '0')}`;

  const glow = ctx.createRadialGradient(cx, cy, innerR * 0.35, cx, cy, outerR);
  glow.addColorStop(0, 'rgba(0, 0, 0, 0.0)');
  glow.addColorStop(0.6, 'rgba(0, 243, 255, 0.08)');
  glow.addColorStop(1, 'rgba(0, 243, 255, 0.18)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = colorHex;
  ctx.lineWidth = Math.max(8, size * 0.018);
  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.arc(cx, cy, outerR * 0.98, 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.floor(size * 0.13)}px Arial Black, Inter, Roboto, sans-serif`;
  const name = String(islandName || 'ISLAND').toUpperCase();
  const maxWidth = size * 0.82;
  if (ctx.measureText(name).width > maxWidth) {
    ctx.font = `900 ${Math.floor(size * 0.10)}px Arial Black, Inter, Roboto, sans-serif`;
  }
  ctx.fillText(name, cx, cy, maxWidth);

  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = renderer?.capabilities?.getMaxAnisotropy ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  tex.needsUpdate = true;
  return tex;
}

const _lodCamPos = new THREE.Vector3();
export function updateLOD() {
  if (!camera || !islandMeta) return;
  _lodCamPos.copy(camera.position);
  const keys = Object.keys(islandMeta);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const meta = islandMeta[k];
    if (!meta || !meta.center) continue;

    const dx = meta.center.x - _lodCamPos.x;
    const dy = (meta.center.y || 0) - _lodCamPos.y;
    const dz = meta.center.z - _lodCamPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const wasFar = !!meta._lodFar;
    const threshold = MONOLITH_LOD_DISTANCE + (wasFar ? -MONOLITH_LOD_HYSTERESIS : MONOLITH_LOD_HYSTERESIS);
    const isFar = dist > threshold;
    _setIslandLodState(k, isFar);
  }

  needsUpdate = true;
}

let _lodDebounceTimer = null;
function _scheduleLODUpdate() {
  if (_lodDebounceTimer) return;
  _lodDebounceTimer = setTimeout(() => {
    _lodDebounceTimer = null;
    updateLOD();
  }, 200);
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

// ─────────────────────────────────────────────────────────
// 🤫 Marketing / demo mode — DEV-ONLY console hook.
// No UI, no buttons, no toasts. Open DevTools and call
// `enableMarketingMode()` to inject deterministic-but-spectacular
// execution_times into every node and trigger an instant city rebuild.
// Default app behavior remains 100% honest (zeros stay zeros).
// ─────────────────────────────────────────────────────────
window.enableMarketingMode = function enableMarketingMode(opts) {
  const { intensity = 1.0, seed = 'dagcity', silent = false, force } = opts || {};
  const raw = State.get ? State.get('raw') : State.raw;
  if (!raw || !raw.nodes || !raw.nodes.length) {
    if (!silent) console.warn('[MarketingMode] No project loaded.');
    return false;
  }
  raw.metadata = raw.metadata || {};

  // ── Toggle behavior ──
  // - force === true  → always enable
  // - force === false → always disable (restore)
  // - force === undefined → flip current state.
  const currentlyOn = !!raw.metadata.marketing_mode;
  const wantOn = (typeof force === 'boolean') ? force : !currentlyOn;

  if (!wantOn) {
    // RESTORE original execution_time + time_source from the snapshot taken
    // when marketing mode was first enabled. If no snapshot exists, no-op.
    const snap = raw.metadata.__pre_marketing__;
    if (snap && Array.isArray(snap.nodes)) {
      const byId = Object.create(null);
      snap.nodes.forEach(s => { byId[s.id] = s; });
      raw.nodes.forEach(n => {
        const s = byId[n.id];
        if (!s) return;
        n.execution_time = s.execution_time;
        n.time_source = s.time_source;
      });
      if (State.set) State.set('perfMode', !!snap.perfMode);
    }
    delete raw.metadata.marketing_mode;
    delete raw.metadata.__pre_marketing__;
    rebuildCity(raw, false);
    if (!silent) {
      console.log('%c[MarketingMode] Disabled — original times restored.',
                  'color:#888;font-weight:bold');
    }
    return false;
  }

  // ── ENABLE ──
  // Snapshot the pre-marketing state ONCE so we can restore on toggle off.
  if (!raw.metadata.__pre_marketing__) {
    raw.metadata.__pre_marketing__ = {
      perfMode: !!State.perfMode,
      nodes: raw.nodes.map(n => ({
        id: n.id,
        execution_time: n.execution_time,
        time_source: n.time_source,
      })),
    };
  }

  // Deterministic PRNG (mulberry32) seeded with the project name + seed string.
  let h = 2166136261;
  const seedStr = (raw.metadata?.project_name || '') + '::' + seed;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  const rand = () => { s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  raw.nodes.forEach(n => {
    // Long-tail distribution: most nodes ~0.5-3s, ~10% bottlenecks 8-25s.
    const r = rand();
    const base = (r < 0.1) ? (8 + rand() * 17) : (0.3 + Math.pow(rand(), 1.6) * 4);
    n.execution_time = +(base * intensity).toFixed(2);
    // Honest provenance tag — NOT 'real'. The badge stays ∼ SIMULATED.
    n.time_source = 'marketing';
  });
  raw.metadata.marketing_mode = true;
  // Auto-enable Perf Mode so buildings visibly grow.
  if (State.set) State.set('perfMode', true);
  rebuildCity(raw, false);
  if (!silent) {
    console.log('%c[MarketingMode] Synthetic times injected into', 'color:#ff66c4;font-weight:bold',
                raw.nodes.length, 'nodes.');
  }
  return true;
};

// ─────────────────────────────────────────────────────────
// 🎹 Hidden keyboard shortcut: Ctrl/Cmd + Shift + M → Marketing Mode.
// CRITICAL: bound to `window` with capture=true so the 3D canvas (which
// has its own keyboard handlers via OrbitControls/raycaster) cannot
// swallow the event. We log a single confirmation line and toggle the
// city; no other UI feedback.
// ─────────────────────────────────────────────────────────
window.addEventListener('keydown', (event) => {
  if (!((event.ctrlKey || event.metaKey) && event.shiftKey)) return;
  if (!(event.key && event.key.toLowerCase() === 'm') && event.code !== 'KeyM') return;

  // Allow the shortcut even when focused on an input — the user is the dev,
  // and form inputs don't typically map Ctrl+Shift+M to anything important.
  event.preventDefault();
  console.log('🔥 Marketing Mode toggled');
  try { window.enableMarketingMode && window.enableMarketingMode({ silent: true }); }
  catch (err) { console.warn('[MarketingMode] toggle failed:', err); }
}, true);
