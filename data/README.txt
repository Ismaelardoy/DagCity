# This directory is the fallback mount point for DagCity when HOST_PROJECT_PATH
# is not set in .env. It is intentionally empty — the container will start in
# 'Awaiting Data' mode and prompt the user to upload a manifest.json via the UI.
#
# To wire a real dbt project, update HOST_PROJECT_PATH in .env:
#   HOST_PROJECT_PATH=C:/path/to/your/jaffle_shop
