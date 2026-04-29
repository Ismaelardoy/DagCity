import os
import json
import shutil
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
import core.config as config
from core.config import PROJECTS_DIR, WORKSPACE_PATH, is_live_sync_available
from core.parser import ManifestParser

router = APIRouter(prefix="/api/projects", tags=["projects"])

def _set_workspace_active_project(name: str):
    try:
        with open(WORKSPACE_PATH, "w") as f:
            json.dump({"active_project": name}, f)
    except: pass

def _sanitize_project_name(name: str) -> str:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in (name or "").strip())
    return safe[:64]

def _current_live_project_name() -> Optional[str]:
    if not is_live_sync_available():
        return None
    try:
        with open(config.EXTERNAL_MANIFEST_PATH) as f:
            manifest = json.load(f)
        meta_name = manifest.get("metadata", {}).get("project_name")
        if not isinstance(meta_name, str) or not meta_name.strip():
            return None
        return _sanitize_project_name(meta_name)
    except Exception:
        return None

def _is_live_project_enabled(project_name: str, meta: dict) -> bool:
    if meta.get("source") != "live_sync":
        return True
    current_live = _current_live_project_name()
    if not current_live:
        return False
    return project_name == current_live

def _downgrade_stale_live_project(project_dir: str, project_name: str, meta: dict) -> dict:
    """Convert stale live project into an offline snapshot while preserving files."""
    if meta.get("source") != "live_sync":
        return meta
    if _is_live_project_enabled(project_name, meta):
        return meta

    updated = dict(meta)
    updated["source"] = "offline"
    updated["was_live_sync"] = True
    updated["live_sync_inactive_reason"] = "Live source changed or unavailable"
    updated["last_live_source_path"] = meta.get("original_path")

    try:
        meta_path = os.path.join(project_dir, "meta.json")
        with open(meta_path, "w") as f:
            json.dump(updated, f, indent=2)
    except Exception:
        pass
    return updated

@router.get("")
async def list_projects():
    """Returns list of saved projects with metadata."""
    projects = []
    if not os.path.isdir(PROJECTS_DIR):
        return []
    for name in sorted(os.listdir(PROJECTS_DIR)):
        project_dir = os.path.join(PROJECTS_DIR, name)
        if not os.path.isdir(project_dir):
            continue
        graph_path = os.path.join(project_dir, "graph.json")
        if not os.path.exists(graph_path):
            continue
        meta_path = os.path.join(project_dir, "meta.json")
        meta = {}
        try:
            if os.path.exists(meta_path):
                with open(meta_path) as f:
                    meta = json.load(f)

            meta = _downgrade_stale_live_project(project_dir, name, meta)

            disabled = not _is_live_project_enabled(name, meta)
            reason = ""
            if disabled and meta.get("source") == "live_sync":
                reason = "Live source changed or unavailable"

            projects.append({
                "name": name,
                "node_count": meta.get("node_count", 0),
                "created_at": meta.get("created_at", ""),
                "source": meta.get("source", "offline"),
                "disabled": disabled,
                "disabled_reason": reason,
            })
        except Exception as e:
            print(f"[ERROR] Failed to load project metadata for {name}: {e}")
            # Skip corrupted project
            continue
    return projects

@router.get("/{name}")
async def get_project(name: str):
    """Returns the full graph JSON for a saved project, including its SLA config."""
    graph_path = os.path.join(PROJECTS_DIR, name, "graph.json")
    if not os.path.exists(graph_path):
        raise HTTPException(status_code=404, detail=f"Project '{name}' not found")
    # Bypass cache if it's the live project
    meta_path = os.path.join(PROJECTS_DIR, name, "meta.json")
    is_live = False
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            meta = json.load(f)
            is_live = meta.get("source") == "live_sync"

    meta = _downgrade_stale_live_project(os.path.join(PROJECTS_DIR, name), name, meta)
    is_live = meta.get("source") == "live_sync"

    if is_live and not _is_live_project_enabled(name, meta):
        raise HTTPException(status_code=423, detail="Live Sync project is inactive (source changed).")
            
    if is_live and is_live_sync_available():
        try:
            parser = ManifestParser(config.EXTERNAL_MANIFEST_PATH)
            data = parser.parse()
        except Exception as e:
            # Fallback to cached version if parsing fails
            with open(graph_path) as f:
                data = json.load(f)
    else:
        with open(graph_path) as f:
            data = json.load(f)

    # Guarantee source metadata for frontend HUD label consistency.
    # graph.json may not always carry source, but meta.json is the source of truth.
    if not isinstance(data.get("metadata"), dict):
        data["metadata"] = {}
    data["metadata"]["source"] = meta.get("source", "offline")
    if meta.get("source") == "offline" and meta.get("was_live_sync"):
        data["metadata"]["sync_source"] = "live_snapshot"
    else:
        data["metadata"]["sync_source"] = data["metadata"]["source"]
            
    # Attach saved SLA config if it exists
    sla_path = os.path.join(PROJECTS_DIR, name, "sla.json")
    if os.path.exists(sla_path):
        with open(sla_path) as f:
            data["_sla"] = json.load(f)
    
    _set_workspace_active_project(name) # Mark as active on access
    return data

@router.patch("/{name}/sla")
async def save_project_sla(name: str, request: Request):
    """Saves the SLA configuration for a project persistently."""
    project_dir = os.path.join(PROJECTS_DIR, name)
    if not os.path.isdir(project_dir):
        raise HTTPException(status_code=404, detail=f"Project '{name}' not found")
    body = await request.json()
    sla_path = os.path.join(project_dir, "sla.json")
    with open(sla_path, "w") as f:
        json.dump(body, f, indent=2)
    return {"saved": True}

@router.patch("/{name}/rename")
async def rename_project(name: str, request: Request):
    """Renames a project folder."""
    body = await request.json()
    new_name = body.get("new_name", "").strip()
    if not new_name:
        raise HTTPException(status_code=400, detail="new_name is required")
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in new_name)[:64]
    old_dir = os.path.join(PROJECTS_DIR, name)
    new_dir = os.path.join(PROJECTS_DIR, safe_name)
    if not os.path.isdir(old_dir):
        raise HTTPException(status_code=404, detail=f"Project '{name}' not found")
    if os.path.exists(new_dir):
        raise HTTPException(status_code=409, detail=f"Project '{safe_name}' already exists")
    os.rename(old_dir, new_dir)
    return {"renamed": True, "old_name": name, "new_name": safe_name}

@router.delete("/{name}")
async def delete_project(name: str):
    """Deletes a project and all its files."""
    project_dir = os.path.join(PROJECTS_DIR, name)
    if not os.path.isdir(project_dir):
        raise HTTPException(status_code=404, detail=f"Project '{name}' not found")
    shutil.rmtree(project_dir)
    
    # Clear active project if we just deleted it
    if os.path.exists(WORKSPACE_PATH):
        try:
            with open(WORKSPACE_PATH, "r") as f:
                data = json.load(f)
            if data.get("active_project") == name:
                _set_workspace_active_project(None)
        except Exception:
            pass

    return {"deleted": True, "name": name}
