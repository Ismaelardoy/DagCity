// ═══════════════════════════════════════════════════════
// State.js — Central Reactive State (Singleton)
// All modules read from and write to this object.
// Cross-module communication happens via State.on/emit.
// ═══════════════════════════════════════════════════════

// ── Project-Aware Default Settings ─────────────────────
const defaultSettings = {
  // Graph Data
  raw: null,

  // SLA
  userDefinedSLA: 120,
  slaZones: {},
  slaNodes: {},
  vfxThresholds: {
    smoke: 1.0,
    sparks: 1.2,
    fire: 1.5
  },

  // Engine & Viewport
  camSensitivity: 1.0,
  flySpeed: 1.0,
  neonIntensity: 0.0,
  showLabels: true,
  showParticles: true,
  graphicsMode: 'high', // 'high' or 'low'
  viewMode: '3d',

  // UI
  perfMode: false,
  dataVolumeMode: false,
  dataSwellMetric: 'rows',
  dataSwellIntensity: 1.0,
  autoAdjustThreshold: true,
  autoMaxThreshold: 1,
  referenceThreshold: 1,
  swellWarnThresholdPct: 60,
  swellCriticalThresholdPct: 100,
  viewMode: '3d',
  activeFilters: {},
  blastRadiusSourceId: null,
  blastRadiusIds: [],
  selectedNode: null,
  theme: 'dark'
};

// ── Project Identification ───────────────────────────────
let currentProjectName = null;

function getStorageKey() {
  return currentProjectName ? `dagcity_settings_${currentProjectName}` : 'dagcity_settings_global';
}

function setProjectName(name) {
  currentProjectName = name;
  loadPersisted();
}

// ── Load and Merge with Defaults (Hydration) ───────────
function loadPersisted() {
  const storageKey = getStorageKey();
  try {
    const stored = localStorage.getItem(storageKey);
    const parsed = stored ? JSON.parse(stored) : {};
    
    // Merge with defaults (new options get default values)
    Object.keys(defaultSettings).forEach(key => {
      if (parsed[key] !== undefined) {
        State[key] = parsed[key];
      } else {
        State[key] = defaultSettings[key];
      }
    });
    
    console.log(`[State] Loaded settings for project: ${currentProjectName || 'global'}`);
  } catch(e) {
    console.warn('[State] Failed to load persisted settings:', e);
    // Fallback to defaults on error
    Object.assign(State, defaultSettings);
  }
}

// ── Central Update Function (Save + Apply) ───────────────
function updateSettings(newSettings) {
  console.log('[State] updateSettings called with:', newSettings);
  
  // Update local state
  Object.keys(newSettings).forEach(key => {
    State[key] = newSettings[key];
    State.emit('change:' + key, newSettings[key]);
  });
  State.emit('change', { keys: Object.keys(newSettings) });
  
  // Save to localStorage (project-specific)
  const storageKey = getStorageKey();
  try {
    const currentSettings = {};
    Object.keys(defaultSettings).forEach(key => {
      currentSettings[key] = State[key];
    });
    localStorage.setItem(storageKey, JSON.stringify(currentSettings));
  } catch(e) {
    console.warn('[State] Failed to persist settings:', e);
  }
  
  // Apply changes to engine
  console.log('[State] Calling applySettingsToEngine');
  applySettingsToEngine(newSettings);
}

// ── Apply Settings to 3D Engine ───────────────────────────
function applySettingsToEngine(settings) {
  // This function will be implemented in CityEngine.js
  // It will handle:
  // - graphicsMode: update materials, enable/disable bloom
  // - is2DMode: trigger camera tween, toggle 2D/3D
  // - showLabels: toggle CSS2D visibility
  // - showParticles: toggle particle systems
  // - neonIntensity: update material emissive
  // - perfMode: enable/disable effects
  // - viewMode: switch camera mode
  
  if (typeof window !== 'undefined' && window.applySettingsToEngine) {
    window.applySettingsToEngine(settings);
  }
}

export const State = {
  // ── Initialize with defaults ─────────────────────────────
  ...defaultSettings,

  // ── Project Management ───────────────────────────────────
  get currentProjectName() { return currentProjectName; },
  setProjectName,
  getStorageKey,

  // ── Internal pub/sub ────────────────────────────────────
  _listeners: {},

  on(event, cb) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(cb);
    return () => {
      this._listeners[event] = this._listeners[event].filter(c => c !== cb);
    };
  },

  emit(event, data) {
    (this._listeners[event] || []).forEach(cb => {
      try { cb(data); } catch(e) { console.error(`[State] Error in listener for "${event}":`, e); }
    });
  },

  // Reactive setter — uses central updateSettings
  set(key, value) {
    this[key] = value;
    updateSettings({ [key]: value });
  },

  // Batch update for multiple settings at once
  setMultiple(settings) {
    updateSettings(settings);
  },

  // Load persisted values for current project
  loadPersisted,
  
  // Central update function (public API)
  updateSettings
};
