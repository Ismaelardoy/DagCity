// ── DashboardManager: Connects Dashboard UI with 3D Engine ─────────────
// Handles project management, dropzone, and UI transitions between dashboard and 3D view

import { storageManager } from './StorageManager.js';

class DashboardManager {
  constructor() {
    this.dashboardUI = null;
    this.canvasContainer = null;
    this.currentProject = null;
    this.is3DViewActive = false;
    this.cityEngine = null;
  }

  async selectServerProject(projectName, cardElement) {
    const originalContent = cardElement.innerHTML;
    cardElement.innerHTML = `
      <div style="color: #fff; font-weight: 600; display: flex; align-items: center; gap: 8px;">
        <span style="animation: spin 1s linear infinite;">⏳</span>
        Cargando...
      </div>
      <style>@keyframes spin { 100% { transform: rotate(360deg); } }</style>
    `;
    cardElement.style.pointerEvents = 'none';

    try {
      console.log('[DashboardManager] Loading server project:', projectName);
      const res = await fetch('/api/projects/' + encodeURIComponent(projectName));
      if (!res.ok) throw new Error('Not found');
      const projectData = await res.json();

      this.currentProject = projectData;
      this.hideDashboard();

      if (this.cityEngine && typeof this.cityEngine.rebuildCity === 'function') {
        this.cityEngine.rebuildCity(projectData);
      } else {
        window.__PENDING_PROJECT_DATA__ = projectData;
      }

      this.is3DViewActive = true;
      this.addBackToMenuButton();
      console.log('[DashboardManager] Server project loaded, 3D view active');
    } catch (error) {
      console.error('[DashboardManager] Error loading server project:', error);
      cardElement.innerHTML = originalContent;
      cardElement.style.pointerEvents = 'auto';
      alert('Error loading project: ' + error.message);
    }
  }

  // Initialize dashboard manager
  async init(cityEngine) {
    this.cityEngine = cityEngine;
    this.dashboardUI = document.getElementById('awaiting-overlay');
    this.canvasContainer = document.getElementById('canvas-container');

    if (!this.dashboardUI || !this.canvasContainer) {
      console.error('[DashboardManager] Required UI elements not found');
      return;
    }

    // Initialize dropzone
    this.initDropzone();

    // Render project list from localStorage (async)
    await this.renderProjectList();

    // Check if there's data to show immediately (from window.__RAW__)
    if (window.__RAW__) {
      this.showDashboard();
    } else {
      // If no data, show dashboard for file upload
      this.showDashboard();
    }

    console.log('[DashboardManager] Initialized');
  }

  // Render project list from localStorage
  async renderProjectList() {
    console.log('[DashboardManager] renderProjectList called');
    
    // Find project-list container in the dashboard hub grid
    let sidebarContent = document.getElementById('project-list');
    
    console.log('[DashboardManager] project-list element found:', !!sidebarContent);
    
    // If not found, try fallback to sb-content (for compatibility)
    if (!sidebarContent) {
      sidebarContent = document.getElementById('sb-content');
      console.log('[DashboardManager] sb-content element found:', !!sidebarContent);
    }
    
    // If still not found, try to find it in the sidebar (fallback for 3D view)
    if (!sidebarContent) {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) {
        sidebarContent = document.createElement('div');
        sidebarContent.id = 'project-list';
        sidebarContent.className = 'project-list';
        sidebar.querySelector('#sb-inner').appendChild(sidebarContent);
        console.log('[DashboardManager] Created project-list in sidebar');
      }
    }
    
    if (!sidebarContent) {
      console.error('[DashboardManager] Project list container not found - aborting');
      return;
    }

    console.log('[DashboardManager] Reading projects from IndexedDB directly (source of truth)');

    try {
      // Read directly from IndexedDB (source of truth) instead of localStorage
      await storageManager.init();
      let projects = await storageManager.getAllProjectsFromDB();

      // Fallback: if IndexedDB is empty, pull saved projects from backend API
      if (!projects.length) {
        try {
          const resp = await fetch('/api/projects');
          if (resp.ok) {
            const serverProjects = await resp.json();
            projects = (Array.isArray(serverProjects) ? serverProjects : []).map((p) => ({
              id: p.name,
              name: p.name,
              lastAccessed: p.created_at || new Date().toISOString(),
              nodeCount: p.node_count || 0,
              edgeCount: p.link_count || 0,
              sourceType: 'server',
              source: p.source || 'offline',
              wasLiveSync: !!p.was_live_sync,
            }));
            console.log('[DashboardManager] IndexedDB empty, using server projects:', projects.length, projects);
          }
        } catch (apiErr) {
          console.warn('[DashboardManager] /api/projects fallback failed:', apiErr);
        }
      }

      projects = projects.map((p) => ({ ...p, sourceType: p.sourceType || 'indexeddb' }));
      console.log('[DashboardManager] Projects found (final):', projects.length, projects);

      // Clear existing content
      sidebarContent.innerHTML = '';

      // Empty state
      if (projects.length === 0) {
        sidebarContent.innerHTML = `
          <div style="color: rgba(255,255,255,0.5); padding: 20px; text-align: center; line-height: 1.6;">
            No hay proyectos guardados aún.<br>
            Arrastra un manifest.json para empezar.
          </div>
        `;
        console.log('[DashboardManager] Empty state rendered');
        return;
      }

      // Sort by last accessed
      projects.sort((a, b) => new Date(b.lastAccessed) - new Date(a.lastAccessed));

      // Render project cards
      projects.forEach((project, index) => {
        console.log(`[DashboardManager] Rendering project ${index}:`, project.name);
        
        const card = document.createElement('div');
        card.className = 'project-card';
        card.style.cssText = `
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(30, 30, 40, 0.8);
          border: 1px solid rgba(0, 243, 255, 0.25);
          border-radius: 8px;
          padding: 12px 16px;
          margin-bottom: 8px;
          cursor: pointer;
          transition: all 0.2s;
          backdrop-filter: blur(10px);
        `;
        card.innerHTML = `
          <div class="project-card-info" style="flex: 1; min-width: 0;">
            <div class="project-card-name" style="color: #fff; font-weight: 600; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${project.name}
              ${project.source === 'live_sync' || project.source === 'local_sync'
                ? '<span style="margin-left:8px;color:#39ff14;font-size:10px;letter-spacing:1px;border:1px solid rgba(57,255,20,0.45);border-radius:10px;padding:2px 6px;vertical-align:middle;">LIVE SYNC</span>'
                : (project.source === 'offline' && project.wasLiveSync
                  ? '<span style="margin-left:8px;color:#ffb347;font-size:10px;letter-spacing:1px;border:1px solid rgba(255,179,71,0.45);border-radius:10px;padding:2px 6px;vertical-align:middle;">LIVE (SNAPSHOT)</span>'
                  : '')}
            </div>
            <div class="project-card-meta" style="color: rgba(255,255,255,0.6); font-size: 11px;">
              ${project.nodeCount} nodes · ${project.edgeCount} edges
            </div>
            <div class="project-card-meta" style="color: rgba(255,255,255,0.4); font-size: 10px; margin-top: 2px;">
              ${new Date(project.lastAccessed).toLocaleString()}
            </div>
          </div>
        `;
        
        // Hover effects
        card.addEventListener('mouseenter', () => {
          card.style.background = 'rgba(40, 40, 55, 0.9)';
          card.style.borderColor = 'rgba(0, 243, 255, 0.5)';
        });
        card.addEventListener('mouseleave', () => {
          card.style.background = 'rgba(30, 30, 40, 0.8)';
          card.style.borderColor = 'rgba(0, 243, 255, 0.25)';
        });

        // Click handler for project selection
        card.addEventListener('click', () => {
          if (project.sourceType === 'server') {
            this.selectServerProject(project.id, card);
            return;
          }
          this.selectProject(project.id, card);
        });

        // Add delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '🗑️';
        deleteBtn.style.cssText = `
          background: transparent;
          border: none;
          color: rgba(255, 68, 48, 0.6);
          cursor: pointer;
          font-size: 14px;
          padding: 4px 8px;
          margin-left: 8px;
          transition: color 0.2s;
        `;
        deleteBtn.addEventListener('mouseenter', () => {
          deleteBtn.style.color = 'rgba(255, 68, 48, 1.0)';
        });
        deleteBtn.addEventListener('mouseleave', () => {
          deleteBtn.style.color = 'rgba(255, 68, 48, 0.6)';
        });
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // CRITICAL: Prevent opening project when deleting
          if (project.sourceType === 'server') {
            this.deleteServerProject(project.id);
            return;
          }
          this.deleteProject(project.id);
        });
        card.appendChild(deleteBtn);

        sidebarContent.appendChild(card);
      });

      console.log('[DashboardManager] Rendered', projects.length, 'project cards successfully');

    } catch (error) {
      console.error('[DashboardManager] Error rendering project list:', error);
      sidebarContent.innerHTML = `
        <div style="color: rgba(255, 68, 48, 0.8); padding: 20px; text-align: center;">
          Error loading projects: ${error.message}
        </div>
      `;
    }
  }

  // Select and load a project from sidebar
  async selectProject(projectId, cardElement) {
    // Show loading indicator
    const originalContent = cardElement.innerHTML;
    cardElement.innerHTML = `
      <div style="color: #fff; font-weight: 600; display: flex; align-items: center; gap: 8px;">
        <span style="animation: spin 1s linear infinite;">⏳</span>
        Cargando...
      </div>
      <style>@keyframes spin { 100% { transform: rotate(360deg); } }</style>
    `;
    cardElement.style.pointerEvents = 'none';

    try {
      console.log('[DashboardManager] Loading project:', projectId);

      // Load project data from IndexedDB
      const projectData = await storageManager.loadProject(projectId);
      this.currentProject = projectData;

      // Hide dashboard UI with fade out
      this.hideDashboard();

      // Initialize 3D engine with project data
      if (this.cityEngine && typeof this.cityEngine.rebuildCity === 'function') {
        this.cityEngine.rebuildCity(projectData);
      } else {
        // If cityEngine not ready, store data for later initialization
        window.__PENDING_PROJECT_DATA__ = projectData;
      }

      this.is3DViewActive = true;
      
      // Add back to menu button
      this.addBackToMenuButton();

      console.log('[DashboardManager] Project loaded, 3D view active');

    } catch (error) {
      console.error('[DashboardManager] Error loading project:', error);
      
      // Restore card and show error
      cardElement.innerHTML = originalContent;
      cardElement.style.pointerEvents = 'auto';
      alert('Error loading project: ' + error.message);
    }
  }

  // Initialize dropzone for file upload
  initDropzone() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('manifest-upload');

    if (!dropZone) {
      console.error('[DashboardManager] Dropzone element not found');
      return;
    }

    // Create file input if it doesn't exist
    if (!fileInput) {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'manifest-upload';
      input.accept = '.json';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', (e) => this.handleFileUpload(e.target.files[0]));
    }

    // Set up drag and drop handlers
    window.dzDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('dz-hover');
    };

    window.dzDragLeave = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dz-hover');
    };

    window.dzDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dz-hover');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        this.handleFileUpload(files[0]);
      }
    };
  }

  // Handle file upload from dropzone or file picker
  async handleFileUpload(file) {
    if (!file) return;

    try {
      // Read and parse JSON
      const text = await file.text();
      const projectData = JSON.parse(text);

      // Validate project data
      if (!projectData.nodes || !projectData.metadata) {
        throw new Error('Invalid manifest.json format');
      }

      console.log('[DashboardManager] File uploaded:', file.name);
      console.log('[DashboardManager] Project nodes:', projectData.nodes.length);

      // Save to IndexedDB
      const metadata = await storageManager.saveProject(projectData);
      console.log('[DashboardManager] Project saved to IndexedDB:', metadata);

      // Update sidebar
      this.renderProjectList();

      // Open the project
      this.selectProject(metadata.id, document.querySelector('.project-card:last-child'));

    } catch (error) {
      console.error('[DashboardManager] Error uploading file:', error);
      alert('Error uploading file: ' + error.message);
    }
  }

  // Delete a project
  async deleteProject(projectId) {
    if (!confirm('Are you sure you want to delete this project?')) return;

    try {
      await storageManager.deleteProject(projectId);
      this.renderProjectList();
      console.log('[DashboardManager] Project deleted:', projectId);
    } catch (error) {
      console.error('[DashboardManager] Error deleting project:', error);
      alert('Error deleting project: ' + error.message);
    }
  }

  async deleteServerProject(projectName) {
    if (!confirm(`Are you sure you want to delete the project '${projectName}'?`)) return;

    try {
      await fetch('/api/projects/' + encodeURIComponent(projectName), { method: 'DELETE' });
      await this.renderProjectList();
      console.log('[DashboardManager] Server project deleted:', projectName);
    } catch (error) {
      console.error('[DashboardManager] Error deleting server project:', error);
      alert('Error deleting project: ' + error.message);
    }
  }

  // Show dashboard UI
  showDashboard() {
    if (this.dashboardUI) {
      this.dashboardUI.style.display = 'flex';
      this.dashboardUI.style.opacity = '0';
      setTimeout(() => {
        this.dashboardUI.style.opacity = '1';
      }, 10);
    }
    this.is3DViewActive = false;
    // Hide the 3D-only IDE dock (left sidebar) on the initial menu.
    this._setDockVisible(false);
  }

  // Hide dashboard UI
  hideDashboard() {
    if (this.dashboardUI) {
      this.dashboardUI.style.opacity = '0';
      setTimeout(() => {
        this.dashboardUI.style.display = 'none';
      }, 300);
    }
    // Reveal the IDE dock once we enter the 3D view.
    this._setDockVisible(true);
  }

  _setDockVisible(visible) {
    const dock = document.getElementById('ide-dock');
    if (dock) {
      dock.style.display = visible ? 'block' : 'none';
      console.log('[DashboardManager] Dock visibility set to:', visible, 'display:', dock.style.display);
    } else {
      console.error('[DashboardManager] Dock element not found');
    }
  }

  // Return to dashboard from 3D view
  returnToDashboard() {
    console.log('[DashboardManager] Returning to dashboard');

    // Dispose 3D engine to free memory
    if (this.cityEngine && typeof this.cityEngine.dispose === 'function') {
      this.cityEngine.dispose();
    } else {
      // Manual cleanup if dispose not available
      if (this.cityEngine && typeof this.cityEngine.clearScene === 'function') {
        this.cityEngine.clearScene();
      }
    }

    this.currentProject = null;
    this.is3DViewActive = false;

    // Reset transient UI state (especially important after Live Sync sessions)
    // without affecting persisted normal project data.
    localStorage.removeItem('dagcity_is_live');
    localStorage.removeItem('dagcity_live_sync_session');

    const sidebar = document.getElementById('sidebar');
    const sbContent = document.getElementById('sb-content');
    if (sidebar) sidebar.classList.remove('open');
    if (sbContent) sbContent.innerHTML = '';

    const jumpPanel = document.getElementById('global-island-jump-panel');
    if (jumpPanel) jumpPanel.classList.remove('open');

    // Remove back to menu button
    this.removeBackToMenuButton();

    // Show dashboard UI
    this.showDashboard();

    // Refresh project sidebar
    this.renderProjectList();
  }

  // Add back to menu button in 3D view
  addBackToMenuButton() {
    if (document.getElementById('back-to-menu')) return;

    const btn = document.createElement('button');
    btn.id = 'back-to-menu';
    btn.textContent = '← Back to Menu';
    btn.title = 'Return to project dashboard';
    // Positioned to the LEFT of the Pipeline View button (which sits at right:70px).
    // Original left:18px was hidden behind the OS taskbar on some setups.
    btn.style.cssText = `
      position: fixed;
      top: 18px;
      right: 130px;
      z-index: 260;
      padding: 10px 16px;
      border-radius: 8px;
      border: 1px solid rgba(0, 243, 255, 0.4);
      background: rgba(6, 14, 24, 0.85);
      color: #fff;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
    `;
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(0, 243, 255, 0.2)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(6, 14, 24, 0.85)';
    });
    btn.addEventListener('click', () => this.returnToDashboard());

    document.body.appendChild(btn);
  }

  // Remove back to menu button
  removeBackToMenuButton() {
    const btn = document.getElementById('back-to-menu');
    if (btn) btn.remove();
  }
}

// Export singleton instance
export const dashboardManager = new DashboardManager();
