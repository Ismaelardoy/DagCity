import os
import sys
from core.parser import ManifestParser
from core.generator import VizGenerator

def orchestrate():
    """
    Main entry point for containerized DagCity.
    Reads configuration from environment variables.
    """
    print("--- DAG CITY: CONTAINERIZED ORCHESTRATION ---")
    
    # Configuration via Environment Variables
    manifest_path = os.environ.get("MANIFEST_PATH")
    port = int(os.environ.get("PORT", 8080))

    if not manifest_path:
        print("[CRITICAL] MANIFEST_PATH environment variable not set.", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(manifest_path):
        print(f"[CRITICAL] Manifest file not found at: {manifest_path}", file=sys.stderr)
        print("[TIP] Ensure HOST_PROJECT_PATH in .env points to the correct dbt folder.", file=sys.stderr)
        sys.exit(1)

    if not os.access(manifest_path, os.R_OK):
        print(f"[CRITICAL] Manifest file at {manifest_path} is not readable.", file=sys.stderr)
        sys.exit(1)

    try:
        # 1. Parsing Layer
        print(f"[*] Parsing manifest from {manifest_path}...")
        parser_engine = ManifestParser(manifest_path)
        graph_data = parser_engine.parse()
        print(f"[+] Data lineage mapped: {len(graph_data['nodes'])} entities found.")

        # 2. Visualization & Serving Layer
        viz = VizGenerator()
        
        # In Docker, we serve from a fixed directory
        viz_dir = "/app/viz_output"
        os.makedirs(viz_dir, exist_ok=True)
        viz_file = os.path.join(viz_dir, "index.html") # Renamed to index.html for easier serving
        
        print(f"[*] Generating visualization...")
        viz.generate(graph_data, viz_file)
        
        print(f"[*] Starting server on 0.0.0.0:{port}...")
        viz.serve(viz_dir, port=port)

    except Exception as e:
        print(f"\n[CRITICAL ERROR] {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    # Ensure src is in path for imports
    sys.path.append(os.path.dirname(__file__))
    orchestrate()
