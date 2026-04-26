import os
import sys
import json
import shutil
import asyncio
from datetime import datetime
from typing import Dict, Any, Optional
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles

# Local imports
import core.config as config
from core.config import PORT, VIZ_DIR, PROJECTS_DIR, WORKSPACE_PATH, is_live_sync_available
from core.parser import ManifestParser
from core.generator import VizGenerator
from core.watcher import ManifestWatcher
from core.router_projects import router as projects_router
from core.streamer import router as streamer_router, watcher_instance


def _get_workspace_active_project() -> Optional[str]:
    if os.path.exists(WORKSPACE_PATH):
        try:
            with open(WORKSPACE_PATH) as f:
                return json.load(f).get("active_project")
        except: pass
    return None

def _set_workspace_active_project(name: str):
    try:
        with open(WORKSPACE_PATH, "w") as f:
            json.dump({"active_project": name}, f)
    except: pass

def _current_live_project_name() -> Optional[str]:
    if not is_live_sync_available():
        return None
    try:
        with open(config.EXTERNAL_MANIFEST_PATH) as f:
            manifest = json.load(f)
        name = manifest.get("metadata", {}).get("project_name")
        if not isinstance(name, str) or not name.strip():
            return None
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name.strip())
        return safe[:64]
    except Exception:
        return None

def _is_project_startup_loadable(project_name: str) -> bool:
    meta_path = os.path.join(PROJECTS_DIR, project_name, "meta.json")
    if not os.path.exists(meta_path):
        return True
    try:
        with open(meta_path) as f:
            meta = json.load(f)
    except Exception:
        return True
    if meta.get("source") != "live_sync":
        return True
    current_live = _current_live_project_name()
    return bool(current_live and current_live == project_name)

app = FastAPI(title="DagCity API", version="1.0")

# Register modular routers
app.include_router(projects_router)
app.include_router(streamer_router)

# Globals for orchestration
viz = VizGenerator()
watcher: Optional[ManifestWatcher] = None

def _get_current_graph() -> Dict:
    """Helper to get the most recent graph data from disk. 
    Always returns empty if no active project is set, to force the UI Landing screen."""
    return _build_empty_graph()

def _build_empty_graph() -> dict:
    return {
        "status": "awaiting_upload",
        "metadata": {
            "generated_at": None,
            "has_real_times": False,
            "total_exec_time": 0,
            "avg_exec_time": 0,
        },
        "nodes": [],
        "links": [],
    }

def _autodiscover_project_name(manifest_dict: dict) -> str:
    """Zero-friction project naming."""
    try:
        name = manifest_dict.get("metadata", {}).get("project_name")
        if name and isinstance(name, str) and name.strip():
            safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name.strip())
            return safe[:64]
    except Exception: pass
    return f"Project_{datetime.now().strftime('%Y%m%d_%H%M')}"

# ── Core Routes ──────────────────────────────────────────────────────

@app.get("/api/status")
async def get_status():
    """Reports the server status and Live Sync availability."""
    return {
        "version": "1.0",
        "live_sync_available": is_live_sync_available(),
        "external_path": config.EXTERNAL_MANIFEST_PATH if is_live_sync_available() else None,
        "projects_count": len(os.listdir(PROJECTS_DIR)) if os.path.exists(PROJECTS_DIR) else 0
    }

@app.get("/api/check-local")
async def check_local():
    """One-Click Live Sync: checks if manifest.json is present at the mounted volume path."""
    if is_live_sync_available():
        return {"status": "ready", "path": config.EXTERNAL_MANIFEST_PATH}
    return {"status": "missing", "path": config.EXTERNAL_MANIFEST_PATH}

@app.post("/api/launch-local")
async def launch_local():
    """One-Click Live Sync: parses external manifest and PERSISTS it internally so SLAs/Configs work."""
    if not is_live_sync_available():
        raise HTTPException(status_code=404, detail="No manifest found at volume path")
    try:
        # 1. Parse from external volume
        # Check for run_results.json in the same target folder
        run_results_path = config.EXTERNAL_MANIFEST_PATH.replace("manifest.json", "run_results.json")
        rr_dict = None
        if os.path.exists(run_results_path):
            with open(run_results_path) as f: rr_dict = json.load(f)
        
        with open(config.EXTERNAL_MANIFEST_PATH) as f: m_dict = json.load(f)
        
        parser = ManifestParser(config.EXTERNAL_MANIFEST_PATH)
        graph_data = parser.parse()
        
        # 2. Auto-persist internally so we can save SLAs etc.
        project_name = _autodiscover_project_name(m_dict)
        
        # Check for collisions and increment name if needed (to avoid overwriting snapshots)
        base_name = project_name
        counter = 1
        while os.path.exists(os.path.join(PROJECTS_DIR, project_name)):
            # If it's already a live_sync project, we might want to overwrite it 
            # but to be safe and match user expectation of "creating" a project, let's increment
            # unless it's the EXACT same project name and source.
            meta_path = os.path.join(PROJECTS_DIR, project_name, "meta.json")
            if os.path.exists(meta_path):
                with open(meta_path) as f:
                    old_meta = json.load(f)
                    if old_meta.get("source") == "live_sync":
                        break # Overwrite existing live sync project of same name
            
            project_name = f"{base_name}_{counter}"
            counter += 1

        project_dir = os.path.join(PROJECTS_DIR, project_name)
        os.makedirs(project_dir, exist_ok=True)
        
        # Save graph for immediate UI use
        with open(os.path.join(project_dir, "graph.json"), "w") as f:
            json.dump(graph_data, f)
            
        # Also save the source manifest for full persistence
        with open(os.path.join(project_dir, "manifest.json"), "w") as f:
            json.dump(m_dict, f)
            
        if rr_dict:
            with open(os.path.join(project_dir, "run_results.json"), "w") as f:
                json.dump(rr_dict, f)

        # Save metadata for Project Manager
        with open(os.path.join(project_dir, "meta.json"), "w") as f:
            json.dump({
                "node_count": len(graph_data.get("nodes", [])),
                "created_at": datetime.now().isoformat(),
                "source": "live_sync",
                "original_path": config.EXTERNAL_MANIFEST_PATH
            }, f)
            
        _set_workspace_active_project(project_name)
            
        return {**graph_data, "project": project_name, "is_live": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/", response_class=HTMLResponse)
async def read_index():

    index_path = os.path.join(VIZ_DIR, "index.html")
    if not os.path.exists(index_path):
        graph = _get_current_graph()
        viz.generate(graph, index_path)
    return FileResponse(index_path)

@app.post("/api/upload")
async def upload_data(request: Request):
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    manifest_dict = payload.get('manifest')
    run_results_dict = payload.get('run_results')
    project_name = payload.get('project_name', '').strip()

    if not manifest_dict:
        raise HTTPException(status_code=400, detail="Missing 'manifest' key")

    try:
        graph_data = ManifestParser.parse_from_dict(
            manifest_dict,
            run_results_dict=run_results_dict,
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=str(e))

    if not project_name:
        project_name = _autodiscover_project_name(manifest_dict)

    base_name = project_name
    counter = 1
    while os.path.exists(os.path.join(PROJECTS_DIR, project_name)):
        project_name = f"{base_name}_{counter}"
        counter += 1

    project_dir = os.path.join(PROJECTS_DIR, project_name)
    os.makedirs(project_dir, exist_ok=True)

    with open(os.path.join(project_dir, "manifest.json"), "w") as f:
        json.dump(manifest_dict, f)
    if run_results_dict:
        with open(os.path.join(project_dir, "run_results.json"), "w") as f:
            json.dump(run_results_dict, f)
    with open(os.path.join(project_dir, "graph.json"), "w") as f:
        json.dump(graph_data, f)
    
    meta = {
        "node_count": len(graph_data.get("nodes", [])), 
        "created_at": datetime.now().isoformat(),
        "source": "offline"
    }
    with open(os.path.join(project_dir, "meta.json"), "w") as f:
        json.dump(meta, f)

    print(f"[+] Saved project '{project_name}' to {project_dir}")
    _set_workspace_active_project(project_name)
    return {**graph_data, "saved": True, "project": project_name}

# ── Startup & Static Assets ───────────────────────────────────────────
BUILD_ID = datetime.now().strftime("%Y%m%d%H%M%S")

# Sync static assets before mounting
_STATIC_SRC = os.path.join(os.path.dirname(__file__), 'static')
_STATIC_DST = os.path.join(VIZ_DIR, 'static')
if os.path.isdir(_STATIC_SRC):
    if os.path.exists(_STATIC_DST):
        shutil.rmtree(_STATIC_DST)
    shutil.copytree(_STATIC_SRC, _STATIC_DST)
os.makedirs(_STATIC_DST, exist_ok=True)

# Static mount point
app.mount("/static", StaticFiles(directory=_STATIC_DST), name="static")

# Disable browser caching for /static so JS edits show up on refresh
@app.middleware("http")
async def _no_cache_static(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

@app.on_event("startup")
async def startup_event():
    import core.streamer as streamer
    print("--- DAG CITY v1.0: PERSISTENT WORKSPACE ---")
    
    active_project = _get_workspace_active_project()
    graph_data = None
    
    if active_project:
        graph_path = os.path.join(PROJECTS_DIR, active_project, "graph.json")
        if os.path.exists(graph_path) and _is_project_startup_loadable(active_project):
            print(f"[*] Auto-loading last active project: {active_project}")
            with open(graph_path) as f:
                graph_data = json.load(f)
            sla_path = os.path.join(PROJECTS_DIR, active_project, "sla.json")
            if os.path.exists(sla_path):
                with open(sla_path) as f:
                    graph_data["_sla"] = json.load(f)
        else:
            _set_workspace_active_project(None)
    
    if not graph_data:
        graph_data = _get_current_graph()

    viz_file = os.path.join(VIZ_DIR, "index.html")
    # Force regeneration on every boot
    viz.generate(graph_data, viz_file, build_id=BUILD_ID)
    print(f"[+] Visualization ready at {viz_file}")

    loop = asyncio.get_running_loop()
    
    # 3. Initialize Live Sync (Volume Watcher)
    if is_live_sync_available():
        watch_root = os.path.dirname(config.EXTERNAL_MANIFEST_PATH)
        watch_recursive = False
    else:
        watch_root = PROJECTS_DIR
        watch_recursive = True

    watcher_obj = ManifestWatcher(watch_root, loop)
    watcher_obj.start(recursive=watch_recursive)
    
    streamer.watcher_instance = watcher_obj
    if is_live_sync_available():
        print(f"[+] Live Sync ACTIVE. Watching external volume: {config.EXTERNAL_MANIFEST_PATH}")
    else:
        print(f"[+] Live Sync IDLE (No volume discovered). Watching internal store: {PROJECTS_DIR}")



@app.on_event("shutdown")
def shutdown_event():
    import core.streamer as streamer
    if streamer.watcher_instance:
        streamer.watcher_instance.stop()

# Static mount point with safety check
static_path = os.path.join(VIZ_DIR, "static")
os.makedirs(static_path, exist_ok=True)
print(f"[DEBUG] Mounting static files from: {static_path}")
app.mount("/static", StaticFiles(directory=static_path), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
