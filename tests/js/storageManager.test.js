// ─────────────────────────────────────────────────────────────────
// storageManager.test.js — Unit tests for StorageManager IndexedDB logic
// Uses fake-indexeddb to simulate browser storage environment
// Runner: Jest (jsdom environment)
// ─────────────────────────────────────────────────────────────────
const { IDBFactory } = require('fake-indexeddb');

// ── Inline StorageManager (matches StorageManager.js logic) ──────

const DB_NAME = 'DagCityProjects';
const DB_VERSION = 1;
const STORE_NAME = 'projects';
const PROJECTS_METADATA_KEY = 'dagcity_projects_metadata';

class StorageManager {
  constructor(idbFactory) {
    this.db = null;
    this.initialized = false;
    this._idb = idbFactory || indexedDB;
  }

  async init() {
    if (this.initialized) return this.db;
    return new Promise((resolve, reject) => {
      const request = this._idb.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        this.initialized = true;
        resolve(this.db);
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
          store.createIndex('name', 'name', { unique: false });
        }
      };
    });
  }

  async saveProject(projectData) {
    await this.init();
    const projectId = projectData.metadata?.project_name || `project_${Date.now()}`;
    const metadata = {
      id: projectId,
      name: projectData.metadata?.project_name || 'Untitled',
      lastAccessed: new Date().toISOString(),
      nodeCount: projectData.nodes?.length || 0,
      edgeCount: projectData.links?.length || 0,
    };
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({ ...metadata, data: projectData });
      req.onsuccess = () => resolve(metadata);
      req.onerror = () => reject(req.error);
    });
  }

  async loadProject(projectId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(projectId);
      req.onsuccess = () => {
        if (req.result) resolve(req.result.data);
        else reject(new Error('Project not found'));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deleteProject(projectId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(projectId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getAllProjectsFromDB() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        resolve(req.result.map(p => ({
          id: p.id, name: p.name,
          lastAccessed: p.lastAccessed,
          nodeCount: p.nodeCount, edgeCount: p.edgeCount,
        })));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async clearAll() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

// ── Sample data ───────────────────────────────────────────────────

const SAMPLE_PROJECT = {
  metadata: { project_name: 'test_project', generated_at: '2024-01-01T00:00:00Z' },
  nodes: [{ id: 'model.tp.stg_a', name: 'stg_a' }],
  links: [],
};

// ── Tests ─────────────────────────────────────────────────────────

describe('StorageManager — init', () => {
  test('initializes without throwing', async () => {
    const sm = new StorageManager(new IDBFactory());
    await expect(sm.init()).resolves.toBeDefined();
  });

  test('is idempotent: double init does not throw', async () => {
    const sm = new StorageManager(new IDBFactory());
    await sm.init();
    await expect(sm.init()).resolves.toBeDefined();
  });
});

describe('StorageManager — saveProject()', () => {
  let sm;
  beforeEach(() => { sm = new StorageManager(new IDBFactory()); });

  test('saves and returns metadata', async () => {
    const meta = await sm.saveProject(SAMPLE_PROJECT);
    expect(meta.id).toBe('test_project');
    expect(meta.name).toBe('test_project');
  });

  test('nodeCount reflects number of nodes', async () => {
    const meta = await sm.saveProject(SAMPLE_PROJECT);
    expect(meta.nodeCount).toBe(1);
  });

  test('edgeCount reflects number of links', async () => {
    const meta = await sm.saveProject(SAMPLE_PROJECT);
    expect(meta.edgeCount).toBe(0);
  });

  test('lastAccessed is a valid ISO date string', async () => {
    const meta = await sm.saveProject(SAMPLE_PROJECT);
    expect(() => new Date(meta.lastAccessed)).not.toThrow();
    expect(isNaN(new Date(meta.lastAccessed).getTime())).toBe(false);
  });

  test('overwrites project on duplicate save', async () => {
    await sm.saveProject(SAMPLE_PROJECT);
    const updated = { ...SAMPLE_PROJECT, nodes: [...SAMPLE_PROJECT.nodes, { id: 'b' }] };
    const meta = await sm.saveProject(updated);
    expect(meta.nodeCount).toBe(2);
  });
});

describe('StorageManager — loadProject()', () => {
  let sm;
  beforeEach(() => { sm = new StorageManager(new IDBFactory()); });

  test('loads saved project data', async () => {
    await sm.saveProject(SAMPLE_PROJECT);
    const data = await sm.loadProject('test_project');
    expect(data.metadata.project_name).toBe('test_project');
  });

  test('throws for non-existent project', async () => {
    await sm.init();
    await expect(sm.loadProject('ghost')).rejects.toThrow('Project not found');
  });

  test('returned data has nodes array', async () => {
    await sm.saveProject(SAMPLE_PROJECT);
    const data = await sm.loadProject('test_project');
    expect(Array.isArray(data.nodes)).toBe(true);
  });
});

describe('StorageManager — deleteProject()', () => {
  let sm;
  beforeEach(() => { sm = new StorageManager(new IDBFactory()); });

  test('delete resolves without error', async () => {
    await sm.saveProject(SAMPLE_PROJECT);
    await expect(sm.deleteProject('test_project')).resolves.toBeUndefined();
  });

  test('project not accessible after delete', async () => {
    await sm.saveProject(SAMPLE_PROJECT);
    await sm.deleteProject('test_project');
    await expect(sm.loadProject('test_project')).rejects.toThrow();
  });
});

describe('StorageManager — getAllProjectsFromDB()', () => {
  let sm;
  beforeEach(() => { sm = new StorageManager(new IDBFactory()); });

  test('returns empty array when no projects', async () => {
    const projects = await sm.getAllProjectsFromDB();
    expect(projects).toEqual([]);
  });

  test('returns metadata for saved project', async () => {
    await sm.saveProject(SAMPLE_PROJECT);
    const projects = await sm.getAllProjectsFromDB();
    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe('test_project');
  });

  test('returns metadata shape with required fields', async () => {
    await sm.saveProject(SAMPLE_PROJECT);
    const [p] = await sm.getAllProjectsFromDB();
    expect(p).toHaveProperty('id');
    expect(p).toHaveProperty('name');
    expect(p).toHaveProperty('lastAccessed');
    expect(p).toHaveProperty('nodeCount');
    expect(p).toHaveProperty('edgeCount');
  });
});

describe('StorageManager — clearAll()', () => {
  let sm;
  beforeEach(() => { sm = new StorageManager(new IDBFactory()); });

  test('clears all saved projects', async () => {
    await sm.saveProject(SAMPLE_PROJECT);
    await sm.clearAll();
    const projects = await sm.getAllProjectsFromDB();
    expect(projects).toHaveLength(0);
  });

  test('resolve without error on empty store', async () => {
    await expect(sm.clearAll()).resolves.toBeUndefined();
  });
});
