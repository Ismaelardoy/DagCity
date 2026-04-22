import os
import sys
from core.parser import ManifestParser
from core.generator import VizGenerator


def orchestrate():
    """
    Main entry point for containerized DagCity.
    Reads configuration from environment variables.

    Resilience Policy (Senior DevOps):
    - If manifest.json is NOT found, the server starts in 'Awaiting Data' mode.
    - The UI is served with an empty graph so the user can interact via Drag & Drop.
    - sys.exit(1) is NEVER called due to missing data — only for unrecoverable runtime errors.
    """
    print("--- DAG CITY: CONTAINERIZED ORCHESTRATION ---")

    manifest_path = os.environ.get("MANIFEST_PATH", "/data/target/manifest.json")
    port = int(os.environ.get("PORT", 8080))

    # Fixed serve directory inside the container
    viz_dir = "/app/viz_output"
    os.makedirs(viz_dir, exist_ok=True)
    viz_file = os.path.join(viz_dir, "index.html")

    viz = VizGenerator()

    # ── Resilience Gate ──────────────────────────────────────────────────────
    # Check manifest existence. If missing, pivot to 'Awaiting Data' mode
    # instead of crashing. The container stays alive to serve the UI.
    if not manifest_path:
        print("[INFO] MANIFEST_PATH environment variable not set.", file=sys.stderr)
        print("[INFO] No local manifest found. Starting in 'Awaiting Data' mode...")
        graph_data = _build_empty_graph()
    elif not os.path.exists(manifest_path):
        print(f"[INFO] Manifest file not found at: {manifest_path}")
        print("[INFO] No local manifest found. Starting in 'Awaiting Data' mode...")
        graph_data = _build_empty_graph()
    elif not os.access(manifest_path, os.R_OK):
        print(f"[WARNING] Manifest at {manifest_path} exists but is not readable.")
        print("[INFO] Starting in 'Awaiting Data' mode...")
        graph_data = _build_empty_graph()
    else:
        # ── Happy Path ───────────────────────────────────────────────────────
        try:
            print(f"[*] Parsing manifest from {manifest_path}...")
            parser_engine = ManifestParser(manifest_path)
            graph_data = parser_engine.parse()
            print(f"[+] Data lineage mapped: {len(graph_data['nodes'])} entities, "
                  f"{len(graph_data['links'])} edges found.")
        except Exception as e:
            print(f"[WARNING] Parser failed: {e}", file=sys.stderr)
            print("[INFO] Falling back to 'Awaiting Data' mode...")
            graph_data = _build_empty_graph()

    # ── Visualization & Serving Layer ────────────────────────────────────────
    try:
        print(f"[*] Generating visualization...")
        viz.generate(graph_data, viz_file)

        print(f"[*] Starting server on 0.0.0.0:{port}...")
        viz.serve(viz_dir, port=port)
    except Exception as e:
        print(f"\n[CRITICAL ERROR] Server could not start: {str(e)}", file=sys.stderr)
        sys.exit(1)


def _build_empty_graph() -> dict:
    """
    Returns a minimal valid graph payload with zero nodes and zero edges.
    The 'status' flag allows the frontend to detect 'Awaiting Data' mode
    and render the appropriate Drag & Drop upload UI.
    """
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


if __name__ == "__main__":
    # Ensure src is in path for imports
    sys.path.append(os.path.dirname(__file__))
    orchestrate()
