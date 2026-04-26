import json
import os
import shutil
from typing import Dict, Any


class VizGenerator:
    """
    V1.0 DAG-CITY: Modular Architecture.
    Generates a minimal HTML shell that injects graph data and loads ES6 modules.
    All JS logic has been moved to src/static/js/ modules.
    """

    # Static assets directory (relative to this file)
    STATIC_SRC = os.path.join(os.path.dirname(__file__), '..', 'static')

    HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>DagCity v1.0 | Performance Profiler</title>
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
#graph2d-container {
  width: 100vw;
  height: 100vh;
  position: fixed;
  top: 0;
  left: 0;
  display: none;
  z-index: 1;
  background:
    radial-gradient(circle at 20% 20%, rgba(255, 0, 255, 0.07), transparent 30%),
    radial-gradient(circle at 70% 80%, rgba(0, 243, 255, 0.08), transparent 35%),
    linear-gradient(160deg, #020611 0%, #000409 45%, #02070f 100%);
}

#view-toggle {
  position: fixed;
  top: 122px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 120;
  display: inline-flex;
  border: 1px solid rgba(0,243,255,0.35);
  border-radius: 999px;
  background: rgba(4, 10, 24, 0.86);
  backdrop-filter: blur(10px);
  overflow: hidden;
  box-shadow: 0 0 24px rgba(0,0,0,0.4);
}
.view-pill {
  border: none;
  background: transparent;
  color: rgba(0,243,255,0.75);
  padding: 8px 16px;
  font-size: 11px;
  letter-spacing: 2px;
  cursor: pointer;
  text-transform: uppercase;
  transition: all 0.2s ease;
}
.view-pill.active {
  background: rgba(0,243,255,0.18);
  color: #e9feff;
  text-shadow: 0 0 10px rgba(0,243,255,0.45);
}

#btn-global-view {
  position: fixed;
  top: 18px;
  right: 18px;
  z-index: 260;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  border: 1px solid rgba(0,243,255,0.45);
  background: rgba(6,14,24,0.82);
  color: #e9f9ff;
  font-size: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 10px 24px rgba(0,0,0,0.35);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
#btn-global-view:hover {
  border-color: rgba(140,245,255,0.8);
  box-shadow: 0 10px 26px rgba(0,0,0,0.4), 0 0 18px rgba(0,243,255,0.28);
}

#btn-global-view {
  position: fixed;
  top: 18px;
  right: 18px;
  z-index: 260;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  border: 1px solid rgba(0,243,255,0.45);
  background: rgba(6,14,24,0.82);
  color: #fff;
  font-size: 18px;
  cursor: pointer;
  transition: all 0.2s;
}
#btn-global-view:hover {
  background: rgba(0,243,255,0.2);
  transform: scale(1.05);
}

#btn-tactical-map {
  position: fixed;
  top: 18px;
  right: 70px;
  z-index: 260;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  border: 1px solid rgba(0,243,255,0.45);
  background: rgba(6,14,24,0.82);
  color: #fff;
  font-size: 18px;
  cursor: pointer;
  transition: all 0.2s;
}
#btn-tactical-map:hover {
  background: rgba(0,243,255,0.2);
  transform: scale(1.05);
}

#omni-launch {
  position: fixed;
  top: 164px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 120;
  min-width: 360px;
  border: 1px solid rgba(255,0,255,0.28);
  border-radius: 10px;
  background: rgba(8, 7, 19, 0.85);
  color: rgba(255,255,255,0.75);
  padding: 9px 14px;
  font-size: 12px;
  letter-spacing: 1px;
  cursor: pointer;
}
#omni-launch:hover { border-color: rgba(255,0,255,0.55); color: #fff; }

#omni-modal {
  position: fixed;
  inset: 0;
  z-index: 1400;
  display: none;
  align-items: flex-start;
  justify-content: center;
  padding-top: 100px;
  background: rgba(0,0,0,0.48);
  backdrop-filter: blur(4px);
}
#omni-modal.open { display: flex; }
#omni-card {
  width: min(720px, 90vw);
  border: 1px solid rgba(0,243,255,0.35);
  border-radius: 14px;
  background: rgba(3, 10, 24, 0.96);
  box-shadow: 0 20px 50px rgba(0,0,0,0.55), 0 0 22px rgba(0,243,255,0.18);
  overflow: hidden;
}
#omni-input {
  width: 100%;
  border: none;
  border-bottom: 1px solid rgba(0,243,255,0.2);
  background: rgba(255,255,255,0.02);
  color: #fff;
  padding: 16px;
  font-size: 14px;
  letter-spacing: 1px;
  outline: none;
}
#omni-results { max-height: 360px; overflow: auto; }
.omni-item {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  color: #d6ecff;
  font-size: 13px;
  display: flex;
  justify-content: space-between;
  gap: 14px;
  cursor: pointer;
}
.omni-item:hover, .omni-item.active { background: rgba(0,243,255,0.12); color: #fff; }
.omni-meta { color: rgba(255,255,255,0.42); font-size: 11px; }

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
  background: rgba(0, 0, 0, 0.5);
  border-right: 1px solid rgba(0, 242, 255, 0.2);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  overflow: hidden;
  transition: width 0.3s cubic-bezier(0.4,0,0.2,1);
  user-select: none;
  z-index: 1000;
}

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
#ide-dock:hover, #ide-dock.expanded { width: 250px; }
.dock-icon { font-size: 22px; flex-shrink: 0; width: 26px; text-align: center; }
.dock-label { font-size: 14px; opacity: 0; transition: opacity 0.2s 0.1s; pointer-events: none; }
#ide-dock:hover .dock-label, #ide-dock.expanded .dock-label { opacity: 1; }
.dock-item:hover {
  color: var(--cyan);
  background: rgba(0,242,255,0.06);
  border-left-color: var(--cyan);
  filter: drop-shadow(0 0 5px #00f2ff);
}

.dock-divider { height: 1px; background: rgba(0,242,255,0.08); margin: 4px 14px; }

/* ── DATA VOLUME LABELS ── */
.data-volume-label {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  font-weight: bold;
  padding: 6px 12px;
  border-radius: 6px;
  background: rgba(0,0,0,0.7);
  border: 1px solid #00f3ff;
  color: #00f3ff;
  box-shadow: 0 0 10px rgba(0,243,255,0.3);
  pointer-events: none;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.3s;
  text-shadow: 0 0 5px rgba(0,243,255,0.5);
}
.data-volume-label.critical {
  border-color: #ff4400;
  color: #ff4400;
  box-shadow: 0 0 10px rgba(255,68,0,0.5);
  text-shadow: 0 0 5px rgba(255,68,0,0.5);
}

/* ── SLA PANEL ── */
#sla-panel {
  display: none;
  position: fixed; top: 0; left: 62px; width: 480px; height: 100vh;
  background: rgba(2, 6, 18, 0.97);
  border-right: 1px solid rgba(0,242,255,0.2);
  z-index: 600;
  flex-direction: column;
  backdrop-filter: blur(30px);
  -webkit-backdrop-filter: blur(30px);
  box-shadow: 8px 0 40px rgba(0,0,0,0.6);
  animation: sla-slide-in 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  transition: left 0.3s cubic-bezier(0.4,0,0.2,1);
}
#sla-panel.open { display: flex; }
#ide-dock:hover ~ #sla-panel.open, #ide-dock.expanded ~ #sla-panel.open { left: 250px; }
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
#sla-body { flex: 1; overflow-y: auto; padding: 0 0 60px 0; min-height: 0; }
#sla-body::-webkit-scrollbar { width: 4px; }
#sla-body::-webkit-scrollbar-thumb { background: rgba(0,242,255,0.2); border-radius: 2px; }

.sla-section { padding: 32px 30px; border-bottom: 1px solid rgba(0,242,255,0.06); }
.graphics-control { display: flex; align-items: center; gap: 12px; margin: 8px 0; }
.graphics-control span { font-size: 12px; letter-spacing: 2px; color: rgba(0,242,255,0.7); text-transform: uppercase; }
.graphics-control input[type="range"] { flex: 1; -webkit-appearance: none; appearance: none; height: 4px; background: rgba(0,242,255,0.15); border-radius: 2px; outline: none; cursor: pointer; }
.graphics-control input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #00f3ff; box-shadow: 0 0 12px rgba(0,243,255,0.8); cursor: pointer; }
.graphics-control input[type="range"]::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: #00f3ff; box-shadow: 0 0 12px rgba(0,243,255,0.8); cursor: pointer; border: none; }
.sla-label { font-size: 15px; color: rgba(0,242,255,0.6); letter-spacing: 4px; margin-bottom: 22px; text-transform: uppercase; font-weight: bold; }
.sla-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.sla-name { font-size: 17px; color: #fff; letter-spacing: 0.5px; }
.sla-val {
  font-size: 29px; font-weight: 900; color: var(--cyan);
  text-shadow: 0 0 8px var(--cyan); font-family: 'Courier New', monospace;
  min-width: 80px; text-align: right;
  cursor: text; padding: 2px 6px; border-radius: 4px; transition: background 0.2s;
}
.sla-val:focus { background: rgba(0,242,255,0.15); outline: none; box-shadow: 0 0 0 1px var(--cyan); }
.sla-desc { font-size: 14px; color: rgba(255,255,255,0.35); margin-bottom: 20px; letter-spacing: 0.5px; line-height: 1.4; }
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

/* Toggle Switch */
.sla-toggle-container { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.switch { position: relative; display: inline-block; width: 34px; height: 18px; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(255,255,255,0.1); transition: .4s; border-radius: 34px; }
.slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 2px; bottom: 2px; background-color: #fff; transition: .4s; border-radius: 50%; }
input:checked + .slider { background-color: var(--cyan); box-shadow: 0 0 8px var(--cyan); }
input:checked + .slider:before { transform: translateX(16px); }

.sla-inherit-text { font-size: 11px; color: rgba(255,255,255,0.4); font-style: italic; margin-top: 4px; }

.add-override-btn {
  background: rgba(0, 242, 255, 0.05); border: 1px dashed rgba(0,242,255,0.4); color: var(--cyan);
  padding: 8px; text-align: center; border-radius: 4px; cursor: pointer; font-size: 12px; transition: 0.2s;
}
.add-override-btn:hover { background: rgba(0, 242, 255, 0.15); border-color: var(--cyan); }

.settings-text-input {
  width: 100%;
  border: 1px solid rgba(0,242,255,0.3);
  border-radius: 8px;
  background: rgba(0,0,0,0.35);
  color: #e9feff;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  padding: 10px 12px;
}
.settings-text-input:focus { outline: none; border-color: var(--cyan); box-shadow: 0 0 0 1px rgba(0,242,255,0.25); }
.settings-inline-btn {
  margin-top: 10px;
  border: 1px solid rgba(255,0,255,0.35);
  background: rgba(255,0,255,0.08);
  color: #ffd8ff;
  padding: 8px 11px;
  border-radius: 8px;
  cursor: pointer;
  letter-spacing: 1px;
  font-size: 11px;
  font-weight: bold;
}
.settings-inline-btn:hover { background: rgba(255,0,255,0.18); }

#ai-panel {
  display: none;
  position: fixed; top: 0; left: 62px; width: 480px; height: 100vh;
  background: rgba(4, 6, 18, 0.98);
  border-right: 1px solid rgba(255,0,255,0.24);
  z-index: 600;
  flex-direction: column;
  backdrop-filter: blur(30px);
  -webkit-backdrop-filter: blur(30px);
  box-shadow: 8px 0 40px rgba(0,0,0,0.6);
  animation: sla-slide-in 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  transition: left 0.3s cubic-bezier(0.4,0,0.2,1);
}
#ai-panel.open { display: flex; }
#ide-dock:hover ~ #ai-panel.open, #ide-dock.expanded ~ #ai-panel.open { left: 250px; }
#ai-chat-body { flex: 1; overflow-y: auto; padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; }
.ai-msg {
  border-radius: 10px;
  padding: 14px 16px;
  font-size: 16px;
  line-height: 1.5;
  border: 1px solid rgba(255,255,255,0.08);
}
.ai-msg.user { align-self: flex-end; background: rgba(0,243,255,0.14); color: #e9feff; border-color: rgba(0,243,255,0.32); }
.ai-msg.assistant { align-self: flex-start; background: rgba(255,0,255,0.10); color: #ffe9ff; border-color: rgba(255,0,255,0.28); }
.ai-msg.system { align-self: center; background: rgba(255,102,0,0.1); color: #ffd8ba; border-color: rgba(255,102,0,0.35); }
#ai-chat-input-row {
  border-top: 1px solid rgba(255,255,255,0.08);
  padding: 12px;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
}
#ai-chat-input {
  border: 1px solid rgba(255,0,255,0.28);
  border-radius: 8px;
  background: rgba(0,0,0,0.35);
  color: #fff;
  padding: 12px;
  font-family: 'Courier New', monospace;
  font-size: 15px;
}
#ai-chat-send {
  border: 1px solid rgba(0,243,255,0.35);
  background: rgba(0,243,255,0.14);
  color: #dffcff;
  border-radius: 8px;
  padding: 12px 14px;
  letter-spacing: 1px;
  font-size: 13px;
  cursor: pointer;
  font-weight: bold;
}
#ai-chat-send:hover { background: rgba(0,243,255,0.24); }

/* ── SETTINGS PANEL ── */
#settings-panel {
  display: none;
  position: fixed; top: 0; left: 62px; width: 480px; height: 100vh;
  background: rgba(2, 6, 18, 0.97);
  border-right: 1px solid rgba(0,242,255,0.2);
  z-index: 600;
  flex-direction: column;
  backdrop-filter: blur(30px);
  -webkit-backdrop-filter: blur(30px);
  box-shadow: 8px 0 40px rgba(0,0,0,0.6);
  animation: sla-slide-in 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  transition: left 0.3s cubic-bezier(0.4,0,0.2,1);
}
#settings-panel.open { display: flex; }
#ide-dock:hover ~ #settings-panel.open, #ide-dock.expanded ~ #settings-panel.open { left: 250px; }
.settings-section { padding: 32px 30px; border-bottom: 1px solid rgba(0,242,255,0.06); }
.settings-label { font-size: 15px; color: var(--magenta); letter-spacing: 4px; margin-bottom: 22px; text-transform: uppercase; font-weight: bold; }
.settings-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.settings-name { font-size: 16px; color: #fff; letter-spacing: 1px; }
.settings-val { font-size: 19px; font-weight: 900; color: var(--cyan); text-shadow: 0 0 8px var(--cyan); }
.settings-action-btn {
  width: 100%;
  border: 1px solid rgba(0,242,255,0.35);
  border-radius: 10px;
  background: rgba(0,242,255,0.08);
  color: var(--cyan);
  cursor: pointer;
  font-family: 'Courier New', monospace;
  font-weight: 700;
  letter-spacing: 1px;
  padding: 10px 12px;
  transition: all 0.2s ease;
}
.settings-action-btn:hover {
  background: rgba(0,242,255,0.14);
  box-shadow: 0 0 18px rgba(0,242,255,0.18);
}

#architecture-panel {
  display: none;
  position: fixed; top: 0; left: 62px; width: 480px; height: 100vh;
  background: rgba(2, 6, 18, 0.97);
  border-right: 1px solid rgba(57,255,20,0.2);
  z-index: 600;
  flex-direction: column;
  backdrop-filter: blur(30px);
  -webkit-backdrop-filter: blur(30px);
  box-shadow: 8px 0 40px rgba(0,0,0,0.6);
  animation: sla-slide-in 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  transition: left 0.3s cubic-bezier(0.4,0,0.2,1);
}
#architecture-panel.open { display: flex; }
#ide-dock:hover ~ #architecture-panel.open, #ide-dock.expanded ~ #architecture-panel.open { left: 250px; }
.arch-subgroup {
  margin-top: 14px;
  max-height: 520px;
  opacity: 1;
  overflow: hidden;
  transition: max-height 0.28s ease, opacity 0.22s ease, margin-top 0.22s ease;
}
.arch-subgroup.hidden {
  max-height: 0;
  opacity: 0;
  margin-top: 0;
  pointer-events: none;
}
.arch-select {
  width: 100%;
  border: 1px solid rgba(57,255,20,0.35);
  border-radius: 8px;
  background: rgba(0,0,0,0.45);
  color: #e8ffe2;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  padding: 9px 10px;
}
.arch-select:focus { outline: none; box-shadow: 0 0 0 1px rgba(57,255,20,0.45); }
.arch-number {
  width: 100%;
  border: 1px solid rgba(57,255,20,0.35);
  border-radius: 8px;
  background: rgba(0,0,0,0.45);
  color: #e8ffe2;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  padding: 9px 10px;
}
.arch-number:focus { outline: none; box-shadow: 0 0 0 1px rgba(57,255,20,0.45); }
.arch-preview {
  margin: 10px 0 14px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(57,255,20,0.25);
  background: rgba(57,255,20,0.05);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}
.arch-preview.severity-low {
  border-color: rgba(57,255,20,0.45);
  box-shadow: 0 0 16px rgba(57,255,20,0.12);
  background: rgba(57,255,20,0.06);
}
.arch-preview.severity-mid {
  border-color: rgba(255,215,0,0.45);
  box-shadow: 0 0 16px rgba(255,215,0,0.12);
  background: rgba(255,215,0,0.06);
}
.arch-preview.severity-high {
  border-color: rgba(255,68,0,0.5);
  box-shadow: 0 0 18px rgba(255,68,0,0.16);
  background: rgba(255,68,0,0.08);
}
.arch-preview-title {
  font-size: 10px;
  letter-spacing: 2px;
  color: rgba(57,255,20,0.8);
  margin-bottom: 6px;
  text-transform: uppercase;
}
.arch-preview-value {
  font-size: 13px;
  color: #e8ffe2;
  line-height: 1.4;
  word-break: break-word;
}
.arch-preview-value.severity-low {
  color: #39ff14;
  text-shadow: 0 0 10px rgba(57,255,20,0.35);
}
.arch-preview-value.severity-mid {
  color: #ffd700;
  text-shadow: 0 0 10px rgba(255,215,0,0.35);
}
.arch-preview-value.severity-high {
  color: #ff4400;
  text-shadow: 0 0 10px rgba(255,68,0,0.35);
}
.arch-threshold-legend {
  margin-top: 10px;
  padding: 8px 10px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px;
  background: rgba(255,255,255,0.03);
  display: grid;
  gap: 4px;
}
.arch-threshold-legend .legend-row {
  font-size: 11px;
  color: #cfd6e5;
  display: flex;
  align-items: center;
  gap: 8px;
}
.arch-threshold-legend .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

/* Toggle Switches */
.switch { position: relative; display: inline-block; width: 44px; height: 22px; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(255,255,255,0.1); transition: .4s; border-radius: 34px; border: 1px solid rgba(0,242,255,0.2); }
.slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 4px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; box-shadow: 0 0 10px rgba(0,242,255,0.5); }
input:checked + .slider { background-color: rgba(0,242,255,0.2); border-color: var(--cyan); }
input:checked + .slider:before { transform: translateX(21px); background-color: var(--cyan); }

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
#pm-filters {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.pm-filter-btn {
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.04);
  color: rgba(255,255,255,0.75);
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  padding: 6px 10px;
  border-radius: 999px;
  cursor: pointer;
  transition: all 0.18s ease;
}
.pm-filter-btn.active {
  border-color: rgba(0,242,255,0.6);
  color: #e9feff;
  background: rgba(0,242,255,0.16);
  box-shadow: 0 0 10px rgba(0,242,255,0.2);
}
#pm-empty { color: rgba(255,255,255,0.3); text-align: center; padding: 50px 0; letter-spacing: 3px; font-size: 13px; }
.pm-project-row {
  background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);
  border-radius: 12px; padding: 20px 22px; margin-bottom: 12px;
  display: flex; align-items: center; justify-content: space-between;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.pm-project-row:hover { background: rgba(255,255,255,0.04); border-color: rgba(0,242,255,0.2); }
.pm-project-row.active {
  border-color: #00f2ff; background: rgba(0,242,255,0.03);
  box-shadow: 0 0 30px rgba(0,242,255,0.1), inset 0 0 15px rgba(0,242,255,0.05);
}
.pm-project-info { flex: 1; min-width: 0; }
.pm-project-name { 
  font-size: 1.05rem; font-weight: 700; color: rgba(255,255,255,0.7); 
  margin-bottom: 6px; display: flex; align-items: center; gap: 12px;
  letter-spacing: 1px;
}
.pm-project-row.active .pm-project-name { color: #fff; text-shadow: 0 0 10px rgba(255,255,255,0.3); }

/* Badges */
.pm-badge {
  font-size: 8px; font-weight: 900; letter-spacing: 1.5px;
  padding: 3px 8px; border-radius: 4px; text-transform: uppercase;
  display: flex; align-items: center; gap: 5px;
}
.pm-badge-live { background: rgba(57,255,20,0.1); border: 1px solid rgba(57,255,20,0.3); color: #39ff14; }
.pm-badge-static { background: rgba(0,242,255,0.08); border: 1px solid rgba(0,242,255,0.2); color: rgba(0,242,255,0.6); }

.pm-dot { width: 6px; height: 6px; border-radius: 50%; }
.pm-dot-live { background: #39ff14; box-shadow: 0 0 8px #39ff14; animation: pm-pulse 1.5s infinite; }

@keyframes pm-pulse {
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.4); opacity: 0.5; }
  100% { transform: scale(1); opacity: 1; }
}

.pm-project-meta { font-size: 13px; color: rgba(255,255,255,0.25); letter-spacing: 1px; display: flex; align-items: center; gap: 8px; }
.pm-project-actions { display: flex; gap: 10px; flex-shrink: 0; }

.pm-btn {
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
  color: #fff; padding: 8px 18px; border-radius: 6px; cursor: pointer;
  font-size: 12px; font-weight: 900; letter-spacing: 2px; transition: all 0.2s;
  font-family: 'JetBrains Mono', monospace;
}
.pm-btn:hover { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.3); }
.pm-btn-load { border-color: var(--cyan); color: var(--cyan); }
.pm-btn-load:hover { background: rgba(0,242,255,0.1); box-shadow: 0 0 15px rgba(0,242,255,0.3); }
.pm-btn-delete { border-color: rgba(255,0,0,0.2); color: rgba(255,0,0,0.4); }
.pm-btn-delete:hover { border-color: var(--red); color: var(--red); background: rgba(255,0,0,0.1); }

/* ── LEGEND ── */
#legend {
  position: fixed; bottom: 25px; left: 72px; z-index: 50;
  display: flex; flex-direction: column; gap: 10px; pointer-events: none;
  background: var(--panel-bg); border: 1px solid var(--border);
  border-radius: 12px; padding: 18px 24px; backdrop-filter: blur(10px);
  transition: left 0.3s cubic-bezier(0.4,0,0.2,1);
}
#ide-dock:hover ~ #legend, #ide-dock.expanded ~ #legend { left: 260px; }
.leg-row { display: flex; align-items: center; gap: 14px; font-size: 17px; letter-spacing: 1px; }
.leg-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }

/* ── STATS ── */
#stats {
  position: fixed; bottom: 70px; right: 25px; z-index: 50;
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
  display: none; /* Completely hidden by default - only for 3D view */
  flex-direction: column; overflow: hidden;
}
#sidebar.open { transform: translateX(0); display: flex; }
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
.perf-card-label { font-size: 14px; letter-spacing: 4px; text-transform: uppercase; opacity: 0.7; margin-bottom: 10px; }
.perf-time { font-size: 3.2rem; font-weight: 900; line-height: 1; }
.perf-unit { font-size: 17px; opacity: 0.7; margin-left: 6px; }
.perf-source { font-size: 14px; opacity: 0.5; margin-top: 8px; letter-spacing: 1.5px; }

.sb-section-title {
  font-size: 15px; color: #ffffff55; letter-spacing: 4px; text-transform: uppercase;
  margin-bottom: 16px; margin-top: 28px; padding-bottom: 10px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}
.sb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 6px; }
.sb-stat {
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px; padding: 20px 14px; text-align: center;
}
.sb-stat .val { display: block; font-size: 2.6rem; font-weight: bold; color: #fff; line-height: 1; }
.sb-stat .lbl { font-size: 15px; color: #ffffff66; text-transform: uppercase; letter-spacing: 1px; margin-top: 8px; }

.meta-row { display: flex; justify-content: space-between; align-items: center; padding: 14px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 17px; }
.meta-row .key { color: #ffffff66; letter-spacing: 1.5px; }
.meta-row .val { color: #fff; font-size: 19px; }

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
  pointer-events: auto; cursor: default;
}
.hud-item#live-sync-hud { gap: 8px; font-weight: 900; }
.hud-item#live-sync-hud .status-dot {
  width: 8px; height: 8px; border-radius: 50%; display: inline-block;
  box-shadow: 0 0 10px rgba(255,255,255,0.2);
}
.hud-item#live-sync-hud .status-dot.green { background: #39ff14; box-shadow: 0 0 12px #39ff14; }
.hud-item#live-sync-hud .status-dot.grey { background: #555; }

/* ── LIVE SYNC / OFFLINE INDICATOR (bottom-right, under #stats) ── */
#sync-hud-item {
  position: fixed; bottom: 25px; right: 25px; z-index: 51;
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px; border-radius: 999px;
  font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 900;
  letter-spacing: 1.6px; color: #fff;
  background: rgba(6,14,24,0.85);
  border: 1px solid rgba(0,243,255,0.3);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  box-shadow: 0 0 12px rgba(0,0,0,0.4);
  pointer-events: auto; cursor: default;
}
#sync-hud-item .status-dot {
  width: 9px; height: 9px; border-radius: 50%; display: inline-block;
}
.hud-icon { font-size: 16px; opacity: 0.9; }
.hud-label { color: var(--cyan); font-weight: bold; }


#help-trigger-left {
  position: fixed; bottom: 320px; left: 72px; z-index: 250;
  width: 46px; height: 46px; border-radius: 50%;
  border: 2px solid var(--cyan); background: rgba(0, 0, 0, 0.7);
  color: var(--cyan); display: flex; align-items: center; justify-content: center;
  font-size: 24px; font-weight: bold; cursor: help; backdrop-filter: blur(12px);
  transition: left 0.3s cubic-bezier(0.4,0,0.2,1), all 0.3s; animation: help-pulse 2s infinite;
}
#ide-dock:hover ~ #help-trigger-left, #ide-dock.expanded ~ #help-trigger-left { left: 260px; }
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
  transition: left 0.3s cubic-bezier(0.4,0,0.2,1), opacity 0.8s ease, transform 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  box-shadow: 0 0 25px rgba(255, 255, 0, 0.5);
  animation: hint-entry 0.8s forwards 0.5s;
}
#ide-dock:hover ~ #help-hint, #ide-dock.expanded ~ #help-hint { left: 318px; }
@keyframes hint-entry { to { opacity: 1; transform: translateX(0); } }
#help-hint::after {
  content: ''; position: absolute; left: -8px; top: 12px;
  border-top: 8px solid transparent; border-bottom: 8px solid transparent;
  border-right: 8px solid #ffff00;
}
#help-hint.fade-out { opacity: 0; visibility: hidden; }

/* Awaiting overlay — HUB layout */
#awaiting-overlay {
  position: fixed; inset: 0; z-index: 999;
  background: rgba(0, 0, 8, 0.95);
  backdrop-filter: blur(22px); -webkit-backdrop-filter: blur(22px);
  font-family: 'Courier New', monospace; text-align: center;
  transition: opacity 0.6s ease, transform 0.6s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
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

/* Hub: logo + two-column grid */
.az-inner {
  position: relative; z-index: 2;
  display: flex; flex-direction: column; align-items: center; padding: 24px 16px;
  width: 100%; max-width: 1100px;
}
.az-logo { display:flex; align-items:center; gap:16px; margin-bottom: 32px; }
.az-logo-glyph {
  font-size:36px; color:#ff00ff;
  text-shadow: 0 0 18px #ff00ff, 0 0 40px #ff00ff44;
  animation: glyph-spin 8s linear infinite;
}
@keyframes glyph-spin {
  0% { transform: rotate(0deg) scale(1); } 50% { transform: rotate(180deg) scale(1.15); } 100% { transform: rotate(360deg) scale(1); }
}
.az-logo-text { font-size: 2.2rem; font-weight:900; letter-spacing:10px; color:#ff00ff; text-shadow: 0 0 20px #ff00ff, 0 0 60px #ff00ff44; }

/* Two-column hub */
.hub-grid {
  display: grid;
  grid-template-columns: minmax(300px, 35%) 1fr;
  gap: 0;
  align-items: stretch;
  width: 100%;
  max-width: 1040px;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 24px;
  overflow: hidden;
  min-height: 400px;
}
.hub-divider {
  width: 1px; background: rgba(255,255,255,0.08);
  display: flex; align-items: center; justify-content: center;
  position: relative;
}
.hub-divider::after {
  content: 'OR';
  background: #000814; color: rgba(255,255,255,0.2);
  font-size: 11px; letter-spacing: 3px; padding: 8px 6px;
  border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;
}

/* Left: Saved Projects sidebar */
.hub-panel-left {
  padding: 36px 28px;
  display: flex; flex-direction: column; align-items: stretch;
  border-right: 1px solid rgba(255,255,255,0.08);
  background: rgba(0,0,0,0.18);
}
.hub-panel-header {
  font-size: 11px; letter-spacing: 5px; color: rgba(255,255,255,0.35);
  margin-bottom: 20px; text-transform: uppercase;
}

/* Right: Main area (Quick View + Live Pipeline stacked) */
.hub-panel-right {
  padding: 36px 32px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: rgba(57,255,20,0.015);
}
.hub-panel-main {
  display: flex; flex-direction: column;
  padding: 32px;
  gap: 24px;
}
.hub-panel-main > .hub-panel-right {
  padding: 16px 4px;
  background: transparent;
}

/* Project List Styles */
.project-list {
  width: 100%;
  overflow-y: auto;
  max-height: 400px;
  padding: 8px;
  background: rgba(20, 20, 25, 0.6);
  border-radius: 8px;
  border: 1px solid rgba(0, 243, 255, 0.2);
}
.project-list::-webkit-scrollbar {
  width: 6px;
}
.project-list::-webkit-scrollbar-thumb {
  background: rgba(0, 243, 255, 0.3);
  border-radius: 3px;
}

.project-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(30, 30, 40, 0.8);
  border: 1px solid rgba(0, 243, 255, 0.25);
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.project-card:hover {
  background: rgba(40, 40, 55, 0.9);
  border-color: rgba(0, 243, 255, 0.5);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 243, 255, 0.15);
}

.project-card-info {
  flex: 1;
  min-width: 0;
}

.project-card-name {
  color: #fff;
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.project-card-meta {
  color: rgba(255, 255, 255, 0.6);
  font-size: 11px;
  line-height: 1.4;
}

#drop-zone {
  width: 100%; padding: 28px 20px;
  border: 2px dashed rgba(0,243,255,0.35); border-radius: 16px;
  background: rgba(0,243,255,0.03); cursor: pointer;
  transition: all 0.25s cubic-bezier(.22,1,.36,1); position: relative; overflow: hidden;
}
#drop-zone::before {
  content: ''; position: absolute; inset: 0; border-radius: 14px;
  background: radial-gradient(ellipse at 50% 0%, rgba(0,243,255,0.07) 0%, transparent 70%); pointer-events: none;
}
#drop-zone.dz-hover {
  border-color: #00f3ff; background: rgba(0,243,255,0.08);
  box-shadow: 0 0 50px rgba(0,243,255,0.25), inset 0 0 30px rgba(0,243,255,0.05); transform: scale(1.01);
}
.dz-icon-idle svg { filter: drop-shadow(0 0 8px #00f3ff88); animation: float-icon 3s ease-in-out infinite; }
@keyframes float-icon { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
.dz-icon-hover svg { animation: none; filter: drop-shadow(0 0 20px #00f3ff) drop-shadow(0 0 40px #00f3ff66); }
.dz-title { font-size: 1.1rem; font-weight:900; letter-spacing:4px; color:#00f3ff; margin: 12px 0 6px; }
.dz-text { font-size:0.8rem; color:#ffffff55; line-height:1.8; }
.dz-slot {
  display:flex; align-items:center; gap:8px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(0,243,255,0.2);
  border-radius: 10px; padding: 8px 14px; font-size:0.78rem;
  color:#ffffff88; transition: all 0.3s; min-width: 150px; justify-content: center;
}
.dz-slot.dz-slot-optional { border-color: rgba(255,0,255,0.2); }
.dz-slot.dz-slot-loaded { border-color: #39ff14; color: #39ff14; background: rgba(57,255,20,0.07); box-shadow: 0 0 14px rgba(57,255,20,0.2); }
.dz-slot-icon { font-size:1rem; }
.dz-slot-check { color:#39ff14; font-size:0.9rem; font-weight:bold; }
.az-btn {
  margin-top: 22px; background: rgba(0,243,255,0.08); border: 1.5px solid rgba(0,243,255,0.4);
  color: #00f3ff; font-family: 'Courier New', monospace; font-size: 1rem; font-weight: 900;
  letter-spacing: 4px; padding: 14px 36px; border-radius: 12px; cursor: pointer;
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
.az-status { margin-top: 14px; font-size: 0.82rem; color: #39ff14; min-height: 20px; letter-spacing: 2px; }
.az-loader-track { width: 100%; height: 4px; background: rgba(0,243,255,0.1); border-radius: 2px; overflow: hidden; }
.az-loader-bar {
  height: 100%; background: linear-gradient(90deg, #00f3ff, #ff00ff); border-radius: 2px; width: 0%;
  animation: loader-scan 1.8s ease-in-out infinite;
}
@keyframes loader-scan { 0% { width: 0%; margin-left: 0; } 50% { width: 75%; margin-left: 0; } 100% { width: 0%; margin-left: 100%; } }
.az-loader-label { margin-top: 10px; font-size: 0.78rem; letter-spacing: 3px; color: #00f3ff88; text-align: center; }

/* Live Pipeline Buttons */
.lp-btn {
  width: 280px; padding: 20px 24px;
  border-radius: 16px; border: 1px solid;
  font-family: 'Courier New', monospace;
  cursor: pointer; transition: all 0.3s;
  display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
  text-align: left; margin-bottom: 16px;
  position: relative; overflow: hidden;
}
.lp-btn::before {
  content: ''; position: absolute; inset: 0;
  background: currentColor; opacity: 0; transition: opacity 0.3s;
}
.lp-btn:hover::before { opacity: 0.06; }
.lp-btn-local {
  background: rgba(57,255,20,0.05);
  border-color: rgba(57,255,20,0.4);
  color: #39ff14;
  box-shadow: 0 0 24px rgba(57,255,20,0.1);
}
.lp-btn-local:hover {
  border-color: #39ff14;
  box-shadow: 0 0 50px rgba(57,255,20,0.3), 0 0 100px rgba(57,255,20,0.1);
  transform: translateY(-2px);
}
.lp-btn-cloud {
  background: rgba(255,255,255,0.02);
  border-color: rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.2);
  cursor: not-allowed;
  filter: grayscale(1);
}
.lp-btn-title {
  font-size: 1rem; font-weight: 900; letter-spacing: 3px; text-transform: uppercase;
}
.lp-btn-sub {
  font-size: 0.72rem; opacity: 0.7; letter-spacing: 1.5px; text-transform: uppercase;
}
.lp-badge {
  position: absolute; top: 12px; right: 12px;
  font-size: 9px; letter-spacing: 2px; padding: 3px 8px;
  border-radius: 4px; text-transform: uppercase; font-weight: 900;
}
.lp-badge-live { background: rgba(57,255,20,0.15); color: #39ff14; border: 1px solid rgba(57,255,20,0.3); }
.lp-badge-soon { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.1); }

/* Missing volume modal */
#local-missing-modal {
  display: none; position: fixed; inset: 0; z-index: 1100;
  background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
  align-items: center; justify-content: center;
}
#local-missing-modal.open { display: flex; }
.lm-card {
  background: #010a18; border: 1px solid rgba(57,255,20,0.3);
  border-radius: 20px; padding: 40px 48px; max-width: 580px; width: 90%;
  box-shadow: 0 0 80px rgba(0,0,0,0.8), 0 0 40px rgba(57,255,20,0.05);
  text-align: left;
}
.lm-title { font-size: 1.4rem; font-weight: 900; letter-spacing: 5px; color: #ff6600; margin-bottom: 20px; }
.lm-body { font-size: 1.5rem; color: rgba(255,255,255,0.9); line-height: 1.5; letter-spacing: 0.5px; margin-bottom: 30px; }
.lm-code-container { position: relative; margin-bottom: 24px; }
.lm-code {
  background: rgba(0,0,0,0.8); border: 1px solid rgba(57,255,20,0.2);
  border-radius: 12px; padding: 26px; font-family: 'JetBrains Mono', 'Courier New', monospace;
  font-size: 0.95rem; color: #39ff14; letter-spacing: 0.5px;
  white-space: pre-wrap; word-break: break-all; min-height: 100px;
  box-shadow: inset 0 0 30px rgba(0,0,0,0.7);
}
.lm-copy-btn {
  position: absolute; top: 12px; right: 12px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.5); padding: 5px 12px; border-radius: 6px; cursor: pointer;
  font-size: 11px; display: flex; align-items: center; gap: 8px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); backdrop-filter: blur(4px);
}
.lm-copy-btn:hover { background: rgba(57,255,20,0.1); border-color: rgba(57,255,20,0.4); color: #39ff14; }
.lm-copy-btn.copied { background: #39ff14; color: #000; border-color: #39ff14; box-shadow: 0 0 15px rgba(57,255,20,0.4); }
.lm-close {
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.15);
  color: #fff; padding: 14px 60px; border-radius: 10px; cursor: pointer;
  font-size: 0.9rem; font-weight: 700; letter-spacing: 3px; transition: all 0.3s;
  box-shadow: 0 4px 15px rgba(0,0,0,0.2);
}
.lm-close:hover {
  background: rgba(0,255,255,0.1); border-color: #00ffff; color: #00ffff;
  box-shadow: 0 0 20px rgba(0,255,255,0.3), inset 0 0 10px rgba(0,255,255,0.2);
  transform: translateY(-2px);
}

  /* Global Error Overlay */
  #js-error-overlay {
    display: none; position: fixed; top: 20px; left: 20px; right: 20px;
    background: rgba(255, 0, 0, 0.9); color: white; padding: 20px;
    border-radius: 12px; z-index: 10000; font-family: 'JetBrains Mono', monospace;
    box-shadow: 0 0 30px rgba(255, 0, 0, 0.5); border: 2px solid white;
  }
  .status-dot {
    width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 8px;
    background: #666; transition: all 0.3s;
  }
  .status-dot.green { 
    background: #39ff14; 
    box-shadow: 0 0 10px #39ff14; 
    animation: pulse-green 2s infinite; 
  }
  .status-dot.orange { background: #ffaa00; box-shadow: 0 0 10px #ffaa00; }
  @keyframes pulse-green {
    0% { box-shadow: 0 0 0 0 rgba(57,255,20, 0.7); }
    70% { box-shadow: 0 0 0 10px rgba(57,255,20, 0); }
    100% { box-shadow: 0 0 0 0 rgba(57,255,20, 0); }
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
<div id="subtitle">PERFORMANCE PROFILER · OBSERVABILITY ENGINE V1.0</div>

<button id="btn-global-view" type="button" title="Global View (M) — orbit camera around the city" aria-label="Global View">🌎</button>
<button id="btn-tactical-map" type="button" title="Global Pipeline View" aria-label="Global Pipeline View">🗺️</button>

<button id="omni-launch">⌘/Ctrl + K · Jump to model…</button>
<div id="omni-modal">
  <div id="omni-card">
    <input id="omni-input" type="text" placeholder="Search models, layers, packages…" autocomplete="off">
    <div id="omni-results"></div>
  </div>
</div>

<!-- Global Pipeline View Overlay -->
<div id="tactical-map-overlay" style="display: none;">
  <div id="tactical-map-container">
    <div id="tactical-map-header">
      <h2>GLOBAL PIPELINE VIEW</h2>
      <button id="close-tactical-map" title="Close">✕</button>
    </div>
    <canvas id="tactical-map-canvas"></canvas>
    <div id="tactical-map-legend">
      <div class="legend-item">
        <span class="legend-dot" style="background: rgba(140, 200, 240, 0.9);"></span>
        <span>Active Islands</span>
      </div>
      <div class="legend-item">
        <span class="legend-dot" style="background: rgba(255, 68, 48, 0.9);"></span>
        <span>Alert Islands</span>
      </div>
      <div class="legend-item">
        <span class="legend-dot" style="background: rgba(255, 255, 255, 0.95);"></span>
        <span>Current Position</span>
      </div>
    </div>
  </div>
</div>

<style>
#tactical-map-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(6, 14, 24, 0.85);
  backdrop-filter: blur(12px);
  z-index: 1000;
  display: none;
  align-items: center;
  justify-content: center;
}

#tactical-map-container {
  width: 90%;
  height: 85%;
  max-width: 1400px;
  background: rgba(10, 20, 32, 0.95);
  border: 2px solid rgba(0, 243, 255, 0.4);
  border-radius: 16px;
  padding: 20px;
  position: relative;
  box-shadow: 0 0 60px rgba(0, 243, 255, 0.2);
}

#tactical-map-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  color: #fff;
}

#tactical-map-header h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: 2px;
  color: #00f3ff;
}

#close-tactical-map {
  background: rgba(255, 68, 48, 0.3);
  border: 1px solid rgba(255, 68, 48, 0.6);
  color: #fff;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

#close-tactical-map:hover {
  background: rgba(255, 68, 48, 0.6);
  transform: scale(1.05);
}

#tactical-map-canvas {
  width: 100%;
  height: calc(100% - 60px);
  border-radius: 8px;
  background: rgba(0, 10, 20, 0.8);
  cursor: crosshair;
}

#tactical-map-legend {
  position: absolute;
  bottom: 30px;
  left: 30px;
  background: rgba(0, 10, 20, 0.9);
  border: 1px solid rgba(0, 243, 255, 0.3);
  border-radius: 8px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #fff;
  font-size: 12px;
}

.legend-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}
</style>

<!-- AWAITING DATA OVERLAY / HUB -->
<div id="awaiting-overlay" style="display:none;">
  <button id="dz-cancel" title="Back to City">✕</button>
  <canvas id="az-bg" style="position:absolute;inset:0;width:100%;height:100%;opacity:0.12;"></canvas>
  <div class="az-inner">
    <!-- Logo -->
    <div class="az-logo">
      <div class="az-logo-glyph">&#9670;</div>
      <div class="az-logo-text">DAG_CITY</div>
    </div>

    <!-- Two-column Hub Grid -->
    <div class="hub-grid">

      <!-- LEFT COLUMN: Saved Projects -->
      <div class="hub-panel-left">
        <div class="hub-panel-header">📁 Saved Projects</div>
        <div id="project-list" class="project-list"></div>
      </div>

      <!-- RIGHT COLUMN: Quick View + Live Pipeline stacked -->
      <div class="hub-panel-main">

        <!-- Quick View / Dropzone -->
        <div class="hub-panel-right">
          <div class="hub-panel-header">⚡ Quick View</div>
          <div id="drop-zone" ondragover="dzDragOver(event);" ondragleave="dzDragLeave(event);" ondrop="dzDrop(event);" onclick="document.getElementById('manifest-upload').click();">
            <div id="dz-icon" class="dz-icon-idle">
              <svg width="48" height="48" viewBox="0 0 56 56" fill="none">
                <path d="M28 6v30M16 20l12-14 12 14" stroke="#00f3ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                <rect x="8" y="38" width="40" height="12" rx="4" stroke="#00f3ff" stroke-width="2" fill="none"/>
                <circle cx="15" cy="44" r="2" fill="#00f3ff"/>
                <circle cx="41" cy="44" r="2" fill="#ff00ff"/>
              </svg>
            </div>
            <div id="dz-title" class="dz-title">DRAG &amp; DROP FILES</div>
            <div id="dz-sub" class="dz-text">manifest.json &nbsp;+&nbsp; run_results.json (optional)<br><span style="font-size:0.72rem;opacity:0.5;">or click to browse</span></div>
            <div id="dz-slots" style="margin-top:16px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
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
          <div id="az-loader" style="display:none;width:100%;margin-top:16px;">
            <div class="az-loader-track"><div id="az-loader-bar" class="az-loader-bar"></div></div>
            <div id="az-loader-label" class="az-loader-label">PARSING ARCHITECTURE…</div>
          </div>
        </div>

        <!-- Live Pipeline -->
        <div class="hub-panel-right">
          <div class="hub-panel-header">🔴 Live Pipeline</div>

          <button class="lp-btn lp-btn-local" id="btn-connect-local" onclick="connectLocal()">
            <span class="lp-badge lp-badge-live">LIVE</span>
            <span class="lp-btn-title">🔗 Connect Local</span>
            <span class="lp-btn-sub">Mount your dbt project → instant live sync</span>
          </button>

          <button class="lp-btn lp-btn-cloud" disabled title="Coming Soon">
            <span class="lp-badge lp-badge-soon">COMING SOON</span>
            <span class="lp-btn-title">☁️ Connect Cloud</span>
            <span class="lp-btn-sub">dbt Cloud · Databricks · Snowflake</span>
          </button>

          <div id="lp-status" style="font-size:0.78rem;color:rgba(255,255,255,0.3);letter-spacing:2px;margin-top:8px;">CHECKING ENVIRONMENT…</div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Missing Volume Modal -->
<div id="local-missing-modal">
  <div class="lm-card">
    <div class="lm-title">🛰️ LIVE SYNC</div>
    <div class="lm-body">Connect your local dbt project to enable live updates in the 3D world.</div>
    
    <div class="lm-code-container">
      <button class="lm-copy-btn" onclick="copyCommand(this)">
        <span id="copy-icon">📋</span>
        <span id="copy-text">COPY</span>
      </button>
      <div class="lm-code" id="docker-command"># Set your project path in .env:
HOST_PROJECT_PATH="/absolute/path/to/your/dbt-project"</div>
    </div>

    <div class="lm-body" style="font-size:1.2rem; opacity: 0.8; margin-bottom: 10px;">
      After saving, run <code>docker compose up -d</code> to apply changes. 
    </div>
    <div class="lm-body" style="font-size:0.95rem; opacity: 0.5; font-style: italic;">
      Ensure your project is compiled (run <code>dbt compile</code> first).
    </div>
    <div style="display:flex; justify-content: center; margin-top: 20px;">
      <button class="lm-close" onclick="document.getElementById('local-missing-modal').classList.remove('open')">GOT IT</button>
    </div>
  </div>
</div>

<script>
  async function copyCommand(btn) {
    const code = document.getElementById('docker-command').innerText;
    try {
      await navigator.clipboard.writeText(code);
      const icon = btn.querySelector('#copy-icon');
      const text = btn.querySelector('#copy-text');
      const oldIcon = icon.innerText;
      const oldText = text.innerText;
      
      btn.classList.add('copied');
      icon.innerText = '✅';
      text.innerText = 'COPIED!';
      
      setTimeout(() => {
        btn.classList.remove('copied');
        icon.innerText = oldIcon;
        text.innerText = oldText;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy: ', err);
    }
  }
</script>


<!-- IDE DOCK -->
<div id="ide-dock">
  <div class="dock-section">
    <div class="dock-item" id="dock-projects" title="Project Manager">
      <span class="dock-icon">📁</span>
      <span class="dock-label">PROJECT MANAGER</span>
    </div>
    <div class="dock-item" id="dock-settings" title="Engine Settings">
      <span class="dock-icon">⚙️</span>
      <span class="dock-label">VIEWPORT & ENGINE</span>
    </div>
  </div>
  <div class="dock-divider"></div>
  <div class="dock-section">
    <div class="dock-item" id="dock-sla" title="Observability Engine">
      <span class="dock-icon">🔥</span>
      <span class="dock-label">OBSERVABILITY ENGINE</span>
    </div>
    <div class="dock-item" id="dock-architecture" title="Architecture &amp; Volume">
      <span class="dock-icon">📊</span>
      <span class="dock-label">ARCHITECTURE &amp; VOLUME</span>
    </div>
    <div class="dock-item ai-item" id="dock-ai" title="AI Copilot">
      <span class="dock-icon">🤖</span>
      <span class="dock-label">AI COPILOT</span>
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
    <div id="pm-body">
      <div id="pm-filters">
        <button class="pm-filter-btn active" id="pm-filter-all">All</button>
        <button class="pm-filter-btn" id="pm-filter-active">Active</button>
        <button class="pm-filter-btn" id="pm-filter-inactive">Inactive</button>
      </div>
      <div id="pm-list"></div>
    </div>
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
      <div class="sla-label">Performance View</div>
      <div class="settings-row" style="margin-top:8px; margin-bottom:0;">
        <div class="settings-name">Performance 3D Mode</div>
        <label class="switch">
          <input type="checkbox" id="check-perf-mode">
          <span class="slider"></span>
        </label>
      </div>
      <div class="sla-desc" style="margin-top:10px;">Enable thermal performance layer and timing labels.</div>
    </div>

    <div class="sla-section">
      <div class="sla-label">Graphics Quality</div>
      <div class="graphics-control">
        <span>Low</span>
        <input type="range" id="graphics-slider" min="0" max="1" step="1" value="1">
        <span>High</span>
      </div>
      <div class="sla-desc" style="margin-top:10px;">Optimize for large projects (1000+ nodes): disable bloom, use basic materials, hide particles.</div>
    </div>

    <div class="sla-section">
      <div class="sla-label">Render Distance</div>
      <div class="graphics-control">
        <span>1k</span>
        <input type="range" id="render-distance-slider" min="1000" max="10000" step="100" value="2500">
        <span>10k</span>
      </div>
      <div class="sla-row" style="margin-top:8px;">
        <div class="sla-name">Far Plane</div>
        <div class="sla-val" id="render-distance-val">2500</div>
      </div>
      <div class="sla-desc" style="margin-top:8px;">Maximum view distance. Lower = faster FPS, less city visible at once. Global View temporarily overrides this to fit the whole map.</div>
    </div>

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
      <div class="sla-fire-count" style="margin-top: 8px;">
        <div class="fire-num" id="fps-counter">60</div>
        <div class="fire-label">FPS</div>
      </div>
    </div>
    <div class="sla-section">
      <div class="sla-label">Thermal VFX Sensitivity</div>
      <div class="sla-desc" style="margin-bottom:12px;">Trigger effects based on SLA ratio (e.g., 1.5x threshold)</div>
      
      <div class="sla-row">
        <div class="sla-name">💨 Smoke Threshold</div>
        <div class="sla-val" id="val-vfx-smoke">1.0x</div>
      </div>
      <div class="sla-slider-track">
        <div class="sla-slider-fill" id="fill-vfx-smoke" style="width:20%"></div>
        <input type="range" class="sla-input" id="input-vfx-smoke" min="50" max="300" value="100" oninput="window._onVFX('smoke', this.value)" onchange="window._saveVFX()">
      </div>

      <div class="sla-row" style="margin-top:12px;">
        <div class="sla-name">⚡ Sparks & Pulse</div>
        <div class="sla-val" id="val-vfx-sparks">1.2x</div>
      </div>
      <div class="sla-slider-track">
        <div class="sla-slider-fill" id="fill-vfx-sparks" style="width:28%"></div>
        <input type="range" class="sla-input" id="input-vfx-sparks" min="50" max="300" value="120" oninput="window._onVFX('sparks', this.value)" onchange="window._saveVFX()">
      </div>

      <div class="sla-row" style="margin-top:12px;">
        <div class="sla-name">🔥 Critical Fire</div>
        <div class="sla-val" id="val-vfx-fire">1.5x</div>
      </div>
      <div class="sla-slider-track">
        <div class="sla-slider-fill" id="fill-vfx-fire" style="width:40%"></div>
        <input type="range" class="sla-input" id="input-vfx-fire" min="50" max="300" value="150" oninput="window._onVFX('fire', this.value)" onchange="window._saveVFX()">
      </div>
    </div>

    <div class="sla-section">
      <div class="sla-label">Zone Overrides (by Layer)</div>
      <div id="sla-zones"><!-- dynamic --></div>
    </div>
    <div class="sla-section">
      <div class="sla-label">Custom Node Overrides</div>
      <div id="add-node-override-btn" class="add-override-btn">+ Add Specific Node Override</div>
      <input type="text" id="sla-node-search" placeholder="🔍  Search node name…" style="display:none; margin-top:8px;">
      <div id="sla-node-results"></div>
      <div id="sla-overrides-list"></div>
    </div>
  </div>
</div>

<!-- SETTINGS DRAWER -->
<div id="settings-panel">
  <div id="sla-header">
    <div id="sla-title">⚙️ ENGINE CONTROLS</div>
    <div id="settings-close" style="width:32px;height:32px;border-radius:50%;border:1px solid rgba(0,242,255,0.3);background:rgba(0,242,255,0.06);color:var(--cyan);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;">✕</div>
  </div>
  <div id="sla-body">
    <div class="settings-section">
      <div class="settings-label">Camera & Input</div>
      <div class="settings-row" style="margin-top:20px;">
        <div class="settings-name">Drone Fly Speed (WASD)</div>
        <div class="settings-val" id="val-fly-speed">1.0x</div>
      </div>
      <div class="sla-slider-track">
        <div class="sla-slider-fill" id="fill-fly-speed" style="width:20%"></div>
        <input type="range" class="sla-input" id="input-fly-speed" min="50" max="300" value="100" oninput="window._onFlySpeed(this.value)" onchange="window._onFlySpeedChange()">
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-label">Navigation</div>
      <div class="settings-row">
        <div class="settings-name">Auto-Rotate</div>
        <label class="switch">
          <input type="checkbox" id="check-auto-rotate" checked>
          <span class="slider"></span>
        </label>
      </div>
      <div class="sla-desc" style="margin-top:-5px;margin-bottom:20px;">Smooth cinematic orbit around the city</div>

      <button class="settings-action-btn" id="btn-reset-view">RESET VIEW</button>
      <button class="settings-action-btn" id="btn-global-view-settings" style="margin-top:10px;">🌎 VISTA GLOBAL</button>
    </div>

    <div class="settings-section">
      <div class="settings-label">Post-Processing</div>
      <div class="settings-row">
        <div class="settings-name">Neon Bloom Intensity</div>
        <div class="settings-val" id="val-bloom">0.0</div>
      </div>
      <div class="sla-slider-track">
        <div class="sla-slider-fill" id="fill-bloom" style="width:0%"></div>
        <input type="range" class="sla-input" id="input-bloom" min="0" max="200" value="0">
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-label">Visibility & Quality</div>
      
      <div class="settings-row">
        <div class="settings-name">Show Building Labels</div>
        <label class="switch">
          <input type="checkbox" id="check-labels" checked>
          <span class="slider"></span>
        </label>
      </div>
      <div class="sla-desc" style="margin-top:-5px;margin-bottom:20px;">Hide names for a cleaner cinematic view</div>

      <div class="settings-row">
        <div class="settings-name">Enable Particle VFX</div>
        <label class="switch">
          <input type="checkbox" id="check-vfx" checked>
          <span class="slider"></span>
        </label>
      </div>
      <div class="sla-desc" style="margin-top:-5px;">Toggle smoke, sparks and fire (Performance)</div>
    </div>

    <div class="settings-section">
      <div class="settings-label">AI Copilot</div>
      <div class="settings-row" style="margin-bottom:8px;">
        <div class="settings-name">AI Engine</div>
        <select id="select-ai-engine" class="arch-select" style="width:140px;">
          <option value="openai">OpenAI</option>
          <option value="groq">Groq</option>
        </select>
      </div>
      <div class="settings-name" style="margin-bottom:8px;">API Key</div>
      <input type="password" id="input-openai-key" class="settings-text-input" placeholder="sk-...">
      <button id="btn-save-openai-key" class="settings-inline-btn">SAVE API KEY</button>
      <div class="sla-desc" id="openai-key-status" style="margin-top:8px;">Stored locally in this browser.</div>
    </div>
  </div>
</div>

<!-- ARCHITECTURE & VOLUME DRAWER -->
<div id="architecture-panel">
  <div id="sla-header">
    <div id="sla-title">📊 ARCHITECTURE &amp; VOLUME</div>
    <div id="architecture-close" style="width:32px;height:32px;border-radius:50%;border:1px solid rgba(57,255,20,0.3);background:rgba(57,255,20,0.06);color:var(--green);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;">✕</div>
  </div>
  <div id="sla-body">
    <div class="settings-section">
      <div class="settings-label" style="color:var(--green)">Data Swell</div>

      <div class="settings-row">
        <div class="settings-name">ENABLE DATA SWELL (VOLUME 3D)</div>
        <label class="switch">
          <input type="checkbox" id="check-data-volume">
          <span class="slider"></span>
        </label>
      </div>
      <div class="sla-desc" style="margin-top:-5px;">Scale building thickness by selected metric to reveal heavy zones.</div>

      <div id="arch-swell-controls" class="arch-subgroup hidden">
        <div class="arch-preview">
          <div class="arch-preview-title">Selected Node Metric</div>
          <div class="arch-preview-value" id="arch-selected-metric-value">Select a building to inspect metric value.</div>
        </div>

        <div class="settings-row" style="margin-top:4px;">
          <div class="settings-name">Auto-Adjust</div>
          <label class="switch">
            <input type="checkbox" id="check-auto-threshold" checked>
            <span class="slider"></span>
          </label>
        </div>
        <div class="sla-desc" id="auto-threshold-hint" style="margin-top:-5px;margin-bottom:10px;">Using project max as threshold.</div>

        <div class="settings-row" style="display:block; margin-top:6px;">
          <div class="settings-name" style="margin-bottom:8px;">Reference Threshold</div>
          <input type="number" id="input-reference-threshold" class="arch-number" min="1" step="1" value="1" disabled>
        </div>

        <div class="settings-row" style="display:block;">
          <div class="settings-name" style="margin-bottom:8px;">Scale Metric</div>
          <select id="select-swell-metric" class="arch-select">
            <option value="rows">Rows</option>
            <option value="code_length">Code Length</option>
            <option value="connections">Total Connections</option>
          </select>
        </div>

        <div class="settings-row" style="margin-top:18px;">
          <div class="settings-name">Swell Intensity</div>
          <div class="settings-val" id="val-swell-intensity">1.0x</div>
        </div>
        <div class="sla-slider-track">
          <div class="sla-slider-fill" id="fill-swell-intensity" style="width:20%"></div>
          <input type="range" class="sla-input" id="input-swell-intensity" min="50" max="300" value="100">
        </div>

        <div class="settings-row" style="margin-top:16px;">
          <div class="settings-name">Yellow Threshold</div>
          <div class="settings-val" id="val-warn-threshold">60%</div>
          <div class="sla-desc" id="val-warn-threshold-exact" style="margin-top:4px;font-size:12px;color:rgba(255,255,255,0.25);">60 rows</div>
        </div>
        <div class="sla-slider-track">
          <div class="sla-slider-fill" id="fill-warn-threshold" style="width:60%"></div>
          <input type="range" class="sla-input" id="input-warn-threshold" min="10" max="95" value="60">
        </div>

        <div class="settings-row" style="margin-top:12px;">
          <div class="settings-name">Red Threshold</div>
          <div class="settings-val" id="val-critical-threshold">100%</div>
          <div class="sla-desc" id="val-critical-threshold-exact" style="margin-top:4px;font-size:12px;color:rgba(255,255,255,0.25);">100 rows</div>
        </div>
        <div class="sla-slider-track">
          <div class="sla-slider-fill" id="fill-critical-threshold" style="width:100%"></div>
          <input type="range" class="sla-input" id="input-critical-threshold" min="20" max="200" value="100">
        </div>

        <div class="arch-threshold-legend">
          <div class="legend-row"><span class="dot" style="background:#00f3ff"></span><span id="legend-low-range">&lt; 60% → Cyan</span></div>
          <div class="legend-row"><span class="dot" style="background:#ffd700"></span><span id="legend-mid-range">60% to 100% → Yellow</span></div>
          <div class="legend-row"><span class="dot" style="background:#ff4400"></span><span id="legend-high-range">≥ 100% → Red</span></div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- AI COPILOT DRAWER -->
<div id="ai-panel">
  <div id="sla-header">
    <div id="sla-title">🤖 AI COPILOT</div>
    <div id="ai-close" style="width:32px;height:32px;border-radius:50%;border:1px solid rgba(255,0,255,0.3);background:rgba(255,0,255,0.06);color:var(--magenta);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;">✕</div>
  </div>
  <div id="ai-chat-body"></div>
  <div id="ai-chat-input-row">
    <input id="ai-chat-input" type="text" placeholder="Ask about SLA risks, bottlenecks, lineage...">
    <button id="ai-chat-send">SEND</button>
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

<!-- Live sync / offline indicator (under #stats, bottom-right) -->
<div id="sync-hud-item" title="Connection Mode">
  <span id="sync-hud-dot" class="status-dot"></span> <span id="sync-hud-text">CHECKING...</span>
</div>


<!-- Three.js CDN -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.134.0/examples/js/controls/OrbitControls.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.134.0/examples/js/renderers/CSS2DRenderer.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.134.0/examples/js/postprocessing/EffectComposer.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.134.0/examples/js/postprocessing/RenderPass.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.134.0/examples/js/postprocessing/ShaderPass.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.134.0/examples/js/shaders/CopyShader.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.134.0/examples/js/shaders/LuminosityHighPassShader.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.134.0/examples/js/postprocessing/UnrealBloomPass.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cytoscape@3.30.2/dist/cytoscape.min.js"></script>

<!-- Data injection -->
<script>
window.__RAW__ = $DATA_PAYLOAD;
</script>

<!-- ES6 Module entry point -->
<script type="module" src="/static/js/main.js?v=$BUILD_HASH"></script>
</body>
</html>"""

    def generate(self, graph_data: Dict[str, Any], output_path: str, build_id: str = "dev"):
        html = (self.HTML_TEMPLATE
                .replace("$DATA_PAYLOAD", json.dumps(graph_data, indent=2))
                .replace("$BUILD_HASH", build_id))
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
