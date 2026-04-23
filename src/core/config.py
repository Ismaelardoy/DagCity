import os

# Internal Storage (Inside the container)
VIZ_DIR = "/app/viz_output"
PROJECTS_DIR = os.environ.get("PROJECTS_DIR", "/data/projects")
WORKSPACE_PATH = os.environ.get("WORKSPACE_PATH", "/data/workspace.json")

# External Data (Optional Volume)
DEFAULT_MANIFEST_PATH = "/data/target/manifest.json"

def autodiscover_manifest():
    """Smart Discovery: Common locations -> Deep search -> User defined fallback."""
    
    # 1. Check default dbt location first (most common)
    if os.path.exists(DEFAULT_MANIFEST_PATH):
        return DEFAULT_MANIFEST_PATH

    # 2. Deep search in /data (skipping internal projects dir)
    if os.path.exists("/data"):
        for root, dirs, files in os.walk("/data"):
            if "projects" in root or "viz_output" in root: continue
            if "manifest.json" in files:
                found = os.path.join(root, "manifest.json")
                print(f"[CONFIG] Autodiscovered manifest at: {found}")
                return found

    # 3. Fallback to explicit environment variable (if user forced a path)
    env_path = os.environ.get("MANIFEST_PATH")
    if env_path:
        return env_path
    
    return DEFAULT_MANIFEST_PATH

EXTERNAL_MANIFEST_PATH = autodiscover_manifest()
PORT = int(os.environ.get("PORT", 8080))

def is_live_sync_available():
    """Checks if the external manifest.json exists (volume mounted)."""
    global EXTERNAL_MANIFEST_PATH
    EXTERNAL_MANIFEST_PATH = autodiscover_manifest()
    return os.path.exists(EXTERNAL_MANIFEST_PATH)

# Ensure directories exist
os.makedirs(VIZ_DIR, exist_ok=True)
os.makedirs(os.path.join(VIZ_DIR, "static"), exist_ok=True)
os.makedirs(PROJECTS_DIR, exist_ok=True)

