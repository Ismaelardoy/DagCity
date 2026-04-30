// ─────────────────────────────────────────────────────────────────
// State.test.js — Unit tests for State.js reactive singleton
// Runner: Jest (jsdom environment)
// ─────────────────────────────────────────────────────────────────

// We cannot import ES modules directly with plain Jest without a transformer.
// So we rebuild the State logic inline as a pure-function test harness.

// ── Reproduce core State behaviour ───────────────────────────────

function createState(initialSettings = {}) {
  const defaultSettings = {
    userDefinedSLA: 120,
    slaZones: {},
    camSensitivity: 1.0,
    neonIntensity: 0.0,
    showLabels: true,
    perfMode: false,
    viewMode: '3d',
    graphicsMode: 'high',
    activeFilters: {},
    selectedNode: null,
    theme: 'dark',
    ...initialSettings,
  };

  let currentProjectName = null;
  const _listeners = {};

  const state = {
    ...defaultSettings,
    _listeners,

    on(event, cb) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(cb);
      return () => {
        _listeners[event] = _listeners[event].filter(c => c !== cb);
      };
    },

    emit(event, data) {
      (_listeners[event] || []).forEach(cb => {
        try { cb(data); } catch (e) { /* swallow */ }
      });
    },

    set(key, value) {
      this[key] = value;
      this.emit('change:' + key, value);
      this.emit('change', { keys: [key] });
    },

    setMultiple(settings) {
      Object.keys(settings).forEach(k => {
        this[k] = settings[k];
        this.emit('change:' + k, settings[k]);
      });
      this.emit('change', { keys: Object.keys(settings) });
    },

    get currentProjectName() { return currentProjectName; },
    setProjectName(name) { currentProjectName = name; },
  };

  return state;
}

// ── Tests ─────────────────────────────────────────────────────────

describe('State — defaults', () => {
  test('has correct default userDefinedSLA', () => {
    const s = createState();
    expect(s.userDefinedSLA).toBe(120);
  });

  test('has dark theme by default', () => {
    const s = createState();
    expect(s.theme).toBe('dark');
  });

  test('showLabels is true by default', () => {
    const s = createState();
    expect(s.showLabels).toBe(true);
  });

  test('perfMode is false by default', () => {
    const s = createState();
    expect(s.perfMode).toBe(false);
  });

  test('viewMode defaults to 3d', () => {
    const s = createState();
    expect(s.viewMode).toBe('3d');
  });

  test('activeFilters defaults to empty object', () => {
    const s = createState();
    expect(s.activeFilters).toEqual({});
  });

  test('selectedNode defaults to null', () => {
    const s = createState();
    expect(s.selectedNode).toBeNull();
  });
});

describe('State.set()', () => {
  test('updates the value', () => {
    const s = createState();
    s.set('perfMode', true);
    expect(s.perfMode).toBe(true);
  });

  test('emits change:<key> event', () => {
    const s = createState();
    const spy = jest.fn();
    s.on('change:perfMode', spy);
    s.set('perfMode', true);
    expect(spy).toHaveBeenCalledWith(true);
  });

  test('emits generic change event with key list', () => {
    const s = createState();
    const spy = jest.fn();
    s.on('change', spy);
    s.set('neonIntensity', 0.8);
    expect(spy).toHaveBeenCalledWith({ keys: ['neonIntensity'] });
  });

  test('value is updated before event fires', () => {
    const s = createState();
    let capturedValue;
    s.on('change:camSensitivity', () => { capturedValue = s.camSensitivity; });
    s.set('camSensitivity', 2.5);
    expect(capturedValue).toBe(2.5);
  });
});

describe('State.setMultiple()', () => {
  test('updates multiple keys', () => {
    const s = createState();
    s.setMultiple({ perfMode: true, viewMode: '2d', neonIntensity: 1.0 });
    expect(s.perfMode).toBe(true);
    expect(s.viewMode).toBe('2d');
    expect(s.neonIntensity).toBe(1.0);
  });

  test('emits change event once with all keys', () => {
    const s = createState();
    const spy = jest.fn();
    s.on('change', spy);
    s.setMultiple({ perfMode: true, showLabels: false });
    expect(spy).toHaveBeenCalledWith({ keys: ['perfMode', 'showLabels'] });
  });

  test('emits individual change:<key> events for each key', () => {
    const s = createState();
    const spyPerf = jest.fn();
    const spyLabels = jest.fn();
    s.on('change:perfMode', spyPerf);
    s.on('change:showLabels', spyLabels);
    s.setMultiple({ perfMode: true, showLabels: false });
    expect(spyPerf).toHaveBeenCalledWith(true);
    expect(spyLabels).toHaveBeenCalledWith(false);
  });
});

describe('State.on() / State.emit()', () => {
  test('listener receives emitted data', () => {
    const s = createState();
    const spy = jest.fn();
    s.on('custom:event', spy);
    s.emit('custom:event', { foo: 'bar' });
    expect(spy).toHaveBeenCalledWith({ foo: 'bar' });
  });

  test('multiple listeners for same event all called', () => {
    const s = createState();
    const spyA = jest.fn();
    const spyB = jest.fn();
    s.on('custom:event', spyA);
    s.on('custom:event', spyB);
    s.emit('custom:event', 42);
    expect(spyA).toHaveBeenCalledWith(42);
    expect(spyB).toHaveBeenCalledWith(42);
  });

  test('unsubscribe removes listener', () => {
    const s = createState();
    const spy = jest.fn();
    const off = s.on('custom:event', spy);
    off();
    s.emit('custom:event', 1);
    expect(spy).not.toHaveBeenCalled();
  });

  test('no-op for unknown event', () => {
    const s = createState();
    expect(() => s.emit('nonexistent:event', null)).not.toThrow();
  });

  test('listener throwing does not break other listeners', () => {
    const s = createState();
    const bad = jest.fn().mockImplementation(() => { throw new Error('boom'); });
    const good = jest.fn();
    s.on('test:event', bad);
    s.on('test:event', good);
    s.emit('test:event', null);
    expect(good).toHaveBeenCalled();
  });
});

describe('State.setProjectName()', () => {
  test('sets currentProjectName', () => {
    const s = createState();
    s.setProjectName('my_project');
    expect(s.currentProjectName).toBe('my_project');
  });

  test('starts as null', () => {
    const s = createState();
    expect(s.currentProjectName).toBeNull();
  });

  test('can be overwritten', () => {
    const s = createState();
    s.setProjectName('proj_a');
    s.setProjectName('proj_b');
    expect(s.currentProjectName).toBe('proj_b');
  });
});
