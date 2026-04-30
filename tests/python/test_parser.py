"""
test_parser.py — Unit tests for ManifestParser
"""
import pytest
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'src'))

from core.parser import ManifestParser

# ── Fixtures ───────────────────────────────────────────────────────────────

def make_manifest(nodes=None, sources=None, project_name="test_project"):
    return {
        "metadata": {"generated_at": "2024-01-01T00:00:00Z", "project_name": project_name},
        "nodes": nodes or {},
        "sources": sources or {},
    }

def make_model(uid, name, fqn, path, depends_on=None, res_type="model",
               materialized="table", exec_time=None, columns=None, meta=None, stats=None):
    return {
        "unique_id": uid,
        "name": name,
        "resource_type": res_type,
        "original_file_path": path,
        "path": path,
        "fqn": fqn,
        "package_name": fqn[0],
        "depends_on": {"nodes": depends_on or []},
        "config": {"materialized": materialized},
        "description": "",
        "schema": "default",
        "columns": columns or {},
        "stats": stats or {},
        "meta": meta or {},
    }

FULL_MANIFEST = make_manifest(
    nodes={
        "model.tp.stg_orders": make_model(
            "model.tp.stg_orders", "stg_orders",
            ["tp", "staging", "stg_orders"],
            "models/staging/stg_orders.sql",
        ),
        "model.tp.int_items": make_model(
            "model.tp.int_items", "int_items",
            ["tp", "intermediate", "int_items"],
            "models/intermediate/int_items.sql",
            depends_on=["model.tp.stg_orders"],
        ),
        "model.tp.fct_revenue": make_model(
            "model.tp.fct_revenue", "fct_revenue",
            ["tp", "marts", "fct_revenue"],
            "models/marts/fct_revenue.sql",
            depends_on=["model.tp.int_items"],
        ),
    },
    sources={
        "source.tp.raw.raw_orders": make_model(
            "source.tp.raw.raw_orders", "raw_orders",
            ["tp", "raw", "raw_orders"],
            "models/sources.yml",
            res_type="source",
        ),
    },
    project_name="tp",
)

RUN_RESULTS = {
    "results": [
        {"unique_id": "model.tp.stg_orders",  "execution_time": 1.0},
        {"unique_id": "model.tp.int_items",   "execution_time": 3.0},
        {"unique_id": "model.tp.fct_revenue", "execution_time": 200.0},
    ]
}

# ── Schema validation ──────────────────────────────────────────────────────

def test_parse_from_dict_missing_nodes_raises():
    with pytest.raises(ValueError, match="GIGO"):
        ManifestParser.parse_from_dict({"metadata": {}})

def test_parse_from_dict_missing_metadata_raises():
    with pytest.raises(ValueError, match="GIGO"):
        ManifestParser.parse_from_dict({"nodes": {}})

def test_parse_from_dict_valid_minimal():
    result = ManifestParser.parse_from_dict(make_manifest())
    assert "nodes" in result
    assert "links" in result
    assert "metadata" in result
    assert result["nodes"] == []

# ── Layer classification ───────────────────────────────────────────────────

def test_source_classified_as_source():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST)
    nodes = {n["name"]: n for n in result["nodes"]}
    assert nodes["raw_orders"]["layer"] == "source"

def test_staging_model_classified_correctly():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST)
    nodes = {n["name"]: n for n in result["nodes"]}
    assert nodes["stg_orders"]["layer"] == "staging"

def test_intermediate_model_classified_correctly():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST)
    nodes = {n["name"]: n for n in result["nodes"]}
    assert nodes["int_items"]["layer"] == "intermediate"

def test_mart_model_classified_correctly():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST)
    nodes = {n["name"]: n for n in result["nodes"]}
    assert nodes["fct_revenue"]["layer"] == "mart"

# ── Color palette assignment ───────────────────────────────────────────────

def test_source_has_green_color():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST)
    nodes = {n["name"]: n for n in result["nodes"]}
    assert nodes["raw_orders"]["color"] == "#00ff66"

def test_staging_has_pink_color():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST)
    nodes = {n["name"]: n for n in result["nodes"]}
    assert nodes["stg_orders"]["color"] == "#ff0077"

def test_mart_has_cyan_color():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST)
    nodes = {n["name"]: n for n in result["nodes"]}
    assert nodes["fct_revenue"]["color"] == "#00f2ff"

# ── Links / DAG edges ─────────────────────────────────────────────────────

def test_links_built_correctly():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST)
    links = result["links"]
    assert {"source": "model.tp.stg_orders", "target": "model.tp.int_items"} in links
    assert {"source": "model.tp.int_items", "target": "model.tp.fct_revenue"} in links

def test_upstream_downstream_populated():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST)
    nodes = {n["id"]: n for n in result["nodes"]}
    assert "model.tp.stg_orders" in nodes["model.tp.int_items"]["upstream"]
    assert "model.tp.int_items" in nodes["model.tp.stg_orders"]["downstream"]

def test_no_self_links():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST)
    for link in result["links"]:
        assert link["source"] != link["target"]

# ── Execution time & bottleneck detection ─────────────────────────────────

def test_execution_time_zero_without_run_results():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST)
    for node in result["nodes"]:
        assert node["execution_time"] == 0.0

def test_execution_time_loaded_from_run_results():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST, RUN_RESULTS)
    nodes = {n["id"]: n for n in result["nodes"]}
    assert nodes["model.tp.fct_revenue"]["execution_time"] == 200.0
    assert nodes["model.tp.stg_orders"]["execution_time"] == 1.0

def test_bottleneck_flagged_for_slow_node():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST, RUN_RESULTS)
    nodes = {n["id"]: n for n in result["nodes"]}
    assert nodes["model.tp.fct_revenue"]["is_bottleneck"] is True

def test_fast_nodes_not_bottleneck():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST, RUN_RESULTS)
    nodes = {n["id"]: n for n in result["nodes"]}
    assert nodes["model.tp.stg_orders"]["is_bottleneck"] is False

def test_no_bottleneck_without_run_results():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST)
    for node in result["nodes"]:
        assert node["is_bottleneck"] is False

def test_time_source_real_when_run_results_provided():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST, RUN_RESULTS)
    nodes = {n["id"]: n for n in result["nodes"]}
    assert nodes["model.tp.fct_revenue"]["time_source"] == "real"

def test_time_source_none_without_run_results():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST)
    for node in result["nodes"]:
        assert node["time_source"] == "none"

# ── Metadata output ────────────────────────────────────────────────────────

def test_metadata_has_real_times_true():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST, RUN_RESULTS)
    assert result["metadata"]["has_real_times"] is True

def test_metadata_has_real_times_false_without_run_results():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST)
    assert result["metadata"]["has_real_times"] is False

def test_metadata_total_exec_time():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST, RUN_RESULTS)
    assert result["metadata"]["total_exec_time"] == pytest.approx(204.0)

# ── Ghost protocol: dead end detection ────────────────────────────────────

def test_staging_without_downstream_is_dead_end():
    # Isolated staging model → no downstream consumers
    m = make_manifest(nodes={
        "model.tp.stg_alone": make_model(
            "model.tp.stg_alone", "stg_alone",
            ["tp", "staging", "stg_alone"],
            "models/staging/stg_alone.sql",
        )
    }, project_name="tp")
    result = ManifestParser.parse_from_dict(m)
    node = result["nodes"][0]
    assert node["is_dead_end"] is True

def test_mart_not_dead_end():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST)
    nodes = {n["name"]: n for n in result["nodes"]}
    assert nodes["fct_revenue"]["is_dead_end"] is False

# ── Island group assignment ────────────────────────────────────────────────

def test_source_island_is_SOURCES():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST)
    nodes = {n["name"]: n for n in result["nodes"]}
    assert nodes["raw_orders"]["group"] == "SOURCES"

def test_mart_island_reassigned_to_MARTS():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST)
    nodes = {n["name"]: n for n in result["nodes"]}
    assert nodes["fct_revenue"]["group"] == "MARTS"

# ── Column extraction ──────────────────────────────────────────────────────

def test_columns_extracted_correctly():
    m = make_manifest(nodes={
        "model.tp.stg_orders": make_model(
            "model.tp.stg_orders", "stg_orders",
            ["tp", "staging", "stg_orders"],
            "models/staging/stg_orders.sql",
            columns={"order_id": {"data_type": "varchar", "description": "PK"}},
        )
    }, project_name="tp")
    result = ManifestParser.parse_from_dict(m)
    col = result["nodes"][0]["columns"][0]
    assert col["name"] == "order_id"
    assert col["type"] == "VARCHAR"

def test_column_null_data_type_becomes_UNKNOWN():
    m = make_manifest(nodes={
        "model.tp.stg_x": make_model(
            "model.tp.stg_x", "stg_x",
            ["tp", "staging", "stg_x"],
            "models/staging/stg_x.sql",
            columns={"col1": {"data_type": None, "description": ""}},
        )
    }, project_name="tp")
    result = ManifestParser.parse_from_dict(m)
    assert result["nodes"][0]["columns"][0]["type"] == "UNKNOWN"

# ── Row count extraction ───────────────────────────────────────────────────

def test_row_count_from_stats():
    m = make_manifest(nodes={
        "model.tp.fct_x": make_model(
            "model.tp.fct_x", "fct_x",
            ["tp", "marts", "fct_x"],
            "models/marts/fct_x.sql",
            stats={"row_count": 5000},
        )
    }, project_name="tp")
    result = ManifestParser.parse_from_dict(m)
    assert result["nodes"][0]["row_count"] == 5000

def test_row_count_zero_when_missing():
    result = ManifestParser.parse_from_dict(FULL_MANIFEST)
    for node in result["nodes"]:
        assert node["row_count"] == 0

# ── Unsupported resource types filtered ───────────────────────────────────

def test_unsupported_resource_type_skipped():
    m = make_manifest(nodes={
        "test.tp.test_orders": {
            "unique_id": "test.tp.test_orders",
            "name": "test_orders",
            "resource_type": "test",  # Not in SUPPORTED_RESOURCE_TYPES
            "original_file_path": "tests/test_orders.sql",
            "path": "test_orders.sql",
            "fqn": ["tp", "test_orders"],
            "package_name": "tp",
            "depends_on": {"nodes": []},
            "config": {"materialized": "test"},
            "description": "",
            "schema": "default",
            "columns": {},
            "stats": {},
            "meta": {},
        }
    }, project_name="tp")
    result = ManifestParser.parse_from_dict(m)
    assert result["nodes"] == []

# ── File-based parse ───────────────────────────────────────────────────────

def test_parse_from_file(tmp_path):
    import json
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(FULL_MANIFEST), encoding="utf-8")
    parser = ManifestParser(str(path))
    result = parser.parse()
    assert len(result["nodes"]) == 4

def test_parse_missing_file_raises(tmp_path):
    parser = ManifestParser(str(tmp_path / "nonexistent.json"))
    with pytest.raises(FileNotFoundError):
        parser.parse()

def test_parse_invalid_json_raises(tmp_path):
    path = tmp_path / "manifest.json"
    path.write_text("NOT JSON", encoding="utf-8")
    parser = ManifestParser(str(path))
    with pytest.raises(ValueError, match="GIGO"):
        parser.parse()

# ── Name sanitization ─────────────────────────────────────────────────────

def test_sanitize_project_name_via_router():
    from core.router_projects import _sanitize_project_name
    assert _sanitize_project_name("my project!") == "my_project_"
    assert _sanitize_project_name("valid-name_123") == "valid-name_123"
    assert _sanitize_project_name("a" * 100) == "a" * 64
    assert _sanitize_project_name("") == ""
    assert _sanitize_project_name(None) == ""
