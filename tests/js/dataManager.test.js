// ─────────────────────────────────────────────────────────────────
// dataManager.test.js — Unit tests for DataManager utility logic
// Tests pure, DOM-free logic extracted from DataManager.js
// Runner: Jest (jsdom environment)
// ─────────────────────────────────────────────────────────────────

// ── File ingestion logic (dzIngestFiles equivalent) ───────────────

function classifyFiles(files) {
  const result = { manifest: null, run_results: null, errors: [] };
  for (const file of files) {
    if (!file.name.endsWith('.json')) {
      result.errors.push(`Only .json files accepted (got: ${file.name})`);
      return result;
    }
    if (file.name.startsWith('manifest')) {
      result.manifest = file;
    } else if (file.name.startsWith('run_results')) {
      result.run_results = file;
    } else if (!result.manifest) {
      result.manifest = file;
    } else {
      result.run_results = file;
    }
  }
  return result;
}

describe('dzIngestFiles — file classification', () => {
  const f = (name) => ({ name });

  test('manifest.json classified as manifest', () => {
    const r = classifyFiles([f('manifest.json')]);
    expect(r.manifest.name).toBe('manifest.json');
    expect(r.run_results).toBeNull();
  });

  test('run_results.json classified as run_results', () => {
    const r = classifyFiles([f('manifest.json'), f('run_results.json')]);
    expect(r.run_results.name).toBe('run_results.json');
  });

  test('non-.json file returns error', () => {
    const r = classifyFiles([f('manifest.csv')]);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toMatch(/Only .json/);
  });

  test('unknown file without manifest assigned as manifest', () => {
    const r = classifyFiles([f('some_export.json')]);
    expect(r.manifest.name).toBe('some_export.json');
  });

  test('two unknown files: first=manifest, second=run_results', () => {
    const r = classifyFiles([f('file_a.json'), f('file_b.json')]);
    expect(r.manifest.name).toBe('file_a.json');
    expect(r.run_results.name).toBe('file_b.json');
  });

  test('empty file list returns nulls with no errors', () => {
    const r = classifyFiles([]);
    expect(r.manifest).toBeNull();
    expect(r.run_results).toBeNull();
    expect(r.errors).toHaveLength(0);
  });

  test('manifest slot not replaced by second manifest file', () => {
    const r = classifyFiles([f('manifest.json'), f('manifest_v2.json')]);
    expect(r.manifest.name).toBe('manifest.json');
  });
});

// ── Live session detection ────────────────────────────────────────

function isLiveSessionActive(storage) {
  try {
    if (storage.getItem('dagcity_is_live') === 'true') return true;
    const raw = storage.getItem('dagcity_live_sync_session');
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed && parsed.mode === 'live_sync';
  } catch (_) {
    return false;
  }
}

class MockStorage {
  constructor(data = {}) { this._data = { ...data }; }
  getItem(k) { return this._data[k] ?? null; }
  setItem(k, v) { this._data[k] = v; }
  removeItem(k) { delete this._data[k]; }
}

describe('isLiveSessionActive()', () => {
  test('returns true when dagcity_is_live=true', () => {
    const s = new MockStorage({ dagcity_is_live: 'true' });
    expect(isLiveSessionActive(s)).toBe(true);
  });

  test('returns false when dagcity_is_live absent', () => {
    const s = new MockStorage();
    expect(isLiveSessionActive(s)).toBe(false);
  });

  test('returns true for valid live_sync session object', () => {
    const s = new MockStorage({
      dagcity_live_sync_session: JSON.stringify({ mode: 'live_sync', project: 'proj_x' })
    });
    expect(isLiveSessionActive(s)).toBe(true);
  });

  test('returns false for offline session object', () => {
    const s = new MockStorage({
      dagcity_live_sync_session: JSON.stringify({ mode: 'offline' })
    });
    expect(isLiveSessionActive(s)).toBe(false);
  });

  test('returns false for malformed session JSON', () => {
    const s = new MockStorage({ dagcity_live_sync_session: '{ invalid json' });
    expect(isLiveSessionActive(s)).toBe(false);
  });

  test('returns false when session is null', () => {
    const s = new MockStorage({ dagcity_live_sync_session: 'null' });
    expect(isLiveSessionActive(s)).toBe(false);
  });
});

// ── Live update retry logic ───────────────────────────────────────

function buildRetrySchedule(maxAttempts, baseDelay = 700, increment = 350) {
  return Array.from({ length: maxAttempts }, (_, i) => baseDelay + (i + 1) * increment);
}

describe('Live update retry schedule', () => {
  test('generates correct number of retry delays', () => {
    expect(buildRetrySchedule(3)).toHaveLength(3);
  });

  test('each retry delay is greater than the previous', () => {
    const schedule = buildRetrySchedule(4);
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i]).toBeGreaterThan(schedule[i - 1]);
    }
  });

  test('first delay equals base + increment', () => {
    const [first] = buildRetrySchedule(1, 700, 350);
    expect(first).toBe(1050);
  });

  test('live project gets 4 attempts, regular gets 2', () => {
    const live = buildRetrySchedule(4);
    const regular = buildRetrySchedule(2);
    expect(live).toHaveLength(4);
    expect(regular).toHaveLength(2);
  });
});

// ── SSE message routing logic ─────────────────────────────────────

function shouldApplyUpdate({ msgProject, activeProject, liveSession, syncSource }) {
  const liveLike = syncSource === 'live_sync' || syncSource === 'local_sync';
  return (
    msgProject === activeProject ||
    (msgProject === 'live' && (liveSession || liveLike))
  );
}

describe('SSE shouldApplyUpdate()', () => {
  test('applies when msgProject === activeProject', () => {
    expect(shouldApplyUpdate({
      msgProject: 'my_project',
      activeProject: 'my_project',
      liveSession: false,
      syncSource: 'offline',
    })).toBe(true);
  });

  test('does not apply when projects do not match', () => {
    expect(shouldApplyUpdate({
      msgProject: 'other_project',
      activeProject: 'my_project',
      liveSession: false,
      syncSource: 'offline',
    })).toBe(false);
  });

  test('applies live update when liveSession is active', () => {
    expect(shouldApplyUpdate({
      msgProject: 'live',
      activeProject: 'my_project',
      liveSession: true,
      syncSource: 'offline',
    })).toBe(true);
  });

  test('applies live update when syncSource is live_sync', () => {
    expect(shouldApplyUpdate({
      msgProject: 'live',
      activeProject: 'some_project',
      liveSession: false,
      syncSource: 'live_sync',
    })).toBe(true);
  });

  test('applies live update when syncSource is local_sync', () => {
    expect(shouldApplyUpdate({
      msgProject: 'live',
      activeProject: 'some_project',
      liveSession: false,
      syncSource: 'local_sync',
    })).toBe(true);
  });

  test('ignores live update when not live session and source is offline', () => {
    expect(shouldApplyUpdate({
      msgProject: 'live',
      activeProject: 'my_project',
      liveSession: false,
      syncSource: 'offline',
    })).toBe(false);
  });
});

// ── Debounce utility ──────────────────────────────────────────────

function createDebounce() {
  let timer = null;
  return function debounce(fn, delayMs) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, delayMs);
  };
}

describe('Debounce utility', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('callback called after delay', () => {
    const debounce = createDebounce();
    const spy = jest.fn();
    debounce(spy, 180);
    expect(spy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('rapid calls collapse into one invocation', () => {
    const debounce = createDebounce();
    const spy = jest.fn();
    debounce(spy, 180);
    debounce(spy, 180);
    debounce(spy, 180);
    jest.advanceTimersByTime(300);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('callback not called if timer not expired', () => {
    const debounce = createDebounce();
    const spy = jest.fn();
    debounce(spy, 180);
    jest.advanceTimersByTime(100);
    expect(spy).not.toHaveBeenCalled();
  });
});
