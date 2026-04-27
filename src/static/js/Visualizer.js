// ═══════════════════════════════════════════════════════
// Visualizer.js — Three.js Scene, Camera, Renderer, Controls
// Does NOT know about buildings, SLA, or UI.
// ═══════════════════════════════════════════════════════
import { State } from './State.js';

// Exported references used by other modules
export let scene, camera, renderer, controls, composer, bloomPass;
export let perspectiveCamera, orthoCamera;
export let isOrthoActive = false;

console.log('[Visualizer] Module loaded.');
export const INIT_CAM = { x: 0, y: 110, z: 280 };
const ORTHO_FRUSTUM_SIZE = 2600;

function _configureOrthoCamera() {
  if (!orthoCamera) return;
  const nw = window.innerWidth;
  const nh = Math.max(1, window.innerHeight);
  const aspect = nw / nh;
  const halfH = ORTHO_FRUSTUM_SIZE * 0.5;
  const halfW = halfH * aspect;
  orthoCamera.left = -halfW;
  orthoCamera.right = halfW;
  orthoCamera.top = halfH;
  orthoCamera.bottom = -halfH;
  orthoCamera.updateProjectionMatrix();
}

export function setCameraMode(useOrtho) {
  if (!perspectiveCamera || !orthoCamera) return;
  isOrthoActive = !!useOrtho;
  camera = isOrthoActive ? orthoCamera : perspectiveCamera;
  if (controls) {
    controls.object = camera;
    controls.update();
  }
}


export function initScene() {
  console.log('[Visualizer] Initializing Three.js scene...');
  if (typeof THREE === 'undefined') {
    console.error('[Visualizer] CRITICAL: Three.js is not loaded! Check CDN scripts.');
    return;
  }

  const container = document.getElementById('canvas-container');
  if (!container) {
    console.error('[Visualizer] CRITICAL: #canvas-container not found in DOM.');
    return;
  }

  const W = window.innerWidth, H = window.innerHeight;

  let bootGraphics = '1';
  try {
    const stored = localStorage.getItem('dagcity_graphics');
    if (stored === '0' || stored === '1') {
      bootGraphics = stored;
    } else {
      bootGraphics = State.graphicsMode === 'low' ? '0' : '1';
    }
  } catch (_) {
    bootGraphics = State.graphicsMode === 'low' ? '0' : '1';
  }
  const bootIsHigh = bootGraphics === '1';

  renderer = new THREE.WebGLRenderer({ antialias: bootIsHigh, powerPreference: "high-performance" });
  renderer.setSize(W, H);
  // NOTE: pixelRatio and shadowMap are NOT configured here. setGraphicsQuality
  // (CityEngine.js) is the single source of truth and is called at boot from main.js.
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000408);

  perspectiveCamera = new THREE.PerspectiveCamera(55, W / H, 0.1, 5000);
  perspectiveCamera.position.set(INIT_CAM.x, INIT_CAM.y, INIT_CAM.z);

  orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 9000);
  _configureOrthoCamera();
  orthoCamera.position.set(0, 5000, 0);
  orthoCamera.lookAt(0, 0, 0);

  camera = perspectiveCamera;

  // Check for OrbitControls (can be in THREE.OrbitControls or global OrbitControls)
  const OrbitCtrl = THREE.OrbitControls || window.OrbitControls;
  if (OrbitCtrl) {
    controls = new OrbitCtrl(camera, renderer.domElement);
    controls.enableDamping  = true;
    controls.dampingFactor  = 0.05;
    controls.zoomSpeed      = 1.2;
    controls.autoRotate     = true;
    controls.autoRotateSpeed = 0.25;
    controls.minDistance    = 40;
    controls.maxDistance    = 1400;
    controls.enablePan      = true;
    
    // Drone Camera Controls
    controls.screenSpacePanning = true; // Enable vertical panning
    controls.maxPolarAngle = Math.PI / 2 - 0.05; // Prevent camera from going below ground (~85°)
    
    // Keyboard elevation controls
    let elevationSpeed = 10;
    document.addEventListener('keydown', (e) => {
      if (!controls) return;
      
      if (e.code === 'Space') {
        e.preventDefault();
        // Elevate camera and target
        const elevation = 15;
        camera.position.y += elevation;
        controls.target.y += elevation;
        controls.update();
      } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        e.preventDefault();
        // Lower camera and target
        const elevation = -15;
        camera.position.y = Math.max(10, camera.position.y + elevation);
        controls.target.y = Math.max(0, controls.target.y + elevation);
        controls.update();
      }
    });
    
    // Auto-elevation on zoom out
    let lastDistance = controls.getDistance();
    controls.addEventListener('change', () => {
      const currentDistance = controls.getDistance();
      if (currentDistance > lastDistance + 50) {
        // Zoomed out significantly
        const elevationFactor = (currentDistance - lastDistance) * 0.1;
        controls.target.y = Math.max(0, controls.target.y + elevationFactor);
        lastDistance = currentDistance;
      } else if (currentDistance < lastDistance - 50) {
        // Zoomed in significantly
        const elevationFactor = (lastDistance - currentDistance) * 0.05;
        controls.target.y = Math.max(0, controls.target.y - elevationFactor);
        lastDistance = currentDistance;
      }
    });
    
    console.log('[Visualizer] Drone Camera controls enabled');
  } else {
    console.warn('[Visualizer] OrbitControls not found. Camera navigation might be limited.');
  }


  // Lights
  scene.add(new THREE.AmbientLight(0x101c2e, 3.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(80, 200, 120);
  scene.add(sun);

  // Grid
  const grid = new THREE.GridHelper(800, 80, 0x003366, 0x001122);
  grid.material.opacity = 0.5;
  grid.material.transparent = true;
  scene.add(grid);

  // Invisible floor for zoom
  const floorGeo = new THREE.PlaneGeometry(2000, 2000);
  floorGeo.rotateX(-Math.PI / 2);
  scene.add(new THREE.Mesh(floorGeo, new THREE.MeshBasicMaterial({ visible: false })));

  // Resize handler
  window.addEventListener('resize', () => {
    const nw = window.innerWidth, nh = window.innerHeight;
    if (perspectiveCamera) {
      perspectiveCamera.aspect = nw / nh;
      perspectiveCamera.updateProjectionMatrix();
    }
    _configureOrthoCamera();
    renderer.setSize(nw, nh);
    if (composer) composer.setSize(nw, nh);
  });

  initPostProcessing();
  initEngineListeners();
  _initAzBg();
}

function initPostProcessing() {
  const W = window.innerWidth, H = window.innerHeight;
  const renderScene = new THREE.RenderPass(scene, camera);
  
  bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(W, H), 1.5, 0.4, 0.85);
  bloomPass.threshold = 0.22;
  bloomPass.strength = State.neonIntensity;
  bloomPass.radius = 0.5;

  composer = new THREE.EffectComposer(renderer);
  composer.addPass(renderScene);
  composer.addPass(bloomPass);
}

function initEngineListeners() {
  setTimeout(() => {
    console.log('[Visualizer] Initializing engine listeners...');
    
    State.on('change:camSensitivity', val => {
      if (!controls) return;
      const sens = parseFloat(val);
      controls.rotateSpeed = sens;
      controls.zoomSpeed   = 1.2 * sens;
      controls.panSpeed    = sens;
      controls.update();
    });

    State.on('change:neonIntensity', val => {
      if (bloomPass) bloomPass.strength = parseFloat(val);
    });

    State.on('change:showLabels', val => {
      if (!scene) return;
      console.log('[Visualizer] Toggling labels:', val);
      scene.traverse(obj => {
        if (obj.name === 'label' || obj.name === 'timeLabel' || (obj.name && obj.name.includes('Label'))) {
          obj.visible = val;
        }
      });
    });

    // Apply initial values
    if (controls) {
      controls.rotateSpeed = State.camSensitivity;
      controls.zoomSpeed   = 1.2 * State.camSensitivity;
      controls.panSpeed    = State.camSensitivity;
    }
    if (bloomPass) bloomPass.strength = State.neonIntensity;
    
    console.log('[Visualizer] Listeners ready.');
  }, 100);
}

function _initAzBg() {
  const canvas = document.getElementById('az-bg');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w, h;
  function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
  window.addEventListener('resize', resize);
  resize();
  function draw() {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#00f3ff';
    ctx.lineWidth = 1;
    const step = 60;
    const offset = (Date.now() / 40) % step;
    for (let x = offset; x < w; x += step) {
      ctx.globalAlpha = 0.1 * (1 - x / w);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = offset; y < h; y += step) {
      ctx.globalAlpha = 0.1 * (1 - y / h);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    const scanY = (Date.now() / 15) % h;
    const grad = ctx.createLinearGradient(0, scanY - 100, 0, scanY);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(1, 'rgba(0, 243, 255, 0.2)');
    ctx.fillStyle = grad;
    ctx.globalAlpha = 1;
    ctx.fillRect(0, scanY - 100, w, 100);
    requestAnimationFrame(draw);
  }
  draw();
}
