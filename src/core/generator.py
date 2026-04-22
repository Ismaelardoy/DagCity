import json
import os
import io
import sys
import threading
from http.server import BaseHTTPRequestHandler, SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Dict, Any


class VizGenerator:
    """
    V4.1 DAG-CITY: Full Cyberpunk dbt Observability Engine.
    - Fixed click detection (full mesh hierarchy traversal).
    - Fixed edge highlighting (always-on particles + bright on selection).
    - Performance Profiler: building height ∝ execution_time.
    - Heatmap halo for bottleneck nodes (top 10%).
    - ⏱️ Toggle Performance 3D button.
    """

    HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>DagCity v4.1 | Performance Profiler</title>
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

/* ── CONTROL BAR (top-left) ── */
#controls-bar {
  position: fixed; top: 25px; left: 25px; z-index: 100;
  display: flex; flex-direction: column; gap: 12px;
}
.ctrl-btn {
  background: var(--panel-bg); border: 1px solid var(--border);
  color: var(--cyan); font-family: 'Courier New', monospace;
  font-size: 18px; font-weight: bold; letter-spacing: 1px; padding: 14px 26px;
  border-radius: 10px; cursor: pointer; transition: all 0.2s;
  backdrop-filter: blur(12px);
  box-shadow: 0 0 12px rgba(0,243,255,0.1);
  white-space: nowrap;
}
.ctrl-btn:hover { border-color: var(--cyan); box-shadow: 0 0 18px rgba(0,243,255,0.35); color: #fff; }
.ctrl-btn.active { border-color: var(--magenta); color: var(--magenta); box-shadow: 0 0 14px rgba(255,0,255,0.35); }
.ctrl-btn.perf-on { border-color: var(--orange); color: var(--orange); box-shadow: 0 0 14px rgba(255,102,0,0.35); }

/* ── LEGEND (bottom-left) ── */
#legend {
  position: fixed; bottom: 25px; left: 25px; z-index: 50;
  display: flex; flex-direction: column; gap: 10px; pointer-events: none;
  background: var(--panel-bg); border: 1px solid var(--border);
  border-radius: 12px; padding: 18px 24px; backdrop-filter: blur(10px);
}
.leg-row { display: flex; align-items: center; gap: 14px; font-size: 16px; letter-spacing: 1px; }
.leg-dot { width: 14px; height: 14px; border-radius: 2px; flex-shrink: 0; }

/* ── STATS (bottom-right) ── */
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

/* Performance card */
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

#stats {
  position: fixed; bottom: 25px; right: 25px; z-index: 50;
  text-align: right; font-size: 16px; color: #ffffff77; letter-spacing: 2px;
  line-height: 2.0; pointer-events: none;
}

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
  position: fixed; bottom: 320px; left: 25px; z-index: 250;
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
#help-trigger-left:hover ~ #smart-hud { opacity: 1; transform: translate(-50%, 0); }
#help-trigger-left:hover ~ #help-hint { opacity: 0; }

/* Discovery Hint - Cyberpunk Yellow Entry Animation */
#help-hint {
  position: fixed; bottom: 326px; left: 85px; z-index: 250;
  background: #ffff00; color: #000; padding: 10px 18px;
  border-radius: 10px; font-size: 13px; font-weight: 900; letter-spacing: 1.5px;
  white-space: nowrap; pointer-events: none;
  opacity: 0; transform: translateX(-20px);
  transition: opacity 0.8s ease, transform 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  box-shadow: 0 0 25px rgba(255, 255, 0, 0.5);
  animation: hint-entry 0.8s forwards 0.5s;
}
@keyframes hint-entry {
  to { opacity: 1; transform: translateX(0); }
}
#help-hint::after {
  content: ''; position: absolute; left: -8px; top: 12px;
  border-top: 8px solid transparent; border-bottom: 8px solid transparent;
  border-right: 8px solid #ffff00;
}
#help-hint.fade-out { opacity: 0; visibility: hidden; }
</style>
</head>
<body>
<div id="canvas-container"></div>
<div id="header">DAG_CITY</div>
<div id="subtitle">PERFORMANCE PROFILER · OBSERVABILITY ENGINE V4.1</div>

<!-- ══ INITIALIZE METROPOLIS — Awaiting Data Overlay ══ -->
<div id="awaiting-overlay" style="display:none;">

  <!-- Background grid scan animation -->
  <canvas id="az-bg" style="position:absolute;inset:0;width:100%;height:100%;opacity:0.18;"></canvas>

  <div class="az-inner">
    <!-- Logo -->
    <div class="az-logo">
      <div class="az-logo-glyph">&#9670;</div>
      <div class="az-logo-text">DAG_CITY</div>
    </div>

    <!-- Title -->
    <div class="az-headline">INITIALIZE METROPOLIS</div>
    <div class="az-sub">Drop your dbt <span class="az-file-tag">manifest.json</span> and optional <span class="az-file-tag">run_results.json</span> here to build your city.</div>

    <!-- Drop Zone -->
    <div id="drop-zone"
      ondragover="dzDragOver(event);"
      ondragleave="dzDragLeave(event);"
      ondrop="dzDrop(event);"
      onclick="document.getElementById('manifest-upload').click();">

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

      <!-- File slots -->
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

    <!-- Hidden file input (allows multi-select) -->
    <input type="file" id="manifest-upload" accept=".json" multiple style="display:none" onchange="dzFileInput(this)">

    <!-- Upload button -->
    <button id="az-launch-btn" class="az-btn" onclick="dzLaunch()" disabled>&#127961; LAUNCH CITY</button>

    <!-- Status / Loader -->
    <div id="upload-status" class="az-status"></div>

    <!-- Loader bar -->
    <div id="az-loader" style="display:none;width:min(440px,80vw);margin-top:18px;">
      <div class="az-loader-track">
        <div id="az-loader-bar" class="az-loader-bar"></div>
      </div>
      <div id="az-loader-label" class="az-loader-label">PARSING ARCHITECTURE…</div>
    </div>
  </div>
</div>

<style>
/* ══ Overlay wrapper ══ */
#awaiting-overlay {
  position: fixed; inset: 0; z-index: 999;
  background: rgba(0, 0, 8, 0.92);
  backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
  flex-direction: column; align-items: center; justify-content: center;
  font-family: 'Courier New', monospace; text-align: center;
  transition: opacity 0.6s ease, transform 0.6s ease;
}
#awaiting-overlay.hiding {
  opacity: 0 !important;
  transform: scale(1.04);
  pointer-events: none;
}
.az-inner {
  position: relative; z-index: 2;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 32px 16px;
}
/* Logo */
.az-logo { display:flex; align-items:center; gap:16px; margin-bottom:36px; }
.az-logo-glyph {
  font-size:40px; color:#ff00ff;
  text-shadow: 0 0 18px #ff00ff, 0 0 40px #ff00ff44;
  animation: glyph-spin 8s linear infinite;
}
@keyframes glyph-spin {
  0% { transform: rotate(0deg) scale(1); }
  50% { transform: rotate(180deg) scale(1.15); }
  100% { transform: rotate(360deg) scale(1); }
}
.az-logo-text {
  font-size: 2.4rem; font-weight:900; letter-spacing:10px;
  color:#ff00ff; text-shadow: 0 0 20px #ff00ff, 0 0 60px #ff00ff44;
}
/* Headline */
.az-headline {
  font-size: clamp(1.6rem, 4vw, 2.8rem); font-weight:900;
  letter-spacing: 8px; color:#00f3ff;
  text-shadow: 0 0 25px #00f3ff, 0 0 60px #00f3ff33;
  margin-bottom: 14px; text-transform: uppercase;
}
.az-sub {
  font-size: 0.95rem; color: #ffffff66; letter-spacing: 2px; line-height: 1.7;
  max-width: 520px; margin-bottom: 40px;
}
.az-file-tag {
  color: #00f3ff; background: rgba(0,243,255,0.1);
  border: 1px solid rgba(0,243,255,0.3); border-radius: 4px;
  padding: 1px 8px; font-size: 0.85em;
}
/* Drop zone */
#drop-zone {
  width: min(520px, 88vw); padding: 40px 28px;
  border: 2px dashed rgba(0,243,255,0.35); border-radius: 20px;
  background: rgba(0,243,255,0.03); cursor: pointer;
  transition: all 0.25s cubic-bezier(.22,1,.36,1);
  position: relative; overflow: hidden;
}
#drop-zone::before {
  content: ''; position: absolute; inset: 0; border-radius: 18px;
  background: radial-gradient(ellipse at 50% 0%, rgba(0,243,255,0.07) 0%, transparent 70%);
  pointer-events: none;
}
#drop-zone.dz-hover {
  border-color: #00f3ff;
  background: rgba(0,243,255,0.08);
  box-shadow: 0 0 50px rgba(0,243,255,0.25), inset 0 0 30px rgba(0,243,255,0.05);
  transform: scale(1.01);
}
/* Upload icon */
.dz-icon-idle svg { filter: drop-shadow(0 0 8px #00f3ff88); animation: float-icon 3s ease-in-out infinite; }
@keyframes float-icon {
  0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); }
}
.dz-icon-hover svg { animation: none; filter: drop-shadow(0 0 20px #00f3ff) drop-shadow(0 0 40px #00f3ff66); }
.dz-title { font-size: 1.3rem; font-weight:900; letter-spacing:5px; color:#00f3ff; margin: 16px 0 8px; }
.dz-text { font-size:0.85rem; color:#ffffff55; line-height:1.8; }
/* File slots */
.dz-slot {
  display:flex; align-items:center; gap:8px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(0,243,255,0.2);
  border-radius: 10px; padding: 10px 18px; font-size:0.8rem;
  color:#ffffff88; transition: all 0.3s; min-width: 170px; justify-content: center;
}
.dz-slot.dz-slot-optional { border-color: rgba(255,0,255,0.2); }
.dz-slot.dz-slot-loaded {
  border-color: #39ff14; color: #39ff14;
  background: rgba(57,255,20,0.07);
  box-shadow: 0 0 14px rgba(57,255,20,0.2);
}
.dz-slot-icon { font-size:1.1rem; }
.dz-slot-check { color:#39ff14; font-size:1rem; font-weight:bold; }
/* Launch button */
.az-btn {
  margin-top: 32px;
  background: rgba(0,243,255,0.08);
  border: 1.5px solid rgba(0,243,255,0.4);
  color: #00f3ff; font-family: 'Courier New', monospace;
  font-size: 1.1rem; font-weight: 900; letter-spacing: 4px;
  padding: 16px 48px; border-radius: 12px; cursor: pointer;
  transition: all 0.25s; text-transform: uppercase;
  box-shadow: 0 0 20px rgba(0,243,255,0.1);
}
.az-btn:hover:not(:disabled) {
  background: rgba(0,243,255,0.18);
  box-shadow: 0 0 45px rgba(0,243,255,0.4);
  transform: translateY(-2px);
}
.az-btn:disabled {
  opacity: 0.3; cursor: not-allowed; border-color: rgba(0,243,255,0.15);
}
.az-btn.ready {
  border-color: #ff00ff; color: #ff00ff;
  box-shadow: 0 0 25px rgba(255,0,255,0.3);
  background: rgba(255,0,255,0.08);
  animation: btn-pulse 1.4s ease-in-out infinite;
}
@keyframes btn-pulse {
  0%,100% { box-shadow: 0 0 20px rgba(255,0,255,0.3); }
  50%      { box-shadow: 0 0 60px rgba(255,0,255,0.6), 0 0 100px rgba(255,0,255,0.2); }
}
.az-btn.ready:hover { background: rgba(255,0,255,0.2); transform: translateY(-2px); }
/* Status & loader */
.az-status {
  margin-top: 18px; font-size: 0.88rem; color: #39ff14;
  min-height: 22px; letter-spacing: 2px;
}
.az-loader-track {
  width: 100%; height: 4px; background: rgba(0,243,255,0.1);
  border-radius: 2px; overflow: hidden;
}
.az-loader-bar {
  height: 100%; background: linear-gradient(90deg, #00f3ff, #ff00ff);
  border-radius: 2px; width: 0%;
  animation: loader-scan 1.8s ease-in-out infinite;
}
@keyframes loader-scan {
  0%   { width: 0%;   margin-left: 0; }
  50%  { width: 75%;  margin-left: 0; }
  100% { width: 0%;   margin-left: 100%; }
}
.az-loader-label {
  margin-top: 10px; font-size: 0.78rem; letter-spacing: 3px;
  color: #00f3ff88; text-align: center;
}
@keyframes pulse-icon {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.08); opacity: 0.75; }
}
</style>

<div id="controls-bar">
  <button class="ctrl-btn active" id="btn-rotate">🎥 Auto-Rotate: ON</button>
  <button class="ctrl-btn" id="btn-perf">⏱️ Performance 3D: OFF</button>
  <button class="ctrl-btn" id="btn-reset">🏠 Reset View</button>
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

<div id="instructions">CLICK BUILDING → DEEP DIVE &nbsp;·&nbsp; DRAG → ORBIT &nbsp;·&nbsp; SCROLL → ZOOM</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.134.0/examples/js/controls/OrbitControls.js"></script>
<script>
// ═══════ DATA ═══════
const RAW = $DATA_PAYLOAD;
const AWAITING_DATA = RAW.status === 'awaiting_upload';

// ── Show 'Awaiting Data' overlay if no manifest was loaded ───────────────
if (AWAITING_DATA) {
  const overlay = document.getElementById('awaiting-overlay');
  if (overlay) overlay.style.display = 'flex';
}

// ═══════ PERFORMANCE METRICS ═══════
// Guard against empty array — Math.max/min of empty spread returns ±Infinity
const maxTime  = RAW.nodes.length ? Math.max(...RAW.nodes.map(n => n.execution_time)) : 0;
const minTime  = RAW.nodes.length ? Math.min(...RAW.nodes.map(n => n.execution_time)) : 0;
const hasReal  = RAW.metadata?.has_real_times || false;

const LAYER_PALETTE = {
  "source":       { "color": "#00ff66", "emissive": "#006622" },
  "staging":      { "color": "#ff0077", "emissive": "#7a0033" },
  "intermediate": { "color": "#9d4edd", "emissive": "#4a007a" },
  "mart":         { "color": "#00f2ff", "emissive": "#006b7a" },
  "consumption":  { "color": "#ffd700", "emissive": "#7a6600" },
  "default":      { "color": "#0066ff", "emissive": "#0033aa" } 
};
const LAYER_X = { source: -300, staging: -100, intermediate: 100, mart: 300, consumption: 500, default: 650 };
const nodeMap = {};
const lCnt = {}, lIdx = {};
RAW.nodes.forEach(n => { const l = n.layer||'default'; lCnt[l]=(lCnt[l]||0)+1; lIdx[l]=0; });
RAW.nodes.forEach((n, i) => {
  const l  = n.layer||'default';
  n.x = LAYER_X[l] ?? 0;
  n.z = (lIdx[l] - (lCnt[l]-1)/2) * 70;
  n.y = 0; lIdx[l]++; n._delay = i * 90;
  nodeMap[n.id] = n;
});

// ═══════ SCENE ═══════
const W = window.innerWidth, H = window.innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.getElementById('canvas-container').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000408);

const INIT_CAM = { x: 0, y: 110, z: 280 };
const camera = new THREE.PerspectiveCamera(55, W/H, 0.1, 5000);
camera.position.set(INIT_CAM.x, INIT_CAM.y, INIT_CAM.z);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; 
controls.dampingFactor = 0.05; 
controls.zoomSpeed = 1.2; // Reliable & snappy
controls.autoRotate = true; 
controls.autoRotateSpeed = 0.25; // Smoother, more cinematic
controls.minDistance = 40; 
controls.maxDistance = 1400;
controls.enablePan = true;

// Lights
scene.add(new THREE.AmbientLight(0x101c2e, 3.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(80, 200, 120); scene.add(sun);

// Grid
const grid = new THREE.GridHelper(800, 80, 0x003366, 0x001122);
grid.material.opacity = 0.5; grid.material.transparent = true;
scene.add(grid);

// Invisible zoom floor (large plane at y=0)
const zoomFloorGeo = new THREE.PlaneGeometry(2000, 2000);
zoomFloorGeo.rotateX(-Math.PI / 2);
const zoomFloor = new THREE.Mesh(zoomFloorGeo, new THREE.MeshBasicMaterial({ visible: false }));
scene.add(zoomFloor);

// ═══════ HELPERS ═══════
function getFullLineage(id) {
  const vis = new Set();
  const q = [id];
  while(q.length) {
    const cur = q.shift();
    if(vis.has(cur)) continue;
    vis.add(cur);
    const n = nodeMap[cur];
    if(n) {
      (n.upstream || []).forEach(u => q.push(u));
      (n.downstream || []).forEach(d => q.push(d));
    }
  }
  return vis;
}

function findNodeInHierarchy(obj) {
  let o = obj;
  while (o) {
    if (o.userData && o.userData.node) return o.userData.node;
    o = o.parent;
  }
  return null;
}

function makeFaceTex(label, hex, layer) {
  const S = 512; const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0,0,S,S);
  const bg = layer==='source'?['#05200a','#0a3010']:layer==='staging'?['#200520','#300830']:layer==='mart'?['#001e22','#003035']:['#0d0d12','#181820'];
  g.addColorStop(0,bg[0]); g.addColorStop(1,bg[1]); ctx.fillStyle=g; ctx.fillRect(0,0,S,S);
  // Fine grid
  ctx.strokeStyle = hex+'22'; ctx.lineWidth=1;
  for(let i=0;i<S;i+=28){ ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,S);ctx.stroke(); ctx.beginPath();ctx.moveTo(0,i);ctx.lineTo(S,i);ctx.stroke(); }
  // Scanlines
  for(let y=0;y<S;y+=4){ ctx.fillStyle='rgba(0,0,0,0.1)'; ctx.fillRect(0,y,S,2); }
  // Brackets
  ctx.strokeStyle=hex; ctx.lineWidth=3;
  [[14,14,1,1],[S-14,14,-1,1],[14,S-14,1,-1],[S-14,S-14,-1,-1]].forEach(([x,y,dx,dy])=>{
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+dx*26,y);ctx.stroke();
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y+dy*26);ctx.stroke();
  });
  // Neon border
  ctx.shadowColor=hex; ctx.shadowBlur=26; ctx.strokeStyle=hex+'99'; ctx.lineWidth=2;
  ctx.strokeRect(18,18,S-36,S-36); ctx.shadowBlur=0;
  return new THREE.CanvasTexture(c);
}

function makeFlameTexture() {
  const S=128; const c=document.createElement('canvas'); c.width=S; c.height=S; const ctx=c.getContext('2d');
  // Gradient for a realistic hot-to-cold transition
  const g = ctx.createLinearGradient(S/2, S, S/2, 0);
  g.addColorStop(0, '#ffffff'); 
  g.addColorStop(0.2, '#fff700'); 
  g.addColorStop(0.4, '#ff6600'); 
  g.addColorStop(0.7, '#ff3300'); 
  g.addColorStop(1, 'transparent');
  
  ctx.fillStyle=g; ctx.beginPath();
  // Complex lick-of-flame shape
  ctx.moveTo(S/2, 0);
  ctx.bezierCurveTo(S*0.8, S*0.2, S*0.9, S*0.6, S*0.75, S);
  ctx.lineTo(S*0.25, S);
  ctx.bezierCurveTo(S*0.1, S*0.6, S*0.2, S*0.2, S/2, 0);
  ctx.fill();
  
  // Add a bright "inner lick"
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.moveTo(S/2, S*0.3);
  ctx.bezierCurveTo(S*0.6, S*0.5, S*0.6, S*0.8, S/2, S*0.9);
  ctx.bezierCurveTo(S*0.4, S*0.8, S*0.4, S*0.5, S/2, S*0.3);
  ctx.fill();
  
  return new THREE.CanvasTexture(c);
}
function makeSmokeTexture() {
  const S=64; const c=document.createElement('canvas'); c.width=S; c.height=S; const ctx=c.getContext('2d');
  const g = ctx.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
  g.addColorStop(0, 'rgba(40,40,45,0.3)'); g.addColorStop(1, 'transparent');
  ctx.fillStyle=g; ctx.fillRect(0,0,S,S);
  return new THREE.CanvasTexture(c);
}
function makeEmberTexture() {
  const S=32; const c=document.createElement('canvas'); c.width=S; c.height=S; const ctx=c.getContext('2d');
  const g = ctx.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#ffaa00'); g.addColorStop(1, 'transparent');
  ctx.fillStyle=g; ctx.fillRect(0,0,S,S);
  return new THREE.CanvasTexture(c);
}
const FLAME_TEX = makeFlameTexture();
const SMOKE_TEX = makeSmokeTexture();
const EMBER_TEX = makeEmberTexture();

function makeSprite(text, hex) {
  const fontSize = text.length > 30 ? 38 : text.length > 20 ? 48 : 64;
  
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.font = `bold ${fontSize}px 'Courier New'`;
  const textWidth = tempCtx.measureText(text).width;
  
  const padding = 100;
  const SW = Math.max(512, textWidth + padding); 
  const SH = 120; 
  
  const c = document.createElement('canvas'); c.width = SW; c.height = SH;
  const ctx = c.getContext('2d'); ctx.clearRect(0,0,SW,SH);
  
  ctx.fillStyle = 'rgba(0,5,14,0.88)';
  const r = 24; 
  ctx.beginPath(); ctx.moveTo(r,0); ctx.lineTo(SW-r,0);
  ctx.quadraticCurveTo(SW,0,SW,r); ctx.lineTo(SW,SH-r); ctx.quadraticCurveTo(SW,SH,SW-r,SH);
  ctx.lineTo(r,SH); ctx.quadraticCurveTo(0,SH,0,SH-r); ctx.lineTo(0,r); ctx.quadraticCurveTo(0,0,r,0); ctx.fill();
  
  ctx.font = tempCtx.font; // Senior UX: Fix missing font assignment
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  
  // High-Fidelity Neon Bloom: Recursive shadow drawing
  ctx.shadowColor = hex;
  ctx.shadowBlur = 40; ctx.fillStyle = hex; ctx.fillText(text, SW/2, SH/2);
  ctx.shadowBlur = 15; ctx.fillStyle = '#fff'; ctx.fillText(text, SW/2, SH/2);
  ctx.shadowBlur = 4; ctx.fillStyle = '#fff'; ctx.fillText(text, SW/2, SH/2);
  
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, transparent:true, depthTest:false}));
  const ratio = SW/SH;
  sp.scale.set(13 * ratio, 13, 1);
  sp.userData.ratio = ratio; 
  sp.raycast = () => {}; 
  return sp;
}

function makeTimeSprite(text, isBottleneck) {
  const S = 512;
  const c = document.createElement('canvas'); c.width = S; c.height = 200;
  const ctx = c.getContext('2d');
  const col = isBottleneck ? '#ff0000' : '#00f3ff';
  const fontSize = isBottleneck ? 120 : 80;
  ctx.font = `bold ${fontSize}px 'Courier New'`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = col; ctx.shadowBlur = 30;
  ctx.fillStyle = col;
  ctx.fillText(text, S/2, 100);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, transparent:true, depthTest:false, blending: THREE.AdditiveBlending}));
  const scaleMult = isBottleneck ? 2.5 : 1.2;
  sp.scale.set(30 * scaleMult, 12 * scaleMult, 1);
  sp.raycast = () => {}; // Ignorar en clics
  return sp;
}


function makeHazardSprite() {
  const S = 128;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  ctx.font = "bold 90px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(255,0,0,0.8)";
  ctx.shadowBlur = 15;
  ctx.fillStyle = "#ff2222";
  ctx.fillText("⚠️", S/2, S/2);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, transparent:true, depthTest:false}));
  sp.scale.set(15, 15, 1);
  return sp;
}

// ═══════ BUILDINGS ═══════
const meshes = [], nodeMeshMap = {};
let perfMode = false;

function calcHeight(n, perf) {
  if (perf) {
    // Performance: height ∝ execution_time (min 6, max ~70)
    const norm = maxTime > minTime ? (n.execution_time - minTime) / (maxTime - minTime) : 0.5;
    return 6 + norm * 64;
  } else {
    // Topology: height by connectivity
    return 14 + (n.downstream?.length||0)*5 + (n.upstream?.length||0)*2;
  }
}

function buildBuilding(n) {
  const col  = n.color || '#ffffff';
  const emis = n.emissive || '#000000';
  const h    = calcHeight(n, false);
  const ph   = calcHeight(n, true);
  const w=13, d=13;

  const ftex  = makeFaceTex(n.name, col, n.layer||'default');
  const faceE = n.layer === 'mart' ? 4.5 : 3.0; // 20%+ Intensity for MARTS
  const sideM = new THREE.MeshStandardMaterial({color:col,emissive:emis,emissiveIntensity:0.1,roughness:0.45,metalness:0.6});
  const topM  = new THREE.MeshStandardMaterial({color:new THREE.Color(col).multiplyScalar(0.7),emissive:emis,emissiveIntensity:0.1,roughness:0.3,metalness:0.9});
  const botM  = new THREE.MeshStandardMaterial({color:new THREE.Color(col).multiplyScalar(0.15),roughness:1});
  const faceM = new THREE.MeshStandardMaterial({map:ftex,emissive:emis,emissiveIntensity:0.1,roughness:0.2});

  if (n.is_dead_end) {
    [sideM, topM, faceM].forEach(m => {
      m.transparent = true;
      m.opacity = 0.35;
    });
  }

  const geo  = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, h/2, 0); 
  const mesh = new THREE.Mesh(geo, [sideM,sideM,topM,botM,faceM,sideM]);
  if (n.is_dead_end) mesh.renderOrder = 5; 
  mesh.position.set(n.x, 0, n.z); 
  mesh.castShadow = true;

  mesh.userData = { node:n, baseH:h, perfH:ph, targetH:h, currentH:h, baseEmis:emis };
  
  if (n.is_dead_end) {
    const hazard = makeHazardSprite();
    mesh.add(hazard);
    mesh.userData.hazard = hazard;
  }

  // Neon edge outline
  mesh.add((() => {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({color:col,transparent:true,opacity:0.85}));
    return e;
  })());

  // FIRE EFFECT for Bottlenecks
  if (n.is_bottleneck) {
    const halo = new THREE.PointLight(0xff4400, 3.5, 60);
    halo.position.set(0, h/2, 0);
    halo.name = 'halo';
    mesh.add(halo);

    const fireGroup = new THREE.Group();
    fireGroup.name = 'fire';
    // Massive Pyramid: 64 Flames for extreme volumetric density
    for (let i=0; i<64; i++) {
      const f = new THREE.Sprite(new THREE.SpriteMaterial({map:FLAME_TEX, blending:THREE.AdditiveBlending, transparent:true, opacity:0.95, depthWrite:false}));
      // Wider spawn base for "Solid Roaring" feeling
      const gx = ((i % 8) / 7 - 0.5) * 16;
      const gz = (Math.floor(i / 8) / 7 - 0.5) * 16;
      const distFromCenter = Math.sqrt(gx*gx + gz*gz);
      const pyramidFactor = Math.max(0.1, 1.0 - (distFromCenter / 14)); 
      
      f.position.set(gx, h, gz);
      f.userData = { 
        phase: Math.random()*100, 
        speed: 0.04 + Math.random()*0.04, 
        baseScale: (20 + Math.random()*12) * pyramidFactor,
        pyramidFactor: pyramidFactor,
        offsetX: gx, offsetZ: gz
      };
      fireGroup.add(f);
    }
    // High-Fidelity Embers: 16 fast rising sparks
    for (let i=0; i<16; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({map:EMBER_TEX, blending:THREE.AdditiveBlending, transparent:true, opacity:0.9, depthWrite:false}));
      s.position.set((Math.random()-0.5)*12, h, (Math.random()-0.5)*12);
      s.userData = { phase: Math.random()*50, speed: 0.1+Math.random()*0.1, baseScale: 1.5+Math.random()*2, isEmber:true };
      s.scale.setScalar(s.userData.baseScale);
      fireGroup.add(s);
    }
    // Subtle Smoke: 8 particles
    for (let i=0; i<8; i++) {
      const sm = new THREE.Sprite(new THREE.SpriteMaterial({map:SMOKE_TEX, transparent:true, opacity:0.2, depthWrite:false}));
      sm.position.set((Math.random()-0.5)*10, h+10, (Math.random()-0.5)*10);
      sm.userData = { phase: Math.random()*40, speed: 0.02+Math.random()*0.03, baseScale: 25+Math.random()*15, isSmoke:true };
      fireGroup.add(sm);
    }
    mesh.add(fireGroup);
  } else {
    const glow = new THREE.PointLight(col, 1.5, 42);
    glow.position.set(0, 2, 0);
    mesh.add(glow);
  }

  // Floating billboard label
  const sp = makeSprite(n.name, col);
  sp.position.set(0, h + 8, 0); 
  sp.name = 'label';
  mesh.add(sp);
  mesh.userData.label = sp;

  const timeSp = makeTimeSprite(`${n.execution_time.toFixed(2)}s`, n.is_bottleneck);
  timeSp.position.set(0, h + 25, 0); // Más altura inicial
  timeSp.visible = false;
  timeSp.name = 'timeLabel';
  mesh.add(timeSp);
  mesh.userData.timeLabel = timeSp;

  mesh.scale.y = 0.001;
  scene.add(mesh);
  meshes.push(mesh);
  nodeMeshMap[n.id] = mesh;
  return mesh;
}
RAW.nodes.forEach(n => buildBuilding(n));

// ═══════ EDGES ═══════
const edgeObjs = [];

function buildEdge(link) {
  const srcId = typeof link.source==='object'?link.source.id:link.source;
  const tgtId = typeof link.target==='object'?link.target.id:link.target;
  const src = nodeMap[srcId], tgt = nodeMap[tgtId];
  if (!src || !tgt) return;
  const A = new THREE.Vector3(src.x, 10, src.z);
  const B = new THREE.Vector3(tgt.x, 10, tgt.z);
  const mid = A.clone().lerp(B,0.5).add(new THREE.Vector3(0,22,0));
  const curve = new THREE.QuadraticBezierCurve3(A,mid,B);
  const pts = curve.getPoints(42);
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({color:0x0a3344,transparent:true,opacity:0.45});
  const line = new THREE.Line(geo,mat);
  scene.add(line);
  // Particles — always visible at low opacity
  const N=5; const particles=[];
  for(let i=0;i<N;i++){
    const pGeo = new THREE.SphereGeometry(0.75,8,8);
    const pMat = new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.25});
    const p = new THREE.Mesh(pGeo,pMat);
    const tgtNode = nodeMap[tgtId];
    const isAccelerated = tgtNode && tgtNode.layer === 'mart';
    const baseSpeed = 0.0035 + Math.random()*0.003;
    p.userData = {curve, t:i/N, speed: isAccelerated ? baseSpeed * 1.8 : baseSpeed };
    scene.add(p);
    particles.push(p);
  }
  edgeObjs.push({line,particles,curve,src:srcId,tgt:tgtId});
}
RAW.links.forEach(l => buildEdge(l));



// ═══════ SELECTION + CRITICAL PATH ═══════
let selectedNode = null;
let critSet = new Set();

function applySelection(node) {
  critSet = new Set(); // Reset recursive set on every new selection
  selectedNode = node;
  const highlightColor = node ? new THREE.Color(node.color) : new THREE.Color(0x00d4e8);

  meshes.forEach(m => {
    const n = m.userData.node;
    if (!n) return;
    const id = n.id;
    
    let inSet = true;
    if (node) {
      if (!critSet.size) critSet = getFullLineage(node.id);
      inSet = critSet.has(id);
    }
    
    const alpha = inSet ? 1.0 : 0.07;
    m.material.forEach(mat => { 
      mat.opacity = alpha; 
      mat.transparent = true; 
      mat.depthWrite = (alpha > 0.1); // Optimization for transparency
    });
    
    m.children.forEach(child => {
      if (child.isLineSegments) child.material.opacity = inSet ? 0.9 : 0.03;
      if (child.isLight) child.intensity = inSet ? (node && id===node.id ? 5.0 : 1.5) : 0.05;
      if (child.isSprite) child.material.opacity = inSet ? 1.0 : 0.07;
    });
  });

  edgeObjs.forEach(e => {
    // Highlight ONLY directly connected edges (1-hop)
    const isConnected = node && (e.src === node.id || e.tgt === node.id);
    const inPath = node ? isConnected : true;
    
    e.line.material.opacity   = node ? (inPath ? 1.0 : 0.02) : 0.45;
    e.line.material.color.copy(node && inPath ? highlightColor : new THREE.Color(0x0a3344));
    e.line.renderOrder = inPath ? 10 : 0; 
    
    e.particles.forEach(p => {
      p.material.opacity = node ? (inPath ? 1.0 : 0.0) : 0.25;
      p.material.color.copy(node && inPath ? highlightColor : new THREE.Color(0xffffff));
      p.scale.setScalar(inPath && node ? 2.5 : 1.0);
    });
  });
}

function resetSelection() {
  critSet = new Set();
  applySelection(null);
  // Restore default low-opacity particles
  edgeObjs.forEach(e => {
    e.particles.forEach(p => { p.material.opacity = 0.25; p.scale.setScalar(1.0); });
  });
}

// ═══════ SIDEBAR ═══════
const sidebar = document.getElementById('sidebar');
const sbContent = document.getElementById('sb-content');

function openSidebar(n) {
  const cols      = n.columns || [];
  const execTime  = n.execution_time || 0;
  const isBN      = n.is_bottleneck;
  const statusCol = isBN ? '#ff4400' : '#39ff14';
  const statusLbl = isBN ? 'BOTTLENECK' : 'HEALTHY';
  const tSrc      = n.time_source === 'real' ? '✓ from run_results.json' : '~ simulated (no run_results)';

  sbContent.innerHTML = `
    <div class="sb-node-name" style="color:${n.color}">${n.name}</div>
    <div class="sb-path" title="Unique ID">${n.id}</div>
    <div class="sb-file-path" style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#888;margin-bottom:15px;word-break:break-all;border-left:2px solid ${n.color};padding-left:8px;">
      <span style="color:#555">File:</span> ${n.file_path}
    </div>
    
    <div style="margin-bottom:20px;">
      <div style="font-size:11px;color:#555;letter-spacing:2px;margin-bottom:8px;">ARCHITECTURAL LAYER</div>
      <span class="sb-badge" style="color:${n.color};border-color:${n.color};font-weight:bold;background:${n.color}15">
        <span class="dot"></span>${n.layer.toUpperCase()}
      </span>
    </div>

    <span class="sb-badge" style="color:${statusCol};border-color:${statusCol}">
      <span class="dot"></span>${statusLbl}
    </span>

    ${n.is_dead_end ? `
      <div style="background:rgba(255,0,0,0.15); border:1px solid #ff2222; border-radius:10px; padding:18px; margin-bottom:25px; box-shadow: 0 0 15px rgba(255,0,0,0.1)">
        <div style="color:#ff2222;font-weight:900;letter-spacing:1px;font-size:13px;margin-bottom:8px;">⚠️ ARCHITECTURAL ALERT</div>
        <div style="color:#fff;font-size:15px;line-height:1.4;">This model is a <strong>dead end</strong> (0 downstreams). Possible dead code detected by the Ghost Protocol.</div>
      </div>
    ` : ''}

    <div class="perf-card ${isBN?'bottleneck':'normal'}">
      <div class="perf-card-label">⏱ EXECUTION TIME</div>
      <div class="perf-time" style="color:${isBN?'#ff6600':'#ffffff'}">${execTime.toFixed(3)}<span class="perf-unit">sec</span></div>
      <div class="perf-source">${tSrc}</div>
    </div>

    <div class="sb-section-title">// STATISTICS</div>
    <div class="sb-grid">
      <div class="sb-stat"><span class="val">${(n.upstream||[]).length}</span><span class="lbl">Upstream</span></div>
      <div class="sb-stat"><span class="val">${(n.downstream||[]).length}</span><span class="lbl">Downstream</span></div>
      <div class="sb-stat"><span class="val">${cols.length||'—'}</span><span class="lbl">Columns</span></div>
      <div class="sb-stat"><span class="val">${((n.upstream||[]).length+(n.downstream||[]).length)}</span><span class="lbl">Total Deps</span></div>
    </div>

    <div class="sb-section-title">// METADATA</div>
    <div class="meta-row"><span class="key">SCHEMA</span><span class="val" style="color:${n.color}">${n.schema||'—'}</span></div>
    <div class="meta-row"><span class="key">MATERIALIZATION</span><span class="val">${n.materialized}</span></div>
    <div class="meta-row"><span class="key">PACKAGE</span><span class="val">${n.group}</span></div>
    ${n.description?`<div class="meta-row" style="display:block;padding:10px 0; border-bottom:none"><span class="key" style="display:block;margin-bottom:5px">DESCRIPTION</span><span style="color:#aaa;font-size:12px;line-height:1.6">${n.description}</span></div>`:''}

    <div class="sb-section-title">// SCHEMA EXPLORER</div>
    <input id="schema-search" type="text" placeholder="🔍 Search columns…" autocomplete="off">
    <div id="col-list">
      ${cols.length
        ? cols.map(c=>`<div class="col-row" data-col="${c.name.toLowerCase()}"><span class="col-name">${c.name}</span><span class="col-type">${c.type||'UNKNOWN'}</span></div>`).join('')
        : '<div class="no-cols">No column schema found.<br>Run <em>dbt docs generate</em> to enrich.</div>'}
    </div>
  `;
  sidebar.classList.add('open');

  const s = document.getElementById('schema-search');
  if (s) s.addEventListener('input', () => {
    const q = s.value.toLowerCase();
    document.querySelectorAll('#col-list .col-row').forEach(r => {
      r.style.display = r.dataset.col.includes(q) ? 'flex' : 'none';
    });
  });
}

document.getElementById('sb-close').addEventListener('click', () => {
  sidebar.classList.remove('open');
  resetSelection();
  controls.autoRotate = true;
  document.getElementById('btn-rotate').textContent = '🎥 Auto-Rotate: ON';
  document.getElementById('btn-rotate').classList.add('active');
});

// ═══════ CAMERA TWEEN ═══════
let camTween = null;
function tweenCamera(to, toTarget, dur=1200) {
  camTween = { 
    sp: camera.position.clone(), 
    st: controls.target.clone(),
    ep: new THREE.Vector3(to.x,to.y,to.z), 
    et: new THREE.Vector3(toTarget.x,toTarget.y,toTarget.z),
    start: performance.now(), 
    dur 
  };
}

// ═══════ KEYBOARD DRONE CONTROLS ═══════
const keys = {};
window.addEventListener('keydown', e => { 
  keys[e.code] = true; 
  if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
    controls.autoRotate = false;
    btnRotate.textContent = '🎥 Auto-Rotate: OFF';
    btnRotate.classList.remove('active');
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

function updateDroneMovement() {
  const moveSpeed = 1.8;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  dir.y = 0; dir.normalize(); // Keep movement on ground plane
  
  const side = new THREE.Vector3().crossVectors(dir, camera.up).normalize();

  if (keys['KeyW'] || keys['ArrowUp']) {
    camera.position.addScaledVector(dir, moveSpeed);
    controls.target.addScaledVector(dir, moveSpeed);
  }
  if (keys['KeyS'] || keys['ArrowDown']) {
    camera.position.addScaledVector(dir, -moveSpeed);
    controls.target.addScaledVector(dir, -moveSpeed);
  }
  if (keys['KeyA'] || keys['ArrowLeft']) {
    camera.position.addScaledVector(side, -moveSpeed);
    controls.target.addScaledVector(side, -moveSpeed);
  }
  if (keys['KeyD'] || keys['ArrowRight']) {
    camera.position.addScaledVector(side, moveSpeed);
    controls.target.addScaledVector(side, moveSpeed);
  }
}

// ═══════ PERF TOGGLE ═══════
const btnPerf = document.getElementById('btn-perf');
btnPerf.addEventListener('click', () => {
  perfMode = !perfMode;
  btnPerf.textContent = perfMode ? '⏱️ Performance 3D: ON' : '⏱️ Performance 3D: OFF';
  btnPerf.classList.toggle('perf-on', perfMode);
  // Set target heights for tween
  meshes.forEach(m => {
    const ud = m.userData;
    ud.targetH = perfMode ? ud.perfH : ud.baseH;
  });
});

// ═══════ CONTROLS ═══════
const btnRotate = document.getElementById('btn-rotate');
btnRotate.addEventListener('click', () => {
  resetSelection();
  controls.autoRotate = !controls.autoRotate;
  btnRotate.textContent = controls.autoRotate ? '🎥 Auto-Rotate: ON' : '🎥 Auto-Rotate: OFF';
  btnRotate.classList.toggle('active', controls.autoRotate);

  if (controls.autoRotate) {
    // Cinematic Zoom: Move to a wide distance for the "broad circle" feeling
    const farPos = camera.position.clone().normalize().multiplyScalar(450);
    farPos.y = 110;
    tweenCamera(farPos, {x:0, y:0, z:0}, 2000);
  }
});

document.getElementById('btn-reset').addEventListener('click', () => {
  tweenCamera(INIT_CAM, {x:0,y:0,z:0}, 1200);
  controls.autoRotate = true;
  btnRotate.textContent = '🎥 Auto-Rotate: ON';
  btnRotate.classList.add('active');
  sidebar.classList.remove('open');
  resetSelection();
});

// ═══════ RAYCASTER + FOCUS ═══════
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const tooltip = document.getElementById('tooltip');
let hoveredBuilding = null;

renderer.domElement.addEventListener('mousemove', e => {
  mouse.x = (e.clientX/W)*2-1; mouse.y = -(e.clientY/H)*2+1;
  raycaster.setFromCamera(mouse, camera);
  
  const hits = raycaster.intersectObjects(meshes, true);
  let foundNode = null;
  let foundMesh = null;

  for (const h of hits) {
    foundNode = findNodeInHierarchy(h.object);
    if (foundNode) {
      // Find the actual top-level mesh for highlighting
      let o = h.object; while(o && !meshes.includes(o)) o = o.parent;
      foundMesh = o;
      break;
    }
  }

  // Focus Highlight Logic
  if (hoveredBuilding && hoveredBuilding !== foundMesh) {
    hoveredBuilding.material.forEach(m => m.emissiveIntensity = 0.1);
    hoveredBuilding = null;
  }

  if (foundNode) {
    if (foundMesh) {
      foundMesh.material.forEach(m => m.emissiveIntensity = 0.8);
      hoveredBuilding = foundMesh;
    }
    
    tooltip.style.display='block';
    tooltip.style.left=(e.clientX+15)+'px'; tooltip.style.top=(e.clientY-38)+'px';
    tooltip.style.color=foundNode.color;
    tooltip.innerHTML=`<strong>${foundNode.name}</strong><br><span style="color:#555;font-size:11px">${foundNode.layer.toUpperCase()} · ${foundNode.execution_time?.toFixed(2)}s</span>`;
    renderer.domElement.style.cursor='pointer';
  } else {
    tooltip.style.display='none';
    renderer.domElement.style.cursor='default';
  }
});

// ═══════ ZOOM TO CURSOR REMOVED (Conflicted with Drone Tween) ═══════

// ═══════ CLICK VS DRAG DETECTION ═══════
let mouseDownTime = 0;
let mouseDownPos = { x: 0, y: 0 };

renderer.domElement.addEventListener('mousedown', e => {
  mouseDownTime = performance.now();
  mouseDownPos = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('mouseup', e => {
  const mouseUpTime = performance.now();
  const mouseUpPos = { x: e.clientX, y: e.clientY };
  
  // Calculate distance moved
  const dist = Math.sqrt(Math.pow(mouseUpPos.x - mouseDownPos.x, 2) + Math.pow(mouseUpPos.y - mouseDownPos.y, 2));
  const time = mouseUpTime - mouseDownTime;
  
  // If user moved the mouse more than 15px, it's likely a Drag/Orbit, not a Click
  if (dist > 15) return;

  mouse.x = (e.clientX/W)*2-1; mouse.y = -(e.clientY/H)*2+1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(meshes, true);
  let found = null;
  for (const h of hits) { found = findNodeInHierarchy(h.object); if(found) break; }
  
  if (found) {
    if (selectedNode?.id === found.id) { 
      const isOpen = sidebar.classList.contains('open');
      if (isOpen) {
        sidebar.classList.remove('open'); 
        resetSelection(); 
      } else {
        openSidebar(found);
        applySelection(found);
      }
      return; 
    }
    applySelection(found);
    openSidebar(found);
    controls.autoRotate = false;
    btnRotate.textContent = '🎥 Auto-Rotate: OFF';
    btnRotate.classList.remove('active');
    
    // Graphics Refactor: Targeted Orbit Sync
    const m = nodeMeshMap[found.id];
    const buildingPos = m.position.clone();
    
    // Optimal Drone Distance: 120 units from node center
    const currentDir = camera.position.clone().sub(controls.target).normalize();
    const destPos = buildingPos.clone().add(currentDir.multiplyScalar(120));
    
    // The trick: tween the target and position concurrently
    tweenCamera(destPos, buildingPos.clone().add(new THREE.Vector3(0, 10, 0)), 1200);
  } else {
    // CLICK VACÍO: Reset Global View
    sidebar.classList.remove('open');
    resetSelection();
    tweenCamera(INIT_CAM, {x:0, y:0, z:0}, 1500);
    controls.autoRotate = true;
    btnRotate.textContent = '🎥 Auto-Rotate: ON';
    btnRotate.classList.add('active');
  }
});

// ═══════ STATS ═══════
document.getElementById('stats').innerHTML =
  `NODES&nbsp;<span style="color:#fff">${RAW.nodes.length}</span><br>EDGES&nbsp;<span style="color:#fff">${RAW.links.length}</span><br>${hasReal?`<span style="color:var(--green)">✓ REAL TIMES</span>`:`<span style="color:var(--orange)">~ SIMULATED</span>`}`;

// ═══════ BUILD ANIMATION ═══════
let buildStart = performance.now();  // `let` so rebuildCity() can reset it
const BUILD_DUR = 800;               // ms — longer for more cinematic city-emerge

// ═══════ RENDER LOOP ═══════
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const t   = clock.getElapsedTime();

  // Camera tween with EaseInOut Cubic
  if (camTween) {
    const prog = Math.min(1,(now-camTween.start)/camTween.dur);
    const ease = prog < 0.5 ? 4 * prog * prog * prog : 1 - Math.pow(-2 * prog + 2, 3) / 2;
    camera.position.lerpVectors(camTween.sp,camTween.ep,ease);
    controls.target.lerpVectors(camTween.st,camTween.et,ease);
    if(prog>=1) camTween=null;
  }

  // Floating Oscillation (Drone Drift - Cinematic Wide Sweep)
  if (controls.autoRotate && !camTween) {
    const driftY = Math.sin(t * 0.15) * 45; // Slower, wider vertical sweep
    camera.position.y = 110 + driftY;
  }

  updateDroneMovement();

  // Mesh updates
  meshes.forEach(m => {
    const ud = m.userData;

    // Initial build-up animation
    const elapsed = Math.max(0, now-buildStart-(ud.node._delay||0));
    const buildProg = Math.min(1, elapsed/BUILD_DUR);
    const buildEase = 1-Math.pow(1-buildProg,3);

    // Performance height tween
    const hDiff = ud.targetH - ud.currentH;
    if (Math.abs(hDiff) > 0.01) {
      ud.currentH += hDiff * 0.06;
    } else {
      ud.currentH = ud.targetH;
    }

    // Apply scale (growing from ground up)
    const sY       = Math.max(0.001, buildEase * (ud.currentH / ud.baseH));
    m.scale.y      = sY;

    // Inverse scale the label and reposition to stay at top
    const label = ud.label;
    if (label) {
      const safeSY = Math.max(0.001, sY);
      label.position.y = ud.baseH + (12 / safeSY); 
      const ratio = label.userData.ratio || 4;
      label.scale.set(13 * ratio, 13 / safeSY, 1); 
      
      const dist = camera.position.distanceTo(m.position);
      if (dist > 850) {
        label.visible = false;
      } else {
        label.visible = sY > 0.1;
        const tFade = Math.min(1, Math.max(0, (dist - 550) / 300));
        label.material.opacity = 1.0 - (tFade * tFade * (3 - 2 * tFade));
      }
    }

    // Hazard bobbing
    if (ud.hazard) {
      const safeSY = Math.max(0.001, sY);
      const bob = Math.sin(t * 4.5) * 4;
      // Peligro un poco más arriba (offset 50)
      ud.hazard.position.y = ud.baseH + (50 / safeSY) + (bob / safeSY);
      ud.hazard.scale.set(15 / 1.0, 15 / safeSY, 1);
    }

    const isGhost = ud.node.is_dead_end;
    const isBottleneck = ud.node.is_bottleneck;

    // 1. Position & Jitter (Movement logic)
    let jX=0, jY=0, jZ=0;
    if (isGhost) {
      const pulseSq = Math.pow((Math.sin(t * 4.5) + 1) / 2, 2);
      if (pulseSq > 0.94) {
        jX = (Math.random()-0.5)*1.2; jY = (Math.random()-0.5)*1.2; jZ = (Math.random()-0.5)*1.2;
      }
    }
    m.position.set(ud.node.x + jX, jY, ud.node.z + jZ);

    // 2. Material Updates (Visual logic)
    if (m.material && Array.isArray(m.material)) {
      m.material.forEach(mat => {
        if (perfMode) {
          // CRYSTAL MODE (Uniform Cyan/Red X-Ray)
          mat.color.set(0x00f3ff);
          mat.opacity = 0.22;
          mat.metalness = 0.9;
          mat.roughness = 0.1;
          
          if (isGhost) {
            const flash = (Math.sin(t * 10) + 1) / 2;
            mat.emissive.set(0xff0000); // Red pulse for ghosts
            mat.emissiveIntensity = 0.3 + flash * 0.5;
          } else if (isBottleneck) {
            const heat = 0.5 + Math.sin(t * 4) * 0.45;
            mat.emissive.set(0xff3300); // Orange-Red pulse for bottleneck
            mat.emissiveIntensity = heat * 1.5;
          } else {
            mat.emissive.set(0x00f3ff);
            mat.emissiveIntensity = 0.2;
          }
        } else {
          // NORMAL MODE
          mat.color.set(ud.node.color);
          mat.opacity = isGhost ? 0.35 : (selectedNode && !critSet.has(ud.node.id) ? 0.07 : 1.0);
          mat.metalness = 0.6;
          mat.roughness = 0.45;
          
          if (isGhost) {
            const pulse = (Math.sin(t * 4.5) + 1) / 2;
            const pulseSq = Math.pow(pulse, 2);
            mat.emissive.set(0xff0000);
            mat.emissiveIntensity = 0.5 + pulseSq * 6.0;
          } else if (isBottleneck && perfMode) {
            // "Al Rojo Vivo" effect - ONLY in Performance mode
            const heat = 0.5 + Math.sin(t * 4) * 0.45;
            mat.emissive.set(0xff3300);
            mat.emissiveIntensity = heat * 2.5;
          } else {
            mat.emissive.set(ud.baseEmis || 0x000000);
            mat.emissiveIntensity = 0.1;
          }
        }
        mat.transparent = true;
      });
    }

    const timeLabel = ud.timeLabel;
    if (timeLabel) {
      const dist = camera.position.distanceTo(m.position);
      const isNear = dist < 800; // Technical Artist: Further increased LOD for overview
      const shouldShow = perfMode && (isBottleneck || isNear || (selectedNode && selectedNode.id === ud.node.id));
      timeLabel.visible = shouldShow;
      if (shouldShow) {
        const safeSY = Math.max(0.001, sY);
        // Ghosts: Peligro arriba (50), Tiempo abajo (30). Otros 28 o 42.
        const yOff = isGhost ? 30 : (isBottleneck ? 42 : 28);
        timeLabel.position.y = ud.baseH + (yOff / safeSY);
        
        // Anti-Deformation & Sizing Refinement
        const baseW = isBottleneck ? 55 : 36;
        const baseH = isBottleneck ? 22 : 14.4;
        timeLabel.scale.set(baseW, baseH / safeSY, 1);

        if (isBottleneck) {
          const flash = (Math.sin(t * 10) + 1) / 2;
          timeLabel.material.opacity = 0.7 + flash * 0.3;
        } else {
          // Opacidad suavizada para el nuevo rango LOD (800)
          timeLabel.material.opacity = Math.min(1.0, (800 - dist) / 150);
        }
      }
    }

    // Fire/Smoke/Bottleneck Animation (Graphics Engineer Physics)
    const fire = m.children.find(c => c.name==='fire');
    // Halo found once here for the entire mesh update
    const halo = m.children.find(c => c.name==='halo'); 
    if (fire) {
      fire.visible = perfMode; 
      if (halo) {
        halo.visible = perfMode;
        halo.intensity = 2.5 + Math.sin(t * 8) * 1.5; // Heat Haze pulse
      }
      if (fire.visible) {
        fire.children.forEach((f) => {
          const udF = f.userData;
          udF.phase += udF.speed;
          const fsY = Math.max(0.011, m.scale.y);

          // PHYSICS: Turbulence & Tapering
          const sway = Math.sin(t * 2.5 + udF.phase) * 1.8;
          
          if (udF.isSmoke) {
            f.position.y = ud.baseH + (12 + (udF.phase % 70)) / fsY;
            f.position.x = sway * 1.2;
            f.material.opacity = Math.max(0, 0.2 - (udF.phase % 70)/100) * (fsY > 0.05 ? 1 : 0);
            f.scale.setScalar(udF.baseScale * (1 + (udF.phase % 70)/30) / fsY);
          } else if (udF.isEmber) {
            // Embers: Fast, chaotic rising sparks
            f.position.y = ud.baseH + (udF.phase % 60) / fsY;
            f.position.x = (Math.sin(udF.phase * 0.5) * 5) / fsY;
            f.position.z = (Math.cos(udF.phase * 0.5) * 5) / fsY;
            f.material.opacity = Math.max(0, 1.0 - (udF.phase % 60)/60);
          } else {
            // PYRAMID FLAMES: Constant Tapering to a point
            const life = (udF.phase % 25) / 25; 
            const ageFactor = 1.0 - life; // 1 to 0
            
            // Pyramid Geometry Principle: Horizontal position shifts to center over time
            f.position.x = (udF.offsetX * ageFactor) + (sway * ageFactor) / fsY;
            f.position.z = (udF.offsetZ * ageFactor);
            
            // Visual lifecycle
            const finalScale = udF.baseScale * ageFactor * (0.8 + Math.sin(udF.phase)*0.3);
            f.scale.set(finalScale / fsY, (finalScale * 1.5) / fsY, 1);

            // POSITION FIX: Bottom of sprite flush with the roof (ras de la base)
            f.position.y = ud.baseH + (f.scale.y * 0.4); 
            // Height logic addition: Concentrated reach (reduced from 45 to 32)
            f.position.y += (life * 32) / fsY;
            
            // Core (White/Yellow) -> Corona (Orange/Red)
            const c = f.material.color;
            if (life < 0.25) c.set(0xffffff); // Roaring White Base
            else if (life < 0.45) c.set(0xffcc00); // Bright Yellow Core
            else if (life < 0.75) c.set(0xff6600); // Orange Main
            else c.set(0xaa2200); // Dark Red Tip
            
            f.material.opacity = ageFactor * ageFactor * 0.98;
          }
        });
      }
    }

    // Bottleneck halo flicker (Secondary update)
    if (halo && !fire) halo.intensity = 3.2 + Math.sin(t * 5 + m.position.z) * 1.5;
  });

  // Particles
  edgeObjs.forEach(e => {
    e.particles.forEach(p => {
      p.userData.t = (p.userData.t+p.userData.speed)%1;
      const pos = p.userData.curve.getPoint(p.userData.t);
      p.position.set(pos.x,pos.y,pos.z);
    });
  });

  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  const nw=window.innerWidth, nh=window.innerHeight;
  camera.aspect=nw/nh; camera.updateProjectionMatrix(); renderer.setSize(nw,nh);
});

// ═══════ UX Smart HUD Logic ═══════
const smartHUD = document.getElementById('smart-hud');
const helpTrigger = document.getElementById('help-trigger-left');
const helpHint = document.getElementById('help-hint');
let userInteracted = false;

function hideHUD() {
  if (!userInteracted) {
    smartHUD.classList.add('hidden');
    helpHint.classList.add('fade-out'); // Hide hint on interaction
    userInteracted = true; 
  }
}

// Auto-fade hint after 10s regardless of interaction
setTimeout(() => { helpHint.classList.add('fade-out'); }, 10000);

renderer.domElement.addEventListener('mousedown', hideHUD);
renderer.domElement.addEventListener('wheel', hideHUD);

helpTrigger.addEventListener('mouseenter', () => { smartHUD.classList.remove('hidden'); });
helpTrigger.addEventListener('mouseleave', () => { if(userInteracted) smartHUD.classList.add('hidden'); });

// ═══════ DRAG & DROP — Upload to /api/upload ═══════

const _dzFiles = { manifest: null, run_results: null };

function dzDragOver(e) {
  e.preventDefault();
  document.getElementById('drop-zone').classList.add('dz-hover');
  document.getElementById('dz-icon').className = 'dz-icon-hover';
}
function dzDragLeave(e) {
  document.getElementById('drop-zone').classList.remove('dz-hover');
  document.getElementById('dz-icon').className = 'dz-icon-idle';
}
function dzDrop(e) {
  e.preventDefault();
  dzDragLeave(e);
  dzIngestFiles(Array.from(e.dataTransfer.files));
}
function dzFileInput(input) {
  dzIngestFiles(Array.from(input.files));
  input.value = ''; // Reset so same file can be re-dropped
}

function dzIngestFiles(files) {
  const status = document.getElementById('upload-status');
  status.textContent = '';
  for (const file of files) {
    if (!file.name.endsWith('.json')) {
      status.style.color = '#ff4444';
      status.textContent = `✗ Only .json files accepted (got: ${file.name})`;
      return;
    }
    if (file.name.startsWith('manifest')) {
      _dzFiles.manifest = file;
      dzMarkSlot('manifest', file.name);
    } else if (file.name.startsWith('run_results')) {
      _dzFiles.run_results = file;
      dzMarkSlot('results', file.name);
    } else if (!_dzFiles.manifest) {
      // Fallback: treat any unknown .json as manifest if we don't have one
      _dzFiles.manifest = file;
      dzMarkSlot('manifest', file.name);
    } else {
      _dzFiles.run_results = file;
      dzMarkSlot('results', file.name);
    }
  }
  const btn = document.getElementById('az-launch-btn');
  if (_dzFiles.manifest) {
    btn.disabled = false;
    btn.classList.add('ready');
    status.style.color = '#00f3ff';
    status.textContent = _dzFiles.run_results
      ? '✓ manifest.json + run_results.json ready. Click LAUNCH CITY.'
      : '✓ manifest.json ready. Click LAUNCH CITY.'
  }
}

function dzMarkSlot(slotId, filename) {
  const slot  = document.getElementById('slot-' + slotId);
  const name  = document.getElementById('slot-' + slotId + '-name');
  const check = document.getElementById('slot-' + slotId + '-check');
  if (slot)  slot.classList.add('dz-slot-loaded');
  if (name)  name.textContent = filename;
  if (check) check.style.display = 'inline';
}

async function dzLaunch() {
  if (!_dzFiles.manifest) return;
  const status  = document.getElementById('upload-status');
  const loader  = document.getElementById('az-loader');
  const btn     = document.getElementById('az-launch-btn');
  const lblEl   = document.getElementById('az-loader-label');

  // Show loader
  btn.disabled = true;
  btn.classList.remove('ready');
  loader.style.display = 'block';
  status.textContent = '';

  const loaderMessages = [
    'READING MANIFEST…',
    'MAPPING DAG GRAPH…',
    'CLASSIFYING LAYERS…',
    'DETECTING BOTTLENECKS…',
    'ACTIVATING GHOST PROTOCOL…',
    'BUILDING ARCHITECTURE…',
  ];
  let msgIdx = 0;
  const msgTimer = setInterval(() => { lblEl.textContent = loaderMessages[Math.min(msgIdx++, loaderMessages.length-1)]; }, 400);

  try {
    // 1. Read files into strings
    const manifestText = await _dzReadFile(_dzFiles.manifest);
    let manifestObj;
    try { manifestObj = JSON.parse(manifestText); }
    catch(e) { throw new Error(`manifest.json is not valid JSON: ${e.message}`); }

    let runResultsObj = null;
    if (_dzFiles.run_results) {
      const rrText = await _dzReadFile(_dzFiles.run_results);
      try { runResultsObj = JSON.parse(rrText); } catch(_) {}  // Non-fatal
    }

    // 2. POST to backend
    lblEl.textContent = 'CALLING PARSER ENGINE…';
    const resp = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: manifestObj, run_results: runResultsObj }),
    });

    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error || `Server error ${resp.status}`);

    clearInterval(msgTimer);
    lblEl.textContent = `CITY READY — ${json.nodes.length} BUILDINGS DETECTED`;

    // 3. Hide overlay with cinematic transition, then build city
    await _dzHideOverlay();
    rebuildCity(json);

  } catch(err) {
    clearInterval(msgTimer);
    loader.style.display = 'none';
    btn.disabled = false;
    btn.classList.add('ready');
    status.style.color = '#ff4444';
    status.textContent = `✗ ${err.message}`;
    console.error('[DagCity] Upload error:', err);
  }
}

function _dzReadFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });
}

function _dzHideOverlay() {
  return new Promise(resolve => {
    const overlay = document.getElementById('awaiting-overlay');
    overlay.classList.add('hiding');
    setTimeout(() => {
      overlay.style.display = 'none';
      overlay.classList.remove('hiding');
      resolve();
    }, 650);
  });
}

// ═══════ rebuildCity — Hot city reconstruction after upload ═══════
function rebuildCity(graphData) {
  // 1. Clear existing scene objects
  [...meshes].forEach(m => {
    scene.remove(m);
    if (m.geometry) m.geometry.dispose();
    if (Array.isArray(m.material)) m.material.forEach(mt => mt.dispose());
    else if (m.material) m.material.dispose();
  });
  meshes.length = 0;
  Object.keys(nodeMeshMap).forEach(k => delete nodeMeshMap[k]);

  edgeObjs.forEach(e => {
    scene.remove(e.line);
    if (e.line.geometry) e.line.geometry.dispose();
    e.particles.forEach(p => { scene.remove(p); if(p.geometry) p.geometry.dispose(); });
  });
  edgeObjs.length = 0;
  Object.keys(nodeMap).forEach(k => delete nodeMap[k]);
  selectedNode = null;
  critSet = new Set();

  // 2. Inject new data into globals
  const nodes = graphData.nodes || [];
  const links = graphData.links || [];
  const newMax = nodes.length ? Math.max(...nodes.map(n => n.execution_time || 0)) : 0;
  const newMin = nodes.length ? Math.min(...nodes.map(n => n.execution_time || 0)) : 0;

  // Recalculate positions
  const lC = {}, lI = {};
  nodes.forEach(n => { const l = n.layer||'default'; lC[l]=(lC[l]||0)+1; lI[l]=0; });
  nodes.forEach((n, i) => {
    const l = n.layer||'default';
    n.x = LAYER_X[l] ?? 0;
    n.z = (lI[l] - (lC[l]-1)/2) * 70;
    n.y = 0; lI[l]++; n._delay = i * 80;
    nodeMap[n.id] = n;
  });

  // 3. Replace global RAW reference (used by other functions)
  RAW.nodes = nodes;
  RAW.links = links;
  RAW.metadata = graphData.metadata || {};

  // 4. Rebuild meshes + edges
  nodes.forEach(n => buildBuilding(n));
  links.forEach(l => buildEdge(l));

  // 5. Reset build animation so buildings emerge from the ground
  buildStart = performance.now();

  // 6. Update stats HUD
  const hasRealNew = graphData.metadata?.has_real_times || false;
  document.getElementById('stats').innerHTML =
    `NODES&nbsp;<span style="color:#fff">${nodes.length}</span><br>EDGES&nbsp;<span style="color:#fff">${links.length}</span><br>${hasRealNew?`<span style="color:var(--green)">✓ REAL TIMES</span>`:`<span style="color:var(--orange)">∼ SIMULATED</span>`}`;

  // 7. Reset camera into cinematic sweep position
  tweenCamera(INIT_CAM, {x:0, y:0, z:0}, 1800);
  controls.autoRotate = true;
  const btnRot = document.getElementById('btn-rotate');
  if (btnRot) { btnRot.textContent = '🎥 Auto-Rotate: ON'; btnRot.classList.add('active'); }
}

</script>
</body>
</html>"""

    def generate(self, graph_data: Dict[str, Any], output_path: str):
        html = self.HTML_TEMPLATE.replace("$DATA_PAYLOAD", json.dumps(graph_data, indent=2))
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(html)
        return os.path.abspath(output_path)

    def serve(self, directory: str, port: int = 8000):
        """
        Serve the visualizer from 'directory' on the given port.
        Provides both static file serving (GET) and the graph API (POST /api/upload).
        """
        # Resolve serve_dir for static files before we chdir
        serve_dir = os.path.abspath(directory)

        # Import ManifestParser here to avoid circular import at module level
        from core.parser import ManifestParser

        class DagCityHandler(SimpleHTTPRequestHandler):
            """
            Extends SimpleHTTPRequestHandler:
            ─ GET  /* → serves static files from viz_output/
            ─ POST /api/upload → parses manifest + run_results, returns graph JSON
            """

            def __init__(self, *args, **kwargs):
                # directory= keyword tells SimpleHTTPRequestHandler where to serve from
                super().__init__(*args, directory=serve_dir, **kwargs)

            def log_message(self, fmt, *args):
                # Only log errors; silence verbose GET noise in production
                if args and len(args) >= 2 and str(args[1]).startswith(('4', '5')):
                    super().log_message(fmt, *args)

            def do_POST(self):
                if self.path != '/api/upload':
                    self.send_error(404)
                    return

                content_len = int(self.headers.get('Content-Length', 0))
                raw_body = self.rfile.read(content_len)

                try:
                    payload = json.loads(raw_body)
                except json.JSONDecodeError as e:
                    self._json_error(400, f"Invalid JSON body: {e}")
                    return

                manifest_dict   = payload.get('manifest')
                run_results_dict = payload.get('run_results')  # optional

                if not manifest_dict:
                    self._json_error(400, "Missing 'manifest' key in request body.")
                    return

                try:
                    graph_data = ManifestParser.parse_from_dict(
                        manifest_dict,
                        run_results_dict=run_results_dict,
                    )
                    print(f"[+] /api/upload → {len(graph_data['nodes'])} nodes parsed OK")
                    self._json_ok(graph_data)
                except (ValueError, KeyError) as e:
                    print(f"[WARNING] /api/upload parser error: {e}", file=sys.stderr)
                    self._json_error(422, str(e))
                except Exception as e:
                    print(f"[ERROR] /api/upload unexpected: {e}", file=sys.stderr)
                    self._json_error(500, f"Internal error: {e}")

            # ── Helpers ─────────────────────────────────────────────────
            def _json_ok(self, data: dict):
                body = json.dumps(data).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(body)

            def _json_error(self, code: int, msg: str):
                body = json.dumps({'error': msg}).encode('utf-8')
                self.send_response(code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        server = ThreadingHTTPServer(('0.0.0.0', port), DagCityHandler)
        print(f"[+] DagCity V4.2 → http://0.0.0.0:{port}  |  POST /api/upload ready")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            server.shutdown()
