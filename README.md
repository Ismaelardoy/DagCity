# 🏙️ DagCity — dbt Observability Engine

> **"Your dbt project is a city. DagCity is its aerial view."**

DagCity is an open-source, containerized **3D data lineage visualizer** for [dbt](https://www.getdbt.com/) projects. It parses your `manifest.json`, classifies every model by architectural layer, and renders an interactive cyberpunk-style city where **buildings are models**, **streets are data pipelines**, and **fire means your pipeline is on fire** (performance bottleneck detected).

---

## ✨ Feature Highlights

| Feature | Details |
|---|---|
| **3D City Rendering** | Real-time Three.js scene with OrbitControls, damping, auto-rotate |
| **Architectural Layers** | Source → Staging → Intermediate → Mart → Consumption, colour-coded |
| **Performance Profiler** | Building height ∝ execution time; toggle 3D Performance Mode |
| **Bottleneck Detection** | Statistical outlier engine (Mean + 1.5×StdDev); displays fire particle effect |
| **Ghost Protocol** | Detects dead-end Staging/Intermediate models (no downstream consumers) |
| **Deep-Dive Sidebar** | Click any building → full node metadata, schema columns, execution time |
| **Lineage Highlighting** | Click-to-trace full upstream/downstream lineage with particle emphasis |
| **Smart HUD** | Camera navigation guide with cyberpunk discovery hint |
| **Awaiting Data Mode** | Container stays alive with Drag & Drop overlay if no `manifest.json` is found |

---

## 🚀 Quickstart

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- A dbt project with a compiled `manifest.json` (run `dbt compile` or `dbt run`)

### 1. Clone the repo

```bash
git clone https://github.com/Ismaelardoy/DagCity.git
cd DagCity
```

### 2. Configure `.env`

Edit `.env` to point at your dbt project:

```dotenv
# Absolute path to your dbt project root on the HOST machine
HOST_PROJECT_PATH=C:/Users/you/projects/jaffle_shop

# Relative path from that root to manifest.json
# Default dbt location: target/manifest.json
MANIFEST_SUBPATH=target/manifest.json

# Port exposed by the visualizer
PORT=8080
```

> **Tip:** If you leave `HOST_PROJECT_PATH` unconfigured, the container still starts in **Awaiting Data** mode — no crash, no exit code 1.

### 3. Launch

```bash
docker compose up --build
```

Open your browser at **http://localhost:8080**

---

## 🛡️ Resilience & "Awaiting Data" Mode

DagCity is designed to **never crash due to missing data**. The startup logic follows a safety-first policy:

```
manifest.json found?
  ├─ YES → Parse → Render full 3D city
  └─ NO  → [INFO] No local manifest found. Starting in 'Awaiting Data' mode...
             → Serve empty city with Drag & Drop upload overlay
             → Container stays alive (restart: unless-stopped)
```

This means:
- `docker compose up` always succeeds regardless of `.env` configuration.
- Users can interact with the **Drag & Drop** overlay in the browser to upload a `manifest.json` directly from their machine.
- No `sys.exit(1)` on missing data — only unrecoverable server errors will stop the container.

---

## 🗂️ Project Structure

```
DagCity/
├── src/
│   ├── main.py               # Orchestrator — resilient startup logic
│   └── core/
│       ├── parser.py         # ManifestParser v1.0 — dbt manifest + run_results
│       └── generator.py      # VizGenerator — Three.js HTML builder + HTTP server
├── tests/
│   └── test_parser.py        # Parser unit tests
├── data/                     # Fallback empty mount (used when HOST_PROJECT_PATH is unset)
├── Dockerfile                # python:3.12-slim image
├── docker-compose.yml        # Service definition — no 'version' key (Compose v2)
├── .env                      # Local configuration (not committed with secrets)
└── README.md
```

---

## 🧠 Architecture

### Parser (`src/core/parser.py`)

The `ManifestParser` implements a **Sequential Rules Engine** to classify every dbt node:

```
Resource Type → Layer Classification
─────────────────────────────────────
source / seed  →  source      (#00ff66 green)
stg_* / staging dir  →  staging    (#ff0077 pink)
int_* / intermediate dir →  intermediate  (#9d4edd purple)
fct_* / dim_* / marts dir  →  mart     (#00f2ff cyan)
exposure / metric  →  consumption  (#ffd700 gold)
Topological Catch-All (no match):
  has_downstream → intermediate
  leaf node      → mart
```

**Bottleneck Detection:**
- Loads real execution times from `run_results.json` if present (same directory as `manifest.json`).
- Falls back to deterministic simulated times (MD5-seeded) for demos.
- Flags nodes where `execution_time > Mean + 1.5 × StdDev` as bottlenecks.

**Ghost Protocol:**
- Any `staging` or `intermediate` model with **zero downstream consumers** is marked `is_dead_end = True` and rendered as a transparent ghost building with a ⚠️ hazard sprite.

### Generator (`src/core/generator.py`)

The `VizGenerator` embeds graph data as a JSON payload inside a self-contained HTML file served by Python's `ThreadingHTTPServer`. The full Three.js scene (3000+ LOC of JavaScript) is inlined.

Key rendering systems:
- **Procedural building textures** — CanvasTexture with neon grid, scanlines, bracket corners
- **Flame particle system** — 64-sprite pyramid fire for bottleneck nodes
- **Bezier edge curves** — Animated particle flow along `QuadraticBezierCurve3`
- **Drone navigation** — OrbitControls with WASD fly mode, configurable damping

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `HOST_PROJECT_PATH` | `./data` | Absolute path to dbt project root on the host |
| `MANIFEST_SUBPATH` | `target/manifest.json` | Relative path from project root to manifest |
| `PORT` | `8080` | Port exposed by the HTTP server |

---

## 🧪 Running Tests

```bash
# From the repo root (outside Docker)
pip install pytest
pytest tests/ -v
```

---

## 🗺️ Roadmap

- [ ] **Server-side upload endpoint** — `/api/upload` to receive `manifest.json` via HTTP POST and hot-reload the city without a container restart
- [ ] **WebSocket live reload** — push graph updates to open browser tabs when `manifest.json` changes on disk
- [ ] **Multi-project support** — load and compare multiple dbt projects side by side
- [ ] **Export PNG/SVG** — snapshot the current city view
- [ ] **Cost attribution** — annotate nodes with BigQuery/Snowflake execution cost data

---

## 📜 License

MIT © [Ismaelardoy](https://github.com/Ismaelardoy)