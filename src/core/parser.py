import json
import os
import hashlib
from typing import Dict, List, Any

class ManifestParser:
    """
    V4.1 DAG-CITY: Parses dbt manifest.json + optional run_results.json.
    - Extracts real execution_time from run_results if present.
    - Generates consistent simulated times for demos when run_results is absent.
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

    # ─── Private Helpers ────────────────────────────────────────────
    def _classify_layer(self, res_type: str, file_path: str, fqn: List[str], name: str) -> str:
        """Staff Data Architect: Sequential Rules Engine V5.0."""
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

    def _simulate_execution_time(self, name: str) -> float:
        """
        Generates consistent simulated times.
        Ensures ~10% are 'Heavy Hitters' (bottlenecks) for demo purposes.
        """
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
            print(f"[~] run_results.json not found — using simulated execution times.")
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
            print(f"[~] Could not parse run_results.json: {e} — using simulated times.")
            return {}

    # ─── Public API ──────────────────────────────────────────────────
    def parse(self) -> Dict[str, Any]:
        # GIGO: validate manifest
        if not os.path.exists(self.manifest_path):
            raise FileNotFoundError(f"Missing manifest at {self.manifest_path}")
        with open(self.manifest_path, "r", encoding="utf-8") as f:
            try:
                data = json.load(f)
            except json.JSONDecodeError as e:
                raise ValueError(f"GIGO Incident: Invalid JSON format. {e}")
        if "nodes" not in data or "metadata" not in data:
            raise ValueError("GIGO Incident: Manifest schema incomplete ('nodes' or 'metadata' missing)")

        # Load performance data
        run_times = self._load_run_results()
        has_real_times = bool(run_times)

        nodes_data = {**data.get("nodes", {}), **data.get("sources", {})}
        parsed_nodes = {}
        links = []

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
            layer        = self._classify_layer(res_type, file_path, fqn, name)
            palette      = (self.LAYER_PALETTE.get(layer)
                            or self.MAT_PALETTE.get(materialized)
                            or self.LAYER_PALETTE["default"])

            # Execution time: real > simulated
            exec_time = run_times.get(uid, self._simulate_execution_time(name))

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
                "group":         details.get("package_name", "unknown"),
                "schema":        details.get("schema", "default"),
                "columns":       self._extract_columns(details),
                "upstream":      [],
                "downstream":    [],
                "execution_time": exec_time,
                "time_source":   "real" if uid in run_times else "simulated",
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
                if len(n["downstream"]) > 0:
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
