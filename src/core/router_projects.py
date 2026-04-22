import os
import json
import shutil
from datetime import datetime
from typing import List, Dict
from fastapi import APIRouter, HTTPException, Request
from core.config import PROJECTS_DIR, WORKSPACE_PATH

router = APIRouter(prefix="/api/projects", tags=["projects"])

def _set_workspace_active_project(name: str):
    try:
        with open(WORKSPACE_PATH, "w") as f:
            json.dump({"active_project": name}, f)
    except: pass

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
        if os.path.exists(meta_path):
            with open(meta_path) as f:
                meta = json.load(f)
        projects.append({
            "name": name,
            "node_count": meta.get("node_count", 0),
            "created_at": meta.get("created_at", ""),
        })
    return projects

@router.get("/{name}")
async def get_project(name: str):
    """Returns the full graph JSON for a saved project, including its SLA config."""
    graph_path = os.path.join(PROJECTS_DIR, name, "graph.json")
    if not os.path.exists(graph_path):
        raise HTTPException(status_code=404, detail=f"Project '{name}' not found")
    with open(graph_path) as f:
        data = json.load(f)
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
    return {"deleted": True, "name": name}
