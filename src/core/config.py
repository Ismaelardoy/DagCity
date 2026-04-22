import os

# Paths
MANIFEST_PATH = os.environ.get("MANIFEST_PATH", "/data/target/manifest.json")
PORT = int(os.environ.get("PORT", 8080))
VIZ_DIR = "/app/viz_output"
PROJECTS_DIR = "/data/projects"
WORKSPACE_PATH = "/data/workspace.json"

# Ensure directories exist
os.makedirs(VIZ_DIR, exist_ok=True)
os.makedirs(PROJECTS_DIR, exist_ok=True)
