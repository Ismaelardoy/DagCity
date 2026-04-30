"""
conftest.py — Shared pytest fixtures for DagCity tests.
"""
import json
import os
import sys
import tempfile
import pytest

# Make src/ importable from tests/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

# ── Minimal valid dbt manifest ─────────────────────────────────────────────
MINIMAL_MANIFEST = {
    "metadata": {
        "dbt_schema_version": "v1",
        "generated_at": "2024-01-01T00:00:00Z",
        "project_name": "test_project"
    },
    "nodes": {
        "model.test_project.stg_orders": {
            "unique_id": "model.test_project.stg_orders",
            "name": "stg_orders",
            "resource_type": "model",
            "original_file_path": "models/staging/stg_orders.sql",
            "path": "staging/stg_orders.sql",
            "fqn": ["test_project", "staging", "stg_orders"],
            "package_name": "test_project",
            "depends_on": {"nodes": []},
            "config": {"materialized": "view"},
            "description": "Staged orders",
            "schema": "staging",
            "columns": {
                "order_id": {"data_type": "varchar", "description": "Primary key"}
            },
            "stats": {},
            "meta": {}
        },
        "model.test_project.int_order_items": {
            "unique_id": "model.test_project.int_order_items",
            "name": "int_order_items",
            "resource_type": "model",
            "original_file_path": "models/intermediate/int_order_items.sql",
            "path": "intermediate/int_order_items.sql",
            "fqn": ["test_project", "intermediate", "int_order_items"],
            "package_name": "test_project",
            "depends_on": {"nodes": ["model.test_project.stg_orders"]},
            "config": {"materialized": "ephemeral"},
            "description": "Intermediate order items",
            "schema": "intermediate",
            "columns": {},
            "stats": {},
            "meta": {}
        },
        "model.test_project.fct_revenue": {
            "unique_id": "model.test_project.fct_revenue",
            "name": "fct_revenue",
            "resource_type": "model",
            "original_file_path": "models/marts/fct_revenue.sql",
            "path": "marts/fct_revenue.sql",
            "fqn": ["test_project", "marts", "fct_revenue"],
            "package_name": "test_project",
            "depends_on": {"nodes": ["model.test_project.int_order_items"]},
            "config": {"materialized": "table"},
            "description": "Revenue fact table",
            "schema": "marts",
            "columns": {},
            "stats": {},
            "meta": {}
        }
    },
    "sources": {
        "source.test_project.raw.raw_orders": {
            "unique_id": "source.test_project.raw.raw_orders",
            "name": "raw_orders",
            "resource_type": "source",
            "original_file_path": "models/sources.yml",
            "path": "sources.yml",
            "fqn": ["test_project", "raw", "raw_orders"],
            "package_name": "test_project",
            "depends_on": {"nodes": []},
            "config": {"materialized": "source"},
            "description": "Raw orders from source",
            "schema": "raw",
            "columns": {},
            "stats": {},
            "meta": {}
        }
    }
}

MINIMAL_RUN_RESULTS = {
    "metadata": {"generated_at": "2024-01-01T00:00:00Z"},
    "results": [
        {"unique_id": "model.test_project.stg_orders", "execution_time": 1.5, "status": "success"},
        {"unique_id": "model.test_project.int_order_items", "execution_time": 3.2, "status": "success"},
        {"unique_id": "model.test_project.fct_revenue", "execution_time": 180.0, "status": "success"},
    ]
}


@pytest.fixture
def minimal_manifest():
    """Returns the minimal manifest dict."""
    return json.loads(json.dumps(MINIMAL_MANIFEST))  # Deep copy


@pytest.fixture
def minimal_run_results():
    """Returns the minimal run_results dict."""
    return json.loads(json.dumps(MINIMAL_RUN_RESULTS))


@pytest.fixture
def manifest_file(tmp_path, minimal_manifest):
    """Writes the minimal manifest to a temp file and returns its path."""
    p = tmp_path / "manifest.json"
    p.write_text(json.dumps(minimal_manifest), encoding="utf-8")
    return str(p)


@pytest.fixture
def manifest_and_run_results_files(tmp_path, minimal_manifest, minimal_run_results):
    """Writes both manifest and run_results to temp files and returns their dir path."""
    (tmp_path / "manifest.json").write_text(json.dumps(minimal_manifest), encoding="utf-8")
    (tmp_path / "run_results.json").write_text(json.dumps(minimal_run_results), encoding="utf-8")
    return str(tmp_path)
