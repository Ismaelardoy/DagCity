import pytest
import json
import os
from core.parser import ManifestParser


def test_parser_valid_manifest(tmp_path):
    manifest_data = {
        "metadata": {"project_name": "test"},
        "nodes": {
            "model.test.customers": {
                "name": "customers",
                "resource_type": "model",
                "config": {"materialized": "table"},
                "depends_on": {"nodes": ["model.test.stg_customers"]},
                "columns": {
                    "customer_id": {"data_type": "integer", "description": "PK"},
                    "name": {"data_type": None, "description": ""},
                }
            },
            "model.test.stg_customers": {
                "name": "stg_customers",
                "resource_type": "model",
                "config": {"materialized": "view"},
                "depends_on": {"nodes": []}
            }
        },
        "sources": {}
    }
    manifest_file = tmp_path / "manifest.json"
    manifest_file.write_text(json.dumps(manifest_data))

    parser = ManifestParser(str(manifest_file))
    result = parser.parse()

    # V4.1: result has nodes, links, and meta
    assert "nodes" in result
    assert "links" in result
    assert "meta"  in result

    graph = result
    assert len(graph["nodes"]) == 2
    assert len(graph["links"]) == 1

    # Layer classification
    stg = next(n for n in graph["nodes"] if n["name"] == "stg_customers")
    assert stg["layer"] == "staging"
    assert stg["color"] == "#ff00ff"

    # Schema enrichment
    cust = next(n for n in graph["nodes"] if n["name"] == "customers")
    assert len(cust["columns"]) == 2
    # GIGO: null data_type becomes "UNKNOWN"
    assert any(c["type"] == "UNKNOWN" for c in cust["columns"])

    # Performance data
    assert "execution_time" in stg
    assert isinstance(stg["execution_time"], float)
    assert "is_bottleneck" in stg
    assert "time_source" in stg

    # Lineage
    assert "upstream" in cust
    assert "downstream" in cust


def test_parser_gigo_invalid_json(tmp_path):
    manifest_file = tmp_path / "invalid.json"
    manifest_file.write_text("not a json")

    parser = ManifestParser(str(manifest_file))
    with pytest.raises(ValueError, match="GIGO Incident"):
        parser.parse()


def test_parser_gigo_incomplete_manifest(tmp_path):
    """Manifest without 'metadata' key must raise GIGO error."""
    manifest_file = tmp_path / "manifest.json"
    manifest_file.write_text(json.dumps({"nodes": {}}))

    parser = ManifestParser(str(manifest_file))
    with pytest.raises(ValueError, match="GIGO Incident"):
        parser.parse()


def test_parser_reads_run_results(tmp_path):
    """When run_results.json exists, uses real execution times."""
    manifest_data = {
        "metadata": {"project_name": "test"},
        "nodes": {
            "model.test.orders": {
                "name": "orders", "resource_type": "model",
                "config": {"materialized": "table"}, "depends_on": {"nodes": []}
            }
        },
        "sources": {}
    }
    run_results_data = {
        "results": [{"unique_id": "model.test.orders", "execution_time": 42.5}]
    }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest_data))
    (tmp_path / "run_results.json").write_text(json.dumps(run_results_data))

    parser = ManifestParser(str(tmp_path / "manifest.json"))
    result = parser.parse()

    orders = next(n for n in result["nodes"] if n["name"] == "orders")
    assert orders["execution_time"] == 42.5
    assert orders["time_source"] == "real"
    assert result["meta"]["has_real_times"] is True
