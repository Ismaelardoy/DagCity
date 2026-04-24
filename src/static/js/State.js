// ═══════════════════════════════════════════════════════
// State.js — Central Reactive State (Singleton)
// All modules read from and write to this object.
// Cross-module communication happens via State.on/emit.
// ═══════════════════════════════════════════════════════

export const State = {
  // ── Graph Data ─────────────────────────────────────
  raw: null,            // Full graph payload from server

  // ── SLA ─────────────────────────────────────────────
  userDefinedSLA: 120,  // Global threshold (seconds)
  slaZones: {},         // layer -> threshold
  slaNodes: {},         // nodeId -> threshold
  vfxThresholds: {      // SLA ratios for particle triggers
    smoke: 1.0,
    sparks: 1.2,
    fire: 1.5
  },

  // ── Engine & Viewport ─────────────────────────────
  camSensitivity: 1.0,
  flySpeed: 1.0,
  neonIntensity: 0.0,
  showLabels: true,
  showParticles: true,

  // ── UI ──────────────────────────────────────────────
  perfMode: false,
  selectedNode: null,
  activeProject: null,  // localStorage key

  // ── Internal pub/sub ────────────────────────────────
  _listeners: {},

  on(event, cb) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(cb);
    // Returns an unsubscribe function
    return () => {
      this._listeners[event] = this._listeners[event].filter(c => c !== cb);
    };
  },

  emit(event, data) {
    (this._listeners[event] || []).forEach(cb => {
      try { cb(data); } catch(e) { console.error(`[State] Error in listener for "${event}":`, e); }
    });
  },

  // Reactive setter — updates key and fires change events
  set(key, value) {
    this[key] = value;
    this.emit('change:' + key, value);
    this.emit('change', { key, value });
  }
};
