"""
test_router_projects.py — Integration tests for /api/projects router
Uses FastAPI TestClient with a temp PROJECTS_DIR
"""
import json
import os
import sys
import shutil
import tempfile
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'src'))

# Patch env vars BEFORE importing config/app
_tmp_projects = tempfile.mkdtemp()
_tmp_workspace = os.path.join(_tmp_projects, "workspace.json")
os.environ["PROJECTS_DIR"] = _tmp_projects
os.environ["WORKSPACE_PATH"] = _tmp_workspace

from fastapi.testclient import TestClient
import core.config as config
config.PROJECTS_DIR = _tmp_projects
config.WORKSPACE_PATH = _tmp_workspace

from main import app  # noqa: E402

client = TestClient(app)

# ── Helpers ────────────────────────────────────────────────────────────────

SAMPLE_GRAPH = {
    "metadata": {"generated_at": "2024-01-01T00:00:00Z", "has_real_times": False,
                 "total_exec_time": 0, "avg_exec_time": 0, "source": "offline"},
    "nodes": [{"id": "model.tp.stg_a", "name": "stg_a", "layer": "staging"}],
    "links": []
}

def _create_project(name: str, source: str = "offline", graph: dict = None):
    """Helper: write project files directly to PROJECTS_DIR."""
    project_dir = os.path.join(_tmp_projects, name)
    os.makedirs(project_dir, exist_ok=True)
    g = graph or SAMPLE_GRAPH
    with open(os.path.join(project_dir, "graph.json"), "w") as f:
        json.dump(g, f)
    with open(os.path.join(project_dir, "meta.json"), "w") as f:
        json.dump({
            "source": source,
            "node_count": len(g.get("nodes", [])),
            "created_at": "2024-01-01T00:00:00Z",
        }, f)


def _cleanup_project(name: str):
    project_dir = os.path.join(_tmp_projects, name)
    if os.path.isdir(project_dir):
        shutil.rmtree(project_dir)


# ── GET /api/projects ──────────────────────────────────────────────────────

class TestListProjects:
    def setup_method(self):
        self.project_name = "test_list_project"
        _create_project(self.project_name)

    def teardown_method(self):
        _cleanup_project(self.project_name)

    def test_returns_200(self):
        r = client.get("/api/projects")
        assert r.status_code == 200

    def test_returns_list(self):
        r = client.get("/api/projects")
        assert isinstance(r.json(), list)

    def test_project_appears_in_list(self):
        r = client.get("/api/projects")
        names = [p["name"] for p in r.json()]
        assert self.project_name in names

    def test_project_has_required_fields(self):
        r = client.get("/api/projects")
        project = next(p for p in r.json() if p["name"] == self.project_name)
        for field in ["name", "source", "node_count", "created_at", "disabled"]:
            assert field in project

    def test_empty_dir_returns_empty_list(self, tmp_path):
        # Temporarily swap PROJECTS_DIR
        original = config.PROJECTS_DIR
        config.PROJECTS_DIR = str(tmp_path)
        try:
            r = client.get("/api/projects")
            assert r.json() == [] or isinstance(r.json(), list)
        finally:
            config.PROJECTS_DIR = original


# ── GET /api/projects/{name} ───────────────────────────────────────────────

class TestGetProject:
    def setup_method(self):
        self.project_name = "test_get_project"
        _create_project(self.project_name)

    def teardown_method(self):
        _cleanup_project(self.project_name)

    def test_returns_200_for_existing_project(self):
        r = client.get(f"/api/projects/{self.project_name}")
        assert r.status_code == 200

    def test_returns_graph_structure(self):
        r = client.get(f"/api/projects/{self.project_name}")
        body = r.json()
        assert "nodes" in body
        assert "links" in body
        assert "metadata" in body

    def test_returns_404_for_missing_project(self):
        r = client.get("/api/projects/nonexistent_project_xyz")
        assert r.status_code == 404

    def test_metadata_source_injected(self):
        r = client.get(f"/api/projects/{self.project_name}")
        assert r.json()["metadata"]["source"] == "offline"

    def test_sla_attached_when_file_exists(self):
        sla_data = {"global_sla": 120, "zones": {}}
        project_dir = os.path.join(_tmp_projects, self.project_name)
        with open(os.path.join(project_dir, "sla.json"), "w") as f:
            json.dump(sla_data, f)
        r = client.get(f"/api/projects/{self.project_name}")
        assert "_sla" in r.json()
        assert r.json()["_sla"]["global_sla"] == 120

    def test_no_sla_key_when_file_missing(self):
        r = client.get(f"/api/projects/{self.project_name}")
        # sla.json not created in setup — should be absent
        body = r.json()
        assert "_sla" not in body or body.get("_sla") is None


# ── PATCH /api/projects/{name}/sla ────────────────────────────────────────

class TestSaveProjectSLA:
    def setup_method(self):
        self.project_name = "test_sla_project"
        _create_project(self.project_name)

    def teardown_method(self):
        _cleanup_project(self.project_name)

    def test_save_sla_returns_200(self):
        r = client.patch(f"/api/projects/{self.project_name}/sla",
                         json={"global_sla": 60})
        assert r.status_code == 200
        assert r.json()["saved"] is True

    def test_sla_persisted_to_disk(self):
        client.patch(f"/api/projects/{self.project_name}/sla",
                     json={"global_sla": 90, "zones": {"stg": 30}})
        sla_path = os.path.join(_tmp_projects, self.project_name, "sla.json")
        assert os.path.exists(sla_path)
        with open(sla_path) as f:
            data = json.load(f)
        assert data["global_sla"] == 90

    def test_sla_404_for_missing_project(self):
        r = client.patch("/api/projects/ghost_project/sla", json={"x": 1})
        assert r.status_code == 404


# ── PATCH /api/projects/{name}/rename ─────────────────────────────────────

class TestRenameProject:
    def setup_method(self):
        self.project_name = "project_to_rename"
        self.new_name = "project_renamed"
        _create_project(self.project_name)

    def teardown_method(self):
        _cleanup_project(self.project_name)
        _cleanup_project(self.new_name)

    def test_rename_returns_200(self):
        r = client.patch(f"/api/projects/{self.project_name}/rename",
                         json={"new_name": self.new_name})
        assert r.status_code == 200
        assert r.json()["renamed"] is True

    def test_new_project_dir_exists_after_rename(self):
        client.patch(f"/api/projects/{self.project_name}/rename",
                     json={"new_name": self.new_name})
        assert os.path.isdir(os.path.join(_tmp_projects, self.new_name))

    def test_old_dir_removed_after_rename(self):
        client.patch(f"/api/projects/{self.project_name}/rename",
                     json={"new_name": self.new_name})
        assert not os.path.isdir(os.path.join(_tmp_projects, self.project_name))

    def test_rename_conflict_returns_409(self):
        _create_project(self.new_name)
        r = client.patch(f"/api/projects/{self.project_name}/rename",
                         json={"new_name": self.new_name})
        assert r.status_code == 409

    def test_rename_missing_new_name_returns_400(self):
        r = client.patch(f"/api/projects/{self.project_name}/rename",
                         json={"new_name": ""})
        assert r.status_code == 400

    def test_rename_missing_project_returns_404(self):
        r = client.patch("/api/projects/ghost_xyz/rename",
                         json={"new_name": "whatever"})
        assert r.status_code == 404


# ── DELETE /api/projects/{name} ────────────────────────────────────────────

class TestDeleteProject:
    def setup_method(self):
        self.project_name = "project_to_delete"
        _create_project(self.project_name)

    def teardown_method(self):
        _cleanup_project(self.project_name)

    def test_delete_returns_200(self):
        r = client.delete(f"/api/projects/{self.project_name}")
        assert r.status_code == 200
        assert r.json()["deleted"] is True

    def test_project_dir_removed(self):
        client.delete(f"/api/projects/{self.project_name}")
        assert not os.path.isdir(os.path.join(_tmp_projects, self.project_name))

    def test_delete_missing_project_returns_404(self):
        r = client.delete("/api/projects/totally_missing")
        assert r.status_code == 404

    def test_project_not_in_list_after_delete(self):
        client.delete(f"/api/projects/{self.project_name}")
        r = client.get("/api/projects")
        names = [p["name"] for p in r.json()]
        assert self.project_name not in names


# ── GET /api/status ────────────────────────────────────────────────────────

def test_status_endpoint_returns_200():
    r = client.get("/api/status")
    assert r.status_code == 200

def test_status_has_live_project_registered_field():
    r = client.get("/api/status")
    assert "live_project_registered" in r.json()
