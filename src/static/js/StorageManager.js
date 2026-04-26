// ── StorageManager: IndexedDB for heavy project data ─────────────
// Stores full manifest.json files in IndexedDB to avoid localStorage limits
// Only metadata is kept in localStorage for fast sidebar rendering

const DB_NAME = 'DagCityProjects';
const DB_VERSION = 1;
const STORE_NAME = 'projects';
const PROJECTS_METADATA_KEY = 'dagcity_projects_metadata'; // Unified storage key

class StorageManager {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  // Initialize IndexedDB
  async init() {
    if (this.initialized) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        this.initialized = true;
        console.log('[StorageManager] IndexedDB initialized');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
          store.createIndex('name', 'name', { unique: false });
          console.log('[StorageManager] Created object store:', STORE_NAME);
        }
      };
    });
  }

  // Save project data to IndexedDB
  async saveProject(projectData) {
    await this.init();

    const projectId = projectData.metadata?.project_name || projectData.metadata?.name || `project_${Date.now()}`;
    const metadata = {
      id: projectId,
      name: projectData.metadata?.project_name || projectData.metadata?.name || 'Untitled Project',
      lastAccessed: new Date().toISOString(),
      nodeCount: projectData.nodes?.length || 0,
      edgeCount: projectData.links?.length || 0
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put({
        ...metadata,
        data: projectData // Full JSON data
      });

      request.onsuccess = () => {
        console.log('[StorageManager] Project saved:', projectId);
        this.updateLocalStorage();
        resolve(metadata);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Load project data from IndexedDB
  async loadProject(projectId) {
    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(projectId);

      request.onsuccess = () => {
        const project = request.result;
        if (project) {
          // Update last accessed time
          this.updateLastAccessed(projectId);
          console.log('[StorageManager] Project loaded:', projectId);
          resolve(project.data);
        } else {
          reject(new Error('Project not found'));
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Delete project from IndexedDB
  async deleteProject(projectId) {
    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(projectId);

      request.onsuccess = () => {
        console.log('[StorageManager] Project deleted:', projectId);
        this.updateLocalStorage();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Get all projects metadata (from localStorage for speed)
  getProjectsMetadata() {
    const metadata = localStorage.getItem(PROJECTS_METADATA_KEY);
    return metadata ? JSON.parse(metadata) : [];
  }

  // Get all projects directly from IndexedDB (source of truth)
  async getAllProjectsFromDB() {
    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const projects = request.result;
        const metadata = projects.map(p => ({
          id: p.id,
          name: p.name,
          lastAccessed: p.lastAccessed,
          nodeCount: p.nodeCount,
          edgeCount: p.edgeCount
        }));
        console.log('[StorageManager] Retrieved', metadata.length, 'projects from IndexedDB');
        resolve(metadata);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Update localStorage with project metadata
  updateLocalStorage() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const projects = request.result;
        const metadata = projects.map(p => ({
          id: p.id,
          name: p.name,
          lastAccessed: p.lastAccessed,
          nodeCount: p.nodeCount,
          edgeCount: p.edgeCount
        }));
        localStorage.setItem(PROJECTS_METADATA_KEY, JSON.stringify(metadata));
        console.log('[StorageManager] localStorage updated with', metadata.length, 'projects');
        resolve(metadata);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Update last accessed time
  updateLastAccessed(projectId) {
    const transaction = this.db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(projectId);

    request.onsuccess = () => {
      const project = request.result;
      if (project) {
        project.lastAccessed = new Date().toISOString();
        store.put(project);
        this.updateLocalStorage();
      }
    };
  }

  // Clear all projects
  async clearAll() {
    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        localStorage.removeItem(PROJECTS_METADATA_KEY);
        console.log('[StorageManager] All projects cleared');
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }
}

// Export singleton instance
export const storageManager = new StorageManager();
