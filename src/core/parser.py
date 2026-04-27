import json
import os
import hashlib
from typing import Dict, List, Any

class ManifestParser:
    """
    V1.0 DAG-CITY: Parses dbt manifest.json + optional run_results.json.
    - Extracts real execution_time from run_results if present.
    - Honest fallback: if run_results.json is absent, execution_time = 0
      (the JS layer renders a flat base-plate city and shows "Time: N/A").
    - Identifies performance bottlenecks (top 10% execution time).
    - Applies GIGO validation throughout.
    """

    SUPPORTED_RESOURCE_TYPES = ["model", "seed", "source", "snapshot", "exposure", "metric"]

    LAYER_MAP = {
        "stg_": "staging",  "raw_": "source",  "src_": "source",
        "fct_": "mart",     "dim_": "mart",     "mart_": "mart",
        "fct":  "mart",     "dim":  "mart",     "mart":  "mart",
        "int_": "intermediate", "int": "intermediate",
    }

    LAYER_PALETTE = {
        "source":       {"color": "#00ff66", "emissive": "#006622"}, # Rule 1: RAW
        "staging":      {"color": "#ff0077", "emissive": "#7a0033"}, # Rule 2: STAGING
        "intermediate": {"color": "#9d4edd", "emissive": "#4a007a"}, # Rule 3: INTERMEDIATE / Catch-all
        "mart":         {"color": "#00f2ff", "emissive": "#006b7a"}, # Rule 4: MARTS
        "consumption":  {"color": "#ffd700", "emissive": "#7a6600"}, # Rule 5: BI/CONSUMPTION (Gold)
        "default":      {"color": "#0066ff", "emissive": "#0033aa"}, 
    }

    MAT_PALETTE = {
        "seed":     {"color": "#39ff14", "emissive": "#1a7a00"},
        "snapshot": {"color": "#f2ff00", "emissive": "#7a7a00"},
    }

    def __init__(self, manifest_path: str):
        self.manifest_path = manifest_path
        # Automatically look for run_results.json in the same directory
        manifest_dir = os.path.dirname(os.path.abspath(manifest_path))
        self.run_results_path = os.path.join(manifest_dir, "run_results.json")

    # ─── Factory: parse from in-memory dicts (upload endpoint) ───────
    @classmethod
    def parse_from_dict(
        cls,
        manifest_dict: Dict,
        run_results_dict: Dict = None,
    ) -> Dict[str, Any]:
        """
        Parse a dbt manifest supplied as a Python dict (e.g. from an HTTP upload)
        without touching the filesystem.  Optionally accepts run_results as a dict.
        Raises ValueError on GIGO schema violations.
        """
        if "nodes" not in manifest_dict or "metadata" not in manifest_dict:
            raise ValueError("GIGO: manifest is missing 'nodes' or 'metadata' keys.")
        # Build a throwaway instance just to get access to the private helpers
        instance = cls.__new__(cls)
        instance.manifest_path = "<in-memory>"
        instance.run_results_path = None
        run_times: Dict[str, float] = {}
        if run_results_dict:
            for result in run_results_dict.get("results", []):
                uid = result.get("unique_id", "")
                t   = result.get("execution_time", 0.0)
                if uid:
                    run_times[uid] = round(float(t), 3)
        return instance._parse_data(manifest_dict, run_times)

    # ─── Private Helpers ────────────────────────────────────────────
    def _classify_layer(self, res_type: str, file_path: str, fqn: List[str], name: str) -> str:
        """Staff Data Architect: Sequential Rules Engine V1.0."""
        # Rule 1: RAW
        if res_type in ("source", "seed"):
            return "source"
        
        path_lower = file_path.lower()
        fqn_lower  = [f.lower() for f in fqn]
        name_lower = name.lower()

        # Rule 5: BI / CONSUMPTION
        if res_type in ("exposure", "metric"):
            return "consumption"

        if res_type in ("model", "snapshot"):
            # Rule 2: STAGING
            if ("staging" in fqn_lower or "staging" in path_lower or name_lower.startswith("stg_")):
                return "staging"

            # Rule 3: INTERMEDIATE
            if ("intermediate" in fqn_lower or "intermediate" in path_lower or name_lower.startswith("int_")):
                return "intermediate"

            # Rule 4: MARTS (Explicit)
            if (any(k in fqn_lower for k in ("marts", "analytics")) or
                any(k in path_lower for k in ("marts", "analytics")) or
                any(name_lower.startswith(p) for p in ("fct_", "dim_", "agg_"))):
                return "mart"
                
        # If not classified yet, we wait for Topological Catch-All phase
        return "unclassified"

    def _extract_columns(self, details: Dict) -> List[Dict]:
        """GIGO: handles null data_type gracefully."""
        result = []
        for col_name, col_info in details.get("columns", {}).items():
            raw_type = col_info.get("data_type") or "UNKNOWN"
            result.append({
                "name": col_name,
                "type": raw_type.upper() if isinstance(raw_type, str) else "UNKNOWN",
                "description": col_info.get("description", "")
            })
        return result

    def _extract_row_count(self, details: Dict) -> int:
        def _as_positive_int(v) -> int:
            try:
                n = float(v)
                if n > 0:
                    return int(round(n))
            except (TypeError, ValueError):
                pass
            return 0

        stats = details.get("stats", {}) or {}
        meta = details.get("meta", {}) or {}
        candidates = [
            details.get("row_count"),
            details.get("rows"),
            details.get("num_rows"),
            details.get("rowCount"),
            stats.get("row_count"),
            stats.get("rows"),
            stats.get("num_rows"),
            meta.get("row_count"),
            meta.get("rows"),
            meta.get("num_rows"),
        ]

        for c in candidates:
            parsed = _as_positive_int(c)
            if parsed > 0:
                return parsed
        return 0

    def _determine_island_group(self, res_type: str, package_name: str, file_path: str, fqn: List[str], root_project_name: str, name: str, layer: str) -> str:
        """
        Hybrid Grouping System: Adapts to different dbt architectures (packages vs monoliths).
        
        REGLA 0 (Marts): Si layer es 'mart', la isla es "MARTS".
        REGLA 1 (Fuentes y Seeds): Si resource_type es 'source', la isla es "SOURCES". Si es 'seed', la isla es "SEEDS".
        REGLA 2 (Paquetes Externos): Si package_name != root_project_name, la isla es el nombre del paquete en mayúsculas.
        REGLA 3 (Carpetas - Para Monolitos): Si package_name == root_project_name, agrupa por estructura de carpetas.
        REGLA 4 (Fallback): Si la ruta no tiene subcarpetas claras, asígnalo a "CORE".
        """
        print(f"[DEBUG HYBRID] res_type={res_type}, package_name={package_name}, root_project_name={root_project_name}, name={name}, layer={layer}")
        print(f"[DEBUG HYBRID] file_path={file_path}, fqn={fqn}")
        
        # REGLA 0: Marts (después de Topological Catch-All)
        if layer == 'mart':
            print("[DEBUG HYBRID] Rule 0: MARTS")
            return "MARTS"
        
        # REGLA 1: Sources y Seeds
        if res_type == 'source':
            print("[DEBUG HYBRID] Rule 1: SOURCES")
            return "SOURCES"
        if res_type == 'seed':
            print("[DEBUG HYBRID] Rule 1: SEEDS")
            return "SEEDS"
        
        # REGLA 2: Paquetes Externos
        if package_name and package_name != root_project_name:
            island = package_name.upper().replace('-', '_')
            print(f"[DEBUG HYBRID] Rule 2: {island} (external package)")
            return island
        
        # REGLA 3: Carpetas para Monolitos (package_name == root_project_name)
        print("[DEBUG HYBRID] Checking folder structure...")
        # Intentar usar fqn primero
        if fqn and len(fqn) >= 2:
            folder = fqn[1].upper()
            print(f"[DEBUG HYBRID] fqn[1]={folder}")
            if folder not in ['DBT', 'MODELS', 'DEFAULT']:
                print(f"[DEBUG HYBRID] Rule 3 (fqn): {folder}")
                return folder
        
        # Intentar extraer del file_path
        if file_path:
            path_normalized = file_path.replace('\\', '/')
            print(f"[DEBUG HYBRID] path_normalized={path_normalized}")
            if 'models/' in path_normalized:
                after_models = path_normalized.split('models/')[-1]
                parts = after_models.split('/')
                print(f"[DEBUG HYBRID] after_models={after_models}, parts={parts}")
                if len(parts) > 1 and parts[0]:
                    folder = parts[0].upper()
                    print(f"[DEBUG HYBRID] Rule 3 (file_path): {folder}")
                    return folder
        
        # REGLA 4: Fallback a CORE
        print("[DEBUG HYBRID] Rule 4: CORE (fallback)")
        return "CORE"

    def _simulate_execution_time(self, name: str) -> float:
        """
        DEPRECATED — kept only as a no-op for backward import compatibility.
        Synthetic data MUST NOT leak into the visualization. Use the
        dev-only `window.enableMarketingMode()` console hook for demos.
        """
        return 0.0
        # ── Dead code below intentionally left for git-blame reference ──
        h = int(hashlib.md5(name.encode()).hexdigest(), 16)
        raw = (h % 10000) / 10000.0
        
        # 10% chance of being a significant bottleneck (120s - 180s)
        if h % 100 < 10:
            return round(120.0 + raw * 60.0, 2)
        
        # Normal nodes (0.3s - 8s)
        return round(0.3 + (raw ** 2) * 7.7, 2)

    def _load_run_results(self) -> Dict[str, float]:
        """Loads execution_time per unique_id from run_results.json (optional)."""
        if not os.path.exists(self.run_results_path):
            print(f"[~] run_results.json not found — execution_time set to 0 for all nodes (Time: N/A).")
            return {}
        try:
            with open(self.run_results_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            times = {}
            for result in data.get("results", []):
                uid = result.get("unique_id", "")
                t   = result.get("execution_time", 0.0)
                if uid:
                    times[uid] = round(float(t), 3)
            print(f"[+] run_results.json loaded: {len(times)} execution times found.")
            return times
        except Exception as e:
            print(f"[~] Could not parse run_results.json: {e} — execution_time defaulted to 0.")
            return {}

    # ─── Public API ──────────────────────────────────────────────────
    def parse(self) -> Dict[str, Any]:
        """Parse from the file path supplied to __init__."""
        if not os.path.exists(self.manifest_path):
            raise FileNotFoundError(f"Missing manifest at {self.manifest_path}")
        with open(self.manifest_path, "r", encoding="utf-8") as f:
            try:
                data = json.load(f)
            except json.JSONDecodeError as e:
                raise ValueError(f"GIGO Incident: Invalid JSON format. {e}")
        if "nodes" not in data or "metadata" not in data:
            raise ValueError("GIGO Incident: Manifest schema incomplete ('nodes' or 'metadata' missing)")
        run_times = self._load_run_results()
        return self._parse_data(data, run_times)

    # ─── Core parsing engine (shared by parse() and parse_from_dict()) ─
    def _parse_data(self, data: Dict, run_times: Dict[str, float]) -> Dict[str, Any]:
        has_real_times = bool(run_times)
        nodes_data = {**data.get("nodes", {}), **data.get("sources", {})}
        parsed_nodes = {}
        links = []

        # Extract root project name for hybrid grouping
        root_project_name = data.get("metadata", {}).get("project_name", "default")
        print(f"[DEBUG] root_project_name extracted: {root_project_name}")

        # Phase 1: Extract nodes
        nodes_list = list(nodes_data.items())
        for i, (uid, details) in enumerate(nodes_list):
            res_type = details.get("resource_type")
            if res_type not in self.SUPPORTED_RESOURCE_TYPES:
                continue

            config       = details.get("config", {})
            materialized = config.get("materialized", res_type)
            name         = details.get("name", uid)
            file_path    = details.get("original_file_path") or details.get("path", "external")
            fqn          = details.get("fqn", [])
            package_name = details.get("package_name", "")
            
            layer        = self._classify_layer(res_type, file_path, fqn, name)
            palette      = (self.LAYER_PALETTE.get(layer)
                            or self.MAT_PALETTE.get(materialized)
                            or self.LAYER_PALETTE["default"])

            # Determine island group using hybrid grouping system
            island_group = self._determine_island_group(res_type, package_name, file_path, fqn, root_project_name, name, layer)
            print(f"[DEBUG] Node: {name}, package: {package_name}, root: {root_project_name}, file_path: {file_path}, fqn={fqn}, layer={layer}, island: {island_group}")

            # Execution time: ONLY real values from run_results.json. If absent,
            # we keep 0 (the JS layer treats 0 as "no data" and falls back to
            # the Uniform base-plate aesthetic). Synthetic data must NEVER leak
            # into the visualization — if a demo is needed, use the dev-only
            # window.enableMarketingMode() console hook instead.
            exec_time = float(run_times.get(uid, 0) or 0)
            row_count = self._extract_row_count(details)

            parsed_nodes[uid] = {
                "id":            uid,
                "name":          name,
                "resource_type": res_type,
                "materialized":  materialized,
                "layer":         layer,
                "file_path":     file_path,
                "color":         palette["color"],
                "emissive":      palette["emissive"],
                "description":   details.get("description", ""),
                "group":         island_group,
                "schema":        details.get("schema", "default"),
                "columns":       self._extract_columns(details),
                "upstream":      [],
                "downstream":    [],
                "execution_time": exec_time,
                "row_count":     row_count,
                "time_source":   "real" if uid in run_times else "none",
                "is_bottleneck": False,
                "is_dead_end":   False,
            }

        # Phase 2: Build links
        for uid, details in data.get("nodes", {}).items():
            if uid not in parsed_nodes:
                continue
            for dep_id in details.get("depends_on", {}).get("nodes", []):
                if dep_id in parsed_nodes:
                    links.append({"source": dep_id, "target": uid})
                    parsed_nodes[uid]["upstream"].append(dep_id)
                    parsed_nodes[dep_id]["downstream"].append(uid)

        # Phase 3: Flag bottlenecks (Statistical Outliers: > Mean + 1.5*StdDev)
        import statistics
        all_times = [n["execution_time"] for n in parsed_nodes.values()]
        
        if len(all_times) > 1:
            mean_time = statistics.mean(all_times)
            stdev_time = statistics.stdev(all_times)
            threshold = mean_time + (1.5 * stdev_time)
            
            for n in parsed_nodes.values():
                is_bn = n["execution_time"] > threshold and n["execution_time"] > 0
                n["is_bottleneck"] = is_bn
        else:
            # Fallback for single node or empty
            for n in parsed_nodes.values():
                n["is_bottleneck"] = False

        # Phase 4: Rules & Audit Engine Execution
        for n in parsed_nodes.values():
            if n["resource_type"] not in ("model", "snapshot"):
                continue

            # Topological Catch-All for root models
            if n["layer"] == "unclassified":
                # Check if node receives from intermediate and has no downstreams
                hasIntermediateUpstream = any(
                    parsed_nodes.get(uid, {}).get("layer") == "intermediate"
                    for uid in n["upstream"]
                )

                if hasIntermediateUpstream and len(n["downstream"]) == 0:
                    n["layer"] = "mart"
                elif len(n["downstream"]) > 0:
                    n["layer"] = "intermediate"
                else:
                    n["layer"] = "mart"
                
                # Apply new colors (Defensive lookup)
                pal = self.LAYER_PALETTE.get(n["layer"], self.LAYER_PALETTE["default"])
                n["color"] = pal["color"]
                n["emissive"] = pal["emissive"]

            # Ghost Protocol (Audit)
            # If Staging or Intermediate but NO consumers -> Dead End
            if n["layer"] in ("staging", "intermediate") and len(n["downstream"]) == 0:
                n["is_dead_end"] = True

        # Phase 5: Reassign groups for MARTS (after Topological Catch-All)
        for n in parsed_nodes.values():
            if n["layer"] == "mart":
                n["group"] = "MARTS"
                print(f"[DEBUG MARTS] Reassigned {n['name']} to MARTS")

        return {
            "metadata": {
                "generated_at": data.get("metadata", {}).get("generated_at"),
                "has_real_times": has_real_times,
                "total_exec_time": round(sum(all_times), 2) if all_times else 0,
                "avg_exec_time": round(statistics.mean(all_times), 3) if all_times else 0
            },
            "nodes": list(parsed_nodes.values()),
            "links": links
        }
