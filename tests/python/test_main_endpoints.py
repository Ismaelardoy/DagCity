"""
test_main_endpoints.py — Tests for endpoints defined in main.py
"""
import json
import os
import sys
import tempfile
import shutil
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

# Setup environment before imports
_tmp_dir = tempfile.mkdtemp()
os.environ["PROJECTS_DIR"] = os.path.join(_tmp_dir, "projects")
os.environ["WORKSPACE_PATH"] = os.path.join(_tmp_dir, "workspace.json")
os.makedirs(os.environ["PROJECTS_DIR"], exist_ok=True)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'src'))

from main import app
import core.config as config

client = TestClient(app)

def teardown_module(module):
    shutil.rmtree(_tmp_dir)

# ── Tests ──────────────────────────────────────────────────────────────────

def test_status_endpoint():
    response = client.get("/api/status")
    assert response.status_code == 200
    data = response.json()
    assert "version" in data
    assert "live_sync_available" in data
    assert "projects_count" in data

def test_check_local_missing():
    # Mock is_live_sync_available to return False
    with patch("main.is_live_sync_available", return_value=False):
        response = client.get("/api/check-local")
        assert response.status_code == 200
        assert response.json()["status"] == "missing"

def test_check_local_ready():
    # Mock is_live_sync_available to return True
    with patch("main.is_live_sync_available", return_value=True):
        response = client.get("/api/check-local")
        assert response.status_code == 200
        assert response.json()["status"] == "ready"

def test_upload_missing_manifest():
    response = client.post("/api/upload", json={})
    assert response.status_code == 400
    assert "Missing 'manifest' key" in response.json()["detail"]

def test_upload_invalid_json():
    # TestClient handle json encoding, so we send a raw string to trigger error if possible
    # but normally we want to test the application logic
    response = client.post("/api/upload", content="invalid json", headers={"Content-Type": "application/json"})
    assert response.status_code == 400

def test_upload_valid_minimal(minimal_manifest):
    response = client.post("/api/upload", json={"manifest": minimal_manifest})
    assert response.status_code == 200
    data = response.json()
    assert data["saved"] is True
    assert "project" in data
    
    # Verify files created
    project_name = data["project"]
    project_dir = os.path.join(os.environ["PROJECTS_DIR"], project_name)
    assert os.path.exists(os.path.join(project_dir, "graph.json"))
    assert os.path.exists(os.path.join(project_dir, "manifest.json"))
    assert os.path.exists(os.path.join(project_dir, "meta.json"))

def test_launch_local_no_volume():
    with patch("main.is_live_sync_available", return_value=False):
        response = client.post("/api/launch-local")
        assert response.status_code == 404

@patch("main.is_live_sync_available", return_value=True)
@patch("builtins.open", new_callable=MagicMock)
@patch("os.path.exists", return_value=True)
@patch("json.load")
def test_launch_local_success(mock_json_load, mock_exists, mock_open, mock_live):
    # Setup mocks for launch_local
    # 1. read manifest
    # 2. read run_results
    # 3. parser.parse()
    
    mock_json_load.side_effect = [
        {"results": []}, # run_results
        {"metadata": {"project_name": "live_proj"}, "nodes": {}}, # manifest
    ]
    
    with patch("main.ManifestParser") as MockParser:
        mock_parser = MockParser.return_value
        mock_parser.parse.return_value = {"nodes": [], "links": [], "metadata": {}}
        
        # We need to mock _autodiscover_project_name too or ensure manifest has it
        response = client.post("/api/launch-local")
        assert response.status_code == 200
        assert response.json()["is_live"] is True

def test_root_returns_html():
    # Mock viz.generate to avoid file system issues if VIZ_DIR is not writable/ready
    with patch("main.viz.generate"):
        response = client.get("/")
        assert response.status_code == 200
        # Since it returns a FileResponse of index.html, we check if it's a file or content
        # In test environment, we might need to ensure index.html exists
        index_path = os.path.join(config.VIZ_DIR, "index.html")
        os.makedirs(config.VIZ_DIR, exist_ok=True)
        with open(index_path, "w") as f: f.write("<html></html>")
        
        response = client.get("/")
        assert response.status_code == 200
        assert "html" in response.text.lower()
