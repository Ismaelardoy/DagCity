import json
import os
import shutil
from typing import Dict, Any


class VizGenerator:
    """
    V5.0 DAG-CITY: Modular Architecture.
    Generates a minimal HTML shell that injects graph data and loads ES6 modules.
    All JS logic has been moved to src/static/js/ modules.
    """

    # Static assets directory (relative to this file)
    STATIC_SRC = os.path.join(os.path.dirname(__file__), '..', 'static')

    HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>DagCity v5.0 | Performance Profiler</title>
<style>
:root {
  --cyan:   #00f3ff;
  --magenta:#ff00ff;
  --green:  #39ff14;
  --orange: #ff6600;
  --red:    #ff2222;
  --panel-bg: rgba(2, 10, 24, 0.94);
  --border: rgba(0, 243, 255, 0.22);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #000; overflow: hidden; font-family: 'Courier New', monospace; color: var(--cyan); }
#canvas-container { width: 100vw; height: 100vh; position: fixed; top: 0; left: 0; }

/* ── HEADER ── */
#header {
  position: fixed; top: 24px; left: 50%; transform: translateX(-50%);
  font-size: 42px; font-weight: 900; letter-spacing: 12px;
  color: var(--magenta); text-shadow: 0 0 22px var(--magenta), 0 0 60px #ff00ff44;
  pointer-events: none; z-index: 50; text-align: center;
  animation: glitch 5s infinite;
}
@keyframes glitch {
  0%,89%,100% { text-shadow: 0 0 22px var(--magenta), 0 0 60px #ff00ff44; transform: translateX(-50%); }
  90% { transform: translateX(calc(-50% + 4px)); text-shadow: -4px 0 var(--cyan), 0 0 22px var(--magenta); }
  91% { transform: translateX(calc(-50% - 4px)); text-shadow: 4px 0 #ff0055, 0 0 22px var(--magenta); }
  92% { transform: translateX(-50%); }
}
#subtitle {
  position: fixed; top: 80px; left: 50%; transform: translateX(-50%);
  font-size: 16px; color: #ff00ff99; letter-spacing: 5px;
  pointer-events: none; z-index: 50;
}

/* ── IDE DOCK (left sidebar, VS Code style) ── */
#ide-dock {
  position: fixed; top: 0; left: 0; height: 100vh; width: 62px;
  z-index: 500; display: flex; flex-direction: column;
  background: rgba(0, 0, 0, 0.5);
  border-right: 1px solid rgba(0, 242, 255, 0.2);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  overflow: hidden;
  transition: width 0.3s cubic-bezier(0.4,0,0.2,1);
  user-select: none;
}
#ide-dock:hover, #ide-dock.expanded { width: 250px; }

.dock-section { display: flex; flex-direction: column; gap: 20px; padding: 20px 0; }
.dock-section.bottom { margin-top: auto; border-top: 1px solid rgba(0,242,255,0.1); }

.dock-item {
  display: flex; align-items: center; gap: 0;
  padding: 12px 18px; cursor: pointer;
  color: #e0e0e0;
  transition: all 0.2s; white-space: nowrap; overflow: hidden;
  border-left: 3px solid transparent;
  font-family: 'Courier New', monospace; font-size: 14px; letter-spacing: 0.5px;
  text-transform: uppercase; position: relative;
}
#ide-dock:hover .dock-item, #ide-dock.expanded .dock-item { gap: 14px; }
.dock-item:hover { 
  color: var(--cyan); 
  background: rgba(0,242,255,0.06); 
  border-left-color: var(--cyan);
  filter: drop-shadow(0 0 5px #00f2ff);
}
.dock-item.active { color: var(--cyan); border-left-color: var(--cyan); background: rgba(0,242,255,0.08); }
.dock-item.perf-on { color: var(--orange); border-left-color: var(--orange); }
.dock-item.ai-item { color: var(--magenta); }
.dock-item.ai-item:hover { color: var(--magenta); background: rgba(255,0,255,0.06); border-left-color: var(--magenta); }
.dock-icon { font-size: 22px; flex-shrink: 0; width: 26px; text-align: center; }
.dock-label { font-size: 13px; opacity: 0; transition: opacity 0.2s 0.1s; pointer-events: none; }
#ide-dock:hover .dock-label, #ide-dock.expanded .dock-label { opacity: 1; }

.dock-divider { height: 1px; background: rgba(0,242,255,0.08); margin: 4px 14px; }

/* ── SLA PANEL ── */
#sla-panel {
  display: none;
  position: fixed; top: 0; left: 62px; width: 420px; height: 100vh;
  background: rgba(2, 6, 18, 0.97);
  border-right: 1px solid rgba(0,242,255,0.2);
  z-index: 600;
  flex-direction: column;
  backdrop-filter: blur(30px);
  -webkit-backdrop-filter: blur(30px);
  box-shadow: 8px 0 40px rgba(0,0,0,0.6);
  animation: sla-slide-in 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}
#sla-panel.open { display: flex; }
@keyframes sla-slide-in {
  from { opacity: 0; transform: translateX(-20px); }
  to   { opacity: 1; transform: translateX(0); }
}
#sla-header {
  padding: 28px 30px 22px;
  border-bottom: 1px solid rgba(0,242,255,0.1);
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0;
}
#sla-title {
  font-size: 13px; letter-spacing: 6px; color: var(--magenta);
  text-shadow: 0 0 12px var(--magenta); font-weight: bold;
}
#sla-close {
  width: 32px; height: 32px; border-radius: 50%;
  border: 1px solid rgba(255,0,255,0.3); background: rgba(255,0,255,0.06);
  color: var(--magenta); cursor: pointer; display: flex;
  align-items: center; justify-content: center; font-size: 16px;
  transition: all 0.2s;
}
#sla-close:hover { background: rgba(255,0,255,0.2); box-shadow: 0 0 12px rgba(255,0,255,0.3); }
#sla-body { flex: 1; overflow-y: auto; padding: 0; }
#sla-body::-webkit-scrollbar { width: 4px; }
#sla-body::-webkit-scrollbar-thumb { background: rgba(0,242,255,0.2); border-radius: 2px; }

.sla-section { padding: 32px 30px; border-bottom: 1px solid rgba(0,242,255,0.06); }
.sla-label { font-size: 13px; color: rgba(0,242,255,0.6); letter-spacing: 4px; margin-bottom: 22px; text-transform: uppercase; font-weight: bold; }
.sla-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.sla-name { font-size: 16px; color: #fff; letter-spacing: 0.5px; }
.sla-val {
  font-size: 28px; font-weight: 900; color: var(--cyan);
  text-shadow: 0 0 8px var(--cyan); font-family: 'Courier New', monospace;
  min-width: 80px; text-align: right;
  cursor: text; padding: 2px 6px; border-radius: 4px; transition: background 0.2s;
}
.sla-val:focus { background: rgba(0,242,255,0.15); outline: none; box-shadow: 0 0 0 1px var(--cyan); }
.sla-desc { font-size: 13px; color: rgba(255,255,255,0.35); margin-bottom: 20px; letter-spacing: 0.5px; line-height: 1.4; }

/* Cockpit slider */
.sla-slider-track { position: relative; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.08); margin: 4px 0 20px; }
.sla-slider-fill { position: absolute; top: 0; left: 0; height: 100%; border-radius: 3px;
  background: linear-gradient(90deg, var(--cyan), var(--magenta)); transition: width 0.1s; pointer-events: none; }
input[type=range].sla-input {
  position: absolute; top: -6px; left: 0; width: 100%; height: 18px;
  appearance: none; background: transparent; outline: none; cursor: pointer; margin: 0;
}
input[type=range].sla-input::-webkit-slider-thumb {
  appearance: none; width: 18px; height: 18px; border-radius: 50%;
  background: var(--cyan); box-shadow: 0 0 10px var(--cyan), 0 0 20px rgba(0,242,255,0.4);
  border: 2px solid rgba(255,255,255,0.8);
}

/* Fire status badge */
.sla-fire-count {
  display: flex; align-items: center; gap: 12px;
  background: rgba(255,60,0,0.08); border: 1px solid rgba(255,60,0,0.25);
  border-radius: 10px; padding: 16px 20px; margin-top: 20px;
}
.sla-fire-count .fire-num { font-size: 42px; font-weight: 900; color: var(--orange); }
.sla-fire-count .fire-label { font-size: 14px; color: #ff9966; letter-spacing: 3px; font-weight: bold; }

/* Zone slider rows */
.zone-row { margin-bottom: 22px; }
.zone-row:last-child { margin-bottom: 0; }
.zone-name { font-size: 14px; letter-spacing: 4px; color: #fff; margin-bottom: 10px; font-weight: bold; }

/* Node overrides */
#sla-node-search {
  width: 100%; background: rgba(0,0,0,0.3);
  border: 1px solid rgba(0,242,255,0.15); border-radius: 8px;
  padding: 12px 16px; color: #fff; font-family: 'Courier New', monospace;
  font-size: 13px; outline: none; margin-bottom: 10px; transition: border-color 0.2s;
}
#sla-node-search:focus { border-color: var(--cyan); }
#sla-node-search::placeholder { color: rgba(255,255,255,0.25); }
#sla-node-results { max-height: 180px; overflow-y: auto; margin-bottom: 14px; }
.sla-result-row { padding: 10px 14px; border-radius: 6px; cursor: pointer; font-size: 12px;
  color: #ccc; transition: background 0.15s; border-bottom: 1px solid rgba(255,255,255,0.04); }
.sla-result-row:hover { background: rgba(0,242,255,0.08); color: var(--cyan); }
.sla-override-item {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.04);
}
.sla-override-label { flex: 1; }
.sla-override-name { font-size: 14px; color: #fff; margin-bottom: 8px; font-weight: bold; }
.sla-override-val { font-size: 18px; color: var(--cyan); font-weight: 900; cursor: text; padding: 2px 4px; border-radius: 4px; }
.sla-override-val:focus { background: rgba(0,242,255,0.15); outline: none; box-shadow: 0 0 0 1px var(--cyan); }
.sla-del { color: var(--red); cursor: pointer; font-size: 16px; padding: 4px 8px; flex-shrink: 0; }
.sla-del:hover { text-shadow: 0 0 8px var(--red); }

/* ── PROJECT MODAL ── */
#project-modal {
  display: none; position: fixed; inset: 0; z-index: 900;
  background: rgba(0,0,0,0.75); backdrop-filter: blur(20px);
  align-items: center; justify-content: center;
}
#project-modal.open { display: flex; }
#pm-card {
  background: rgba(0,8,20,0.95); border: 1px solid rgba(0,242,255,0.25);
  border-radius: 18px; width: min(680px, 92vw); max-height: 80vh;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 0 60px rgba(0,242,255,0.12), 0 30px 80px rgba(0,0,0,0.8);
  animation: pm-enter 0.3s cubic-bezier(0.34,1.56,0.64,1);
}
@keyframes pm-enter {
  from { opacity: 0; transform: scale(0.92) translateY(20px); }
  to   { opacity: 1; transform: scale(1)    translateY(0); }
}
#pm-header {
  padding: 24px 28px 18px; border-bottom: 1px solid rgba(0,242,255,0.1);
  display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;
}
#pm-title { font-size: 1.1rem; letter-spacing: 5px; color: var(--cyan); font-weight: bold; }
#pm-close {
  width: 38px; height: 38px; border-radius: 50%; border: 1px solid rgba(255,0,255,0.3);
  background: rgba(255,0,255,0.08); color: var(--magenta); font-size: 18px;
  cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;
}
#pm-close:hover { background: rgba(255,0,255,0.2); box-shadow: 0 0 12px rgba(255,0,255,0.3); }
#pm-body { overflow-y: auto; padding: 20px 28px; flex: 1; }
#pm-body::-webkit-scrollbar { width: 5px; }
#pm-body::-webkit-scrollbar-thumb { background: rgba(0,242,255,0.2); border-radius: 3px; }
#pm-empty { color: rgba(255,255,255,0.3); text-align: center; padding: 50px 0; letter-spacing: 3px; font-size: 13px; }
.pm-project-row {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 16px; border-radius: 10px; margin-bottom: 8px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
  transition: all 0.2s; cursor: default;
}
.pm-project-row:hover { background: rgba(0,242,255,0.05); border-color: rgba(0,242,255,0.15); }
.pm-project-info { flex: 1; min-width: 0; }
.pm-project-name {
  font-size: 15px; color: #fff; font-weight: bold; letter-spacing: 1px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pm-project-name input {
  background: transparent; border: none; border-bottom: 1px solid var(--cyan);
  color: var(--cyan); font-size: 15px; font-weight: bold; letter-spacing: 1px;
  outline: none; width: 100%;
}
.pm-project-meta { font-size: 11px; color: rgba(255,255,255,0.35); margin-top: 4px; letter-spacing: 1px; }
.pm-project-actions { display: flex; gap: 8px; flex-shrink: 0; }
.pm-btn {
  font-size: 11px; padding: 6px 14px; border-radius: 6px; cursor: pointer;
  letter-spacing: 1.5px; font-weight: bold; border: 1px solid; transition: all 0.15s;
  font-family: 'Courier New', monospace;
}
.pm-btn-new {
  border-color: var(--green); color: var(--green); background: rgba(0,255,102,0.05);
  margin-right: 12px; font-size: 11px;
}
.pm-btn-new:hover { background: rgba(0,255,102,0.15); box-shadow: 0 0 15px rgba(0,255,102,0.25); }
.pm-btn-load { border-color: var(--cyan); color: var(--cyan); background: transparent; }
.pm-btn-load:hover { background: rgba(0,242,255,0.12); box-shadow: 0 0 10px rgba(0,242,255,0.2); }
.pm-btn-rename { border-color: rgba(255,255,255,0.25); color: rgba(255,255,255,0.5); background: transparent; }
.pm-btn-rename:hover { border-color: var(--magenta); color: var(--magenta); }
.pm-btn-delete { border-color: rgba(255,0,0,0.3); color: rgba(255,80,80,0.8); background: transparent; }
.pm-btn-delete:hover { background: rgba(255,0,0,0.1); border-color: rgba(255,50,50,0.6); }

/* ── LEGEND ── */
#legend {
  position: fixed; bottom: 25px; left: 72px; z-index: 50;
  display: flex; flex-direction: column; gap: 10px; pointer-events: none;
  background: var(--panel-bg); border: 1px solid var(--border);
  border-radius: 12px; padding: 18px 24px; backdrop-filter: blur(10px);
}
.leg-row { display: flex; align-items: center; gap: 14px; font-size: 16px; letter-spacing: 1px; }
.leg-dot { width: 14px; height: 14px; border-radius: 2px; flex-shrink: 0; }

/* ── STATS ── */
#stats {
  position: fixed; bottom: 25px; right: 25px; z-index: 50;
  text-align: right; font-size: 16px; color: #ffffff77; letter-spacing: 2px;
  line-height: 2.0; pointer-events: none;
}

/* ── TOOLTIP ── */
#tooltip {
  position: fixed; pointer-events: none; z-index: 200;
  background: var(--panel-bg); border: 1px solid var(--border);
  border-radius: 10px; padding: 14px 22px; font-size: 16px;
  display: none; backdrop-filter: blur(10px);
  box-shadow: 0 0 16px rgba(0,243,255,0.18);
}

/* ══ DEEP-DIVE SIDEBAR ══ */
#sidebar {
  position: fixed; top: 0; right: 0; width: min(440px, 95vw); height: 100vh;
  z-index: 300; transform: translateX(100%);
  transition: transform 0.4s cubic-bezier(0.22, 1, 0.36, 1);
  background: linear-gradient(160deg, rgba(0,12,28,0.97) 0%, rgba(0,5,18,0.98) 100%);
  backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
  border-left: 1px solid var(--border);
  box-shadow: -20px 0 60px rgba(0,0,0,0.8);
  display: flex; flex-direction: column; overflow: hidden;
}
#sidebar.open { transform: translateX(0); }
#sb-stripe { height: 5px; width: 100%; flex-shrink: 0; background: linear-gradient(90deg, var(--cyan), var(--magenta)); }
#sb-inner { flex: 1; overflow-y: auto; padding: 30px 28px; }
#sb-inner::-webkit-scrollbar { width: 6px; }
#sb-inner::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
#sb-close {
  position: absolute; top: 20px; right: 20px; width: 44px; height: 44px;
  background: rgba(255,0,255,0.1); border: 1px solid var(--magenta);
  border-radius: 50%; color: var(--magenta); font-size: 22px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s; z-index: 10;
}
#sb-close:hover { background: rgba(255,0,255,0.25); box-shadow: 0 0 14px rgba(255,0,255,0.4); }

.sb-node-name {
  font-size: 2.8rem; font-weight: 900; letter-spacing: 4px;
  text-transform: uppercase; margin-bottom: 8px; margin-top: 10px; line-height: 1.1;
}
.sb-path { font-size: 14px; color: #ffffff55; letter-spacing: 1px; margin-bottom: 22px; word-break: break-all; }
.sb-badge {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 14px; padding: 6px 18px; border-radius: 20px;
  border: 1px solid currentColor; letter-spacing: 3px; text-transform: uppercase;
  margin-bottom: 25px; margin-right: 10px;
}
.sb-badge .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }

.perf-card {
  border-radius: 14px; padding: 20px 24px; margin-bottom: 22px;
  position: relative; overflow: hidden;
}
.perf-card.normal { background: rgba(0,243,255,0.05); border: 1px solid rgba(0,243,255,0.2); }
.perf-card.bottleneck { background: rgba(255,80,0,0.08); border: 1px solid rgba(255,80,0,0.5); }
.perf-card-label { font-size: 13px; letter-spacing: 4px; text-transform: uppercase; opacity: 0.7; margin-bottom: 10px; }
.perf-time { font-size: 3.2rem; font-weight: 900; line-height: 1; }
.perf-unit { font-size: 16px; opacity: 0.7; margin-left: 6px; }
.perf-source { font-size: 13px; opacity: 0.5; margin-top: 8px; letter-spacing: 1.5px; }

.sb-section-title {
  font-size: 14px; color: #ffffff55; letter-spacing: 4px; text-transform: uppercase;
  margin-bottom: 16px; margin-top: 28px; padding-bottom: 10px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}
.sb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 6px; }
.sb-stat {
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px; padding: 20px 14px; text-align: center;
}
.sb-stat .val { display: block; font-size: 2.6rem; font-weight: bold; color: #fff; line-height: 1; }
.sb-stat .lbl { font-size: 14px; color: #ffffff66; text-transform: uppercase; letter-spacing: 1px; margin-top: 8px; }

.meta-row { display: flex; justify-content: space-between; align-items: center; padding: 14px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 16px; }
.meta-row .key { color: #ffffff66; letter-spacing: 1.5px; }
.meta-row .val { color: #fff; font-size: 18px; }

#schema-search {
  width: 100%; background: rgba(0,243,255,0.04);
  border: 1px solid var(--border); border-radius: 10px;
  padding: 14px 18px; color: var(--cyan); font-family: 'Courier New', monospace;
  font-size: 16px; outline: none; margin-bottom: 14px; transition: border-color 0.2s;
}
#schema-search::placeholder { color: #ffffff33; }
#schema-search:focus { border-color: var(--cyan); box-shadow: 0 0 10px rgba(0,243,255,0.12); }
.col-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 16px; border-radius: 8px; font-size: 16px; transition: background 0.15s;
}
.col-row:hover { background: rgba(0,243,255,0.06); }
.col-name { color: #eee; }
.col-type { color: var(--magenta); font-size: 14px; letter-spacing: 1.5px; }
.no-cols { color: #666; font-size: 16px; font-style: italic; text-align: center; padding: 30px 0; }

/* ── Smart HUD & Help UI ── */
#smart-hud {
  position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
  z-index: 250; padding: 12px 30px; 
  background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(12px);
  border: 1px solid rgba(0, 242, 255, 0.3); border-radius: 40px;
  display: flex; gap: 24px; pointer-events: none;
  opacity: 1; transition: opacity 0.5s ease, transform 0.5s ease;
  box-shadow: 0 4px 30px rgba(0,0,0,0.4);
}
#smart-hud.hidden { opacity: 0; transform: translate(-50%, 15px); }
.hud-item {
  display: flex; align-items: center; gap: 10px;
  font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 12px; color: #fff; letter-spacing: 1.5px; white-space: nowrap;
}
.hud-icon { font-size: 16px; opacity: 0.9; }
.hud-label { color: var(--cyan); font-weight: bold; }

#help-trigger-left {
  position: fixed; bottom: 320px; left: 72px; z-index: 250;
  width: 46px; height: 46px; border-radius: 50%;
  border: 2px solid var(--cyan); background: rgba(0, 0, 0, 0.7);
  color: var(--cyan); display: flex; align-items: center; justify-content: center;
  font-size: 24px; font-weight: bold; cursor: help; backdrop-filter: blur(12px);
  transition: all 0.3s; animation: help-pulse 2s infinite;
}
@keyframes help-pulse {
  0% { box-shadow: 0 0 0 0 rgba(0, 242, 255, 0.5); }
  70% { box-shadow: 0 0 0 15px rgba(0, 242, 255, 0); }
  100% { box-shadow: 0 0 0 0 rgba(0, 242, 255, 0); }
}
#help-trigger-left:hover { background: var(--cyan); color: #000; box-shadow: 0 0 30px var(--cyan); animation: none; }

#help-hint {
  position: fixed; bottom: 326px; left: 130px; z-index: 250;
  background: #ffff00; color: #000; padding: 10px 18px;
  border-radius: 10px; font-size: 13px; font-weight: 900; letter-spacing: 1.5px;
  white-space: nowrap; pointer-events: none;
  opacity: 0; transform: translateX(-20px);
  transition: opacity 0.8s ease, transform 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  box-shadow: 0 0 25px rgba(255, 255, 0, 0.5);
  animation: hint-entry 0.8s forwards 0.5s;
}
@keyframes hint-entry { to { opacity: 1; transform: translateX(0); } }
#help-hint::after {
  content: ''; position: absolute; left: -8px; top: 12px;
  border-top: 8px solid transparent; border-bottom: 8px solid transparent;
  border-right: 8px solid #ffff00;
}
#help-hint.fade-out { opacity: 0; visibility: hidden; }

/* Awaiting overlay styles */
#awaiting-overlay {
  position: fixed; inset: 0; z-index: 999;
  background: rgba(0, 0, 8, 0.92);
  backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
  flex-direction: column; align-items: center; justify-content: center;
  font-family: 'Courier New', monospace; text-align: center;
  transition: opacity 0.6s ease, transform 0.6s ease;
  display: flex;
}
#dz-cancel {
  position: absolute; top: 30px; right: 40px;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  color: #fff; width: 44px; height: 44px; border-radius: 50%;
  display: none; align-items: center; justify-content: center;
  cursor: pointer; font-size: 18px; transition: all 0.2s;
  backdrop-filter: blur(5px); z-index: 1001;
}
#dz-cancel:hover { background: rgba(255,0,0,0.2); border-color: rgba(255,0,0,0.4); transform: rotate(90deg); }
#awaiting-overlay.hiding {
  opacity: 0 !important; transform: scale(1.04); pointer-events: none;
}
.az-inner {
  position: relative; z-index: 2;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 32px 16px;
}
.az-logo { display:flex; align-items:center; gap:16px; margin-bottom:36px; }
.az-logo-glyph {
  font-size:40px; color:#ff00ff;
  text-shadow: 0 0 18px #ff00ff, 0 0 40px #ff00ff44;
  animation: glyph-spin 8s linear infinite;
}
@keyframes glyph-spin {
  0% { transform: rotate(0deg) scale(1); } 50% { transform: rotate(180deg) scale(1.15); } 100% { transform: rotate(360deg) scale(1); }
}
.az-logo-text { font-size: 2.4rem; font-weight:900; letter-spacing:10px; color:#ff00ff; text-shadow: 0 0 20px #ff00ff, 0 0 60px #ff00ff44; }
.az-headline {
  font-size: clamp(1.6rem, 4vw, 2.8rem); font-weight:900;
  letter-spacing: 8px; color:#00f3ff;
  text-shadow: 0 0 25px #00f3ff, 0 0 60px #00f3ff33;
  margin-bottom: 14px; text-transform: uppercase;
}
.az-sub { font-size: 0.95rem; color: #ffffff66; letter-spacing: 2px; line-height: 1.7; max-width: 520px; margin-bottom: 40px; }
.az-file-tag {
  color: #00f3ff; background: rgba(0,243,255,0.1);
  border: 1px solid rgba(0,243,255,0.3); border-radius: 4px; padding: 1px 8px; font-size: 0.85em;
}
#drop-zone {
  width: min(520px, 88vw); padding: 40px 28px;
  border: 2px dashed rgba(0,243,255,0.35); border-radius: 20px;
  background: rgba(0,243,255,0.03); cursor: pointer;
  transition: all 0.25s cubic-bezier(.22,1,.36,1); position: relative; overflow: hidden;
}
#drop-zone::before {
  content: ''; position: absolute; inset: 0; border-radius: 18px;
  background: radial-gradient(ellipse at 50% 0%, rgba(0,243,255,0.07) 0%, transparent 70%); pointer-events: none;
}
#drop-zone.dz-hover {
  border-color: #00f3ff; background: rgba(0,243,255,0.08);
  box-shadow: 0 0 50px rgba(0,243,255,0.25), inset 0 0 30px rgba(0,243,255,0.05); transform: scale(1.01);
}
.dz-icon-idle svg { filter: drop-shadow(0 0 8px #00f3ff88); animation: float-icon 3s ease-in-out infinite; }
@keyframes float-icon { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
.dz-icon-hover svg { animation: none; filter: drop-shadow(0 0 20px #00f3ff) drop-shadow(0 0 40px #00f3ff66); }
.dz-title { font-size: 1.3rem; font-weight:900; letter-spacing:5px; color:#00f3ff; margin: 16px 0 8px; }
.dz-text { font-size:0.85rem; color:#ffffff55; line-height:1.8; }
.dz-slot {
  display:flex; align-items:center; gap:8px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(0,243,255,0.2);
  border-radius: 10px; padding: 10px 18px; font-size:0.8rem;
  color:#ffffff88; transition: all 0.3s; min-width: 170px; justify-content: center;
}
.dz-slot.dz-slot-optional { border-color: rgba(255,0,255,0.2); }
.dz-slot.dz-slot-loaded { border-color: #39ff14; color: #39ff14; background: rgba(57,255,20,0.07); box-shadow: 0 0 14px rgba(57,255,20,0.2); }
.dz-slot-icon { font-size:1.1rem; }
.dz-slot-check { color:#39ff14; font-size:1rem; font-weight:bold; }
.az-btn {
  margin-top: 32px; background: rgba(0,243,255,0.08); border: 1.5px solid rgba(0,243,255,0.4);
  color: #00f3ff; font-family: 'Courier New', monospace; font-size: 1.1rem; font-weight: 900;
  letter-spacing: 4px; padding: 16px 48px; border-radius: 12px; cursor: pointer;
  transition: all 0.25s; text-transform: uppercase; box-shadow: 0 0 20px rgba(0,243,255,0.1);
}
.az-btn:hover:not(:disabled) { background: rgba(0,243,255,0.18); box-shadow: 0 0 45px rgba(0,243,255,0.4); transform: translateY(-2px); }
.az-btn:disabled { opacity: 0.3; cursor: not-allowed; border-color: rgba(0,243,255,0.15); }
.az-btn.ready {
  border-color: #ff00ff; color: #ff00ff; box-shadow: 0 0 25px rgba(255,0,255,0.3);
  background: rgba(255,0,255,0.08); animation: btn-pulse 1.4s ease-in-out infinite;
}
@keyframes btn-pulse { 0%,100% { box-shadow: 0 0 20px rgba(255,0,255,0.3); } 50% { box-shadow: 0 0 60px rgba(255,0,255,0.6), 0 0 100px rgba(255,0,255,0.2); } }
.az-btn.ready:hover { background: rgba(255,0,255,0.2); transform: translateY(-2px); }
.az-status { margin-top: 18px; font-size: 0.88rem; color: #39ff14; min-height: 22px; letter-spacing: 2px; }
.az-loader-track { width: 100%; height: 4px; background: rgba(0,243,255,0.1); border-radius: 2px; overflow: hidden; }
.az-loader-bar {
  height: 100%; background: linear-gradient(90deg, #00f3ff, #ff00ff); border-radius: 2px; width: 0%;
  animation: loader-scan 1.8s ease-in-out infinite;
}
@keyframes loader-scan { 0% { width: 0%; margin-left: 0; } 50% { width: 75%; margin-left: 0; } 100% { width: 0%; margin-left: 100%; } }
.az-loader-label { margin-top: 10px; font-size: 0.78rem; letter-spacing: 3px; color: #00f3ff88; text-align: center; }

  /* Global Error Overlay */
  #js-error-overlay {
    display: none; position: fixed; top: 20px; left: 20px; right: 20px;
    background: rgba(255, 0, 0, 0.9); color: white; padding: 20px;
    border-radius: 12px; z-index: 10000; font-family: 'JetBrains Mono', monospace;
    box-shadow: 0 0 30px rgba(255, 0, 0, 0.5); border: 2px solid white;
  }
</style>

<script>
  window.addEventListener('error', function(e) {
    const overlay = document.getElementById('js-error-overlay');
    if (overlay) {
      overlay.style.display = 'block';
      overlay.innerHTML = '<div style="font-weight:bold;margin-bottom:10px;">⚠️ DAG_CITY CRITICAL JS ERROR</div>' +
                          '<div>' + e.message + '</div>' +
                          '<div style="font-size:10px;margin-top:10px;opacity:0.8;">' + e.filename + ':' + e.lineno + '</div>';
    }
  });
</script>
</head>
<body>
<div id="js-error-overlay"></div>
<div id="canvas-container"></div>
<div id="header">DAG_CITY</div>
<div id="subtitle">PERFORMANCE PROFILER · OBSERVABILITY ENGINE V5.0</div>

<!-- AWAITING DATA OVERLAY -->
<div id="awaiting-overlay" style="display:none;">
  <button id="dz-cancel" title="Back to City">✕</button>
  <canvas id="az-bg" style="position:absolute;inset:0;width:100%;height:100%;opacity:0.18;"></canvas>
  <div class="az-inner">
    <div class="az-logo">
      <div class="az-logo-glyph">&#9670;</div>
      <div class="az-logo-text">DAG_CITY</div>
    </div>
    <div class="az-headline">INITIALIZE METROPOLIS</div>
    <div class="az-sub">Drop your dbt <span class="az-file-tag">manifest.json</span> and optional <span class="az-file-tag">run_results.json</span> here to build your city.</div>
    <div id="drop-zone" ondragover="dzDragOver(event);" ondragleave="dzDragLeave(event);" ondrop="dzDrop(event);" onclick="document.getElementById('manifest-upload').click();">
      <div id="dz-icon" class="dz-icon-idle">
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
          <path d="M28 6v30M16 20l12-14 12 14" stroke="#00f3ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          <rect x="8" y="38" width="40" height="12" rx="4" stroke="#00f3ff" stroke-width="2" fill="none"/>
          <circle cx="15" cy="44" r="2" fill="#00f3ff"/>
          <circle cx="41" cy="44" r="2" fill="#ff00ff"/>
        </svg>
      </div>
      <div id="dz-title" class="dz-title">DRAG &amp; DROP FILES</div>
      <div id="dz-sub" class="dz-text">manifest.json &nbsp;+&nbsp; run_results.json (optional)<br><span style="font-size:0.75rem;opacity:0.5;">or click to browse</span></div>
      <div id="dz-slots" style="margin-top:20px;display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">
        <div id="slot-manifest" class="dz-slot" title="manifest.json">
          <span class="dz-slot-icon">&#128196;</span>
          <span id="slot-manifest-name">manifest.json</span>
          <span id="slot-manifest-check" class="dz-slot-check" style="display:none;">&#10003;</span>
        </div>
        <div id="slot-results" class="dz-slot dz-slot-optional" title="run_results.json (optional)">
          <span class="dz-slot-icon">&#9201;</span>
          <span id="slot-results-name">run_results.json</span>
          <span id="slot-results-check" class="dz-slot-check" style="display:none;">&#10003;</span>
        </div>
      </div>
    </div>
    <input type="file" id="manifest-upload" accept=".json" multiple style="display:none" onchange="dzFileInput(this)">
    <button id="az-launch-btn" class="az-btn" onclick="dzLaunch()" disabled>&#127961; LAUNCH CITY</button>
    <div id="upload-status" class="az-status"></div>
    <div id="az-loader" style="display:none;width:min(440px,80vw);margin-top:18px;">
      <div class="az-loader-track"><div id="az-loader-bar" class="az-loader-bar"></div></div>
      <div id="az-loader-label" class="az-loader-label">PARSING ARCHITECTURE…</div>
    </div>
  </div>
</div>

<!-- IDE DOCK -->
<div id="ide-dock">
  <div class="dock-section">
    <div class="dock-item" id="dock-projects" title="Project Manager">
      <span class="dock-icon">📁</span>
      <span class="dock-label">PROJECT MANAGER</span>
    </div>
  </div>
  <div class="dock-divider"></div>
  <div class="dock-section">
    <div class="dock-item active" id="dock-rotate" title="Toggle Auto-Rotate">
      <span class="dock-icon">🎥</span>
      <span class="dock-label" id="label-rotate">Auto-Rotate: ON</span>
    </div>
    <div class="dock-item" id="dock-sla" title="SLA &amp; Bottlenecks">
      <span class="dock-icon">🔥</span>
      <span class="dock-label">SLA &amp; Bottlenecks</span>
    </div>
    <div class="dock-item" id="dock-perf" title="Performance 3D Mode">
      <span class="dock-icon">⏱️</span>
      <span class="dock-label" id="label-perf">PERFORMANCE 3D: OFF</span>
    </div>
    <div class="dock-item" id="dock-reset" title="Reset Camera View">
      <span class="dock-icon">🏠</span>
      <span class="dock-label">RESET VIEW</span>
    </div>
  </div>
  <div class="dock-section bottom">
    <div class="dock-item ai-item" id="dock-ai" title="AI Agent (Coming Soon)">
      <span class="dock-icon">✨</span>
      <span class="dock-label">AI AGENT</span>
    </div>
  </div>
</div>

<!-- PROJECT MANAGER MODAL -->
<div id="project-modal">
  <div id="pm-card">
    <div id="pm-header">
      <div id="pm-title">📁 PROJECT MANAGER</div>
      <div style="display:flex; align-items:center;">
        <button class="pm-btn pm-btn-new" id="pm-new-project">+ NEW PROJECT</button>
        <button id="pm-close">✕</button>
      </div>
    </div>
    <div id="pm-body"><div id="pm-list"></div></div>
  </div>
</div>

<div id="legend">
  <div class="leg-row"><div class="leg-dot" style="background:#00ff66"></div>RAW / SEED</div>
  <div class="leg-row"><div class="leg-dot" style="background:#ff0077"></div>STAGING</div>
  <div class="leg-row"><div class="leg-dot" style="background:#9d4edd"></div>INTERMEDIATE</div>
  <div class="leg-row"><div class="leg-dot" style="background:#00f2ff"></div>MARTS</div>
  <div class="leg-row"><div class="leg-dot" style="background:#ffd700"></div>CONSUMPTION / BI</div>
  <div class="leg-row" style="margin-top:4px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.06)">
    <div class="leg-dot" style="background:#ff2222;box-shadow:0 0 8px #ff2222;opacity:0.4"></div>GHOST (DEAD END)
  </div>
  <div class="leg-row" style="margin-top:4px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.06)">
    <div class="leg-dot" style="background:#ff4400;box-shadow:0 0 6px #ff4400"></div>BOTTLENECK
  </div>
</div>

<div id="stats"></div>
<div id="tooltip"></div>

<!-- SLA CONTROL PANEL -->
<div id="sla-panel">
  <div id="sla-header">
    <div id="sla-title">🔥 SLA CONTROL</div>
    <div id="sla-close">✕</div>
  </div>
  <div id="sla-body">
    <div class="sla-section">
      <div class="sla-label">Global SLA Threshold</div>
      <div class="sla-row">
        <div class="sla-name">Execution Time Limit</div>
        <div class="sla-val" id="sla-global-val" contenteditable="true">120s</div>
      </div>
      <div class="sla-desc">Buildings on fire = execution_time &gt; this threshold</div>
      <div class="sla-slider-track">
        <div class="sla-slider-fill" id="sla-global-fill" style="width:12%"></div>
        <input type="range" class="sla-input" id="sla-global-input" min="0" max="1000" value="120">
      </div>
      <div class="sla-fire-count">
        <div class="fire-num" id="sla-fire-count">0</div>
        <div class="fire-label">NODES<br>ON FIRE</div>
      </div>
    </div>
    <div class="sla-section">
      <div class="sla-label">Zone Overrides (by Layer)</div>
      <div id="sla-zones"><!-- dynamic --></div>
    </div>
    <div class="sla-section">
      <div class="sla-label">Custom Node Overrides</div>
      <input type="text" id="sla-node-search" placeholder="🔍  Search node name…">
      <div id="sla-node-results"></div>
      <div id="sla-overrides-list"></div>
    </div>
  </div>
</div>

<div id="sidebar">
  <div id="sb-stripe"></div>
  <button id="sb-close">✕</button>
  <div id="sb-inner"><div id="sb-content"></div></div>
</div>

<div id="help-trigger-left">?</div>
<div id="help-hint">DRONE NAVIGATION GUIDE ➜</div>
<div id="smart-hud">
  <div class="hud-item"><span class="hud-icon">🖱️</span> <span class="hud-label">L-CLICK</span> → ORBIT</div>
  <div style="color:rgba(255,255,255,0.2)">•</div>
  <div class="hud-item"><span class="hud-icon">🎯</span> <span class="hud-label">R-CLICK | ⌨️ WASD</span> → FLY</div>
  <div style="color:rgba(255,255,255,0.2)">•</div>
  <div class="hud-item"><span class="hud-icon">🎡</span> <span class="hud-label">SCROLL</span> → ZOOM</div>
  <div style="color:rgba(255,255,255,0.2)">•</div>
  <div class="hud-item"><span class="hud-icon">👆</span> <span class="hud-label">SELECT</span> → INSPECT</div>
</div>

<!-- Three.js CDN -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.134.0/examples/js/controls/OrbitControls.js"></script>

<!-- Data injection -->
<script>
window.__RAW__ = $DATA_PAYLOAD;
</script>

<!-- ES6 Module entry point -->
<script type="module" src="/static/js/main.js?v=$BUILD_HASH"></script>
</body>
</html>"""

    def generate(self, graph_data: Dict[str, Any], output_path: str):
        import hashlib, time
        build_hash = hashlib.md5(str(time.time()).encode()).hexdigest()[:8]
        html = (self.HTML_TEMPLATE
                .replace("$DATA_PAYLOAD", json.dumps(graph_data, indent=2))
                .replace("$BUILD_HASH", build_hash))
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html)

        # Copy static JS assets to the viz_output directory
        self._sync_static(os.path.dirname(output_path))
        return os.path.abspath(output_path)

    def _sync_static(self, viz_dir: str):
        """Copy src/static/ assets to the viz output directory so FastAPI can serve them."""
        src_static = os.path.abspath(self.STATIC_SRC)
        dst_static = os.path.join(viz_dir, 'static')
        if os.path.isdir(src_static):
            if os.path.exists(dst_static):
                shutil.rmtree(dst_static)
            shutil.copytree(src_static, dst_static)
