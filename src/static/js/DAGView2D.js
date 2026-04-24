import { State } from './State.js';

let cy = null;
let mounted = false;
let lastFocusedId = null;
let lastMiddleClickTs = 0;

function getContainer() {
  return document.getElementById('graph2d-container');
}

function fitAll2D(duration = 320) {
  if (!cy) return;
  const eles = cy.elements();
  if (!eles || !eles.length) return;
  cy.animate({
    fit: { eles, padding: 90 },
    duration,
  });
}

function nodeStyleFor(node) {
  const isBottleneck = !!node.is_bottleneck;
  return {
    backgroundColor: node.color || '#00f3ff',
    borderColor: isBottleneck ? '#ff4400' : '#00f3ff',
    borderWidth: isBottleneck ? 3 : 1,
    shadowColor: isBottleneck ? '#ff4400' : '#00f3ff',
    shadowBlur: isBottleneck ? 26 : 12,
    shadowOpacity: isBottleneck ? 0.65 : 0.35,
  };
}

function toElements(raw) {
  const nodes = (raw?.nodes || []).map((n) => ({
    data: {
      id: n.id,
      label: n.name,
      layer: (n.layer || 'unknown').toUpperCase(),
      color: n.color || '#00f3ff',
      bottleneck: !!n.is_bottleneck,
      execution_time: n.execution_time || 0,
    },
  }));

  const edges = (raw?.links || []).map((l, idx) => {
    const src = typeof l.source === 'object' ? l.source.id : l.source;
    const tgt = typeof l.target === 'object' ? l.target.id : l.target;
    return {
      data: {
        id: `e-${src}-${tgt}-${idx}`,
        source: src,
        target: tgt,
      },
    };
  });

  return [...nodes, ...edges];
}

function applyFilterStyles() {
  if (!cy) return;
  const q = (State.activeFilters?.query || '').trim().toLowerCase();
  if (!q) {
    cy.nodes().style('opacity', 1);
    cy.edges().style('opacity', 0.45);
    return;
  }

  cy.nodes().forEach((node) => {
    const label = (node.data('label') || '').toLowerCase();
    const match = label.includes(q);
    node.style('opacity', match ? 1 : 0.2);
  });

  cy.edges().forEach((edge) => {
    const src = edge.source();
    const tgt = edge.target();
    const visible = (src.style('opacity') > 0.5) || (tgt.style('opacity') > 0.5);
    edge.style('opacity', visible ? 0.35 : 0.08);
  });
}

function applySelectionStyles() {
  if (!cy) return;
  const selectedId = State.selectedNode?.id;
  const blastMode = !!State.blastRadiusSourceId && Array.isArray(State.blastRadiusIds) && State.blastRadiusIds.length > 0;
  const blastSet = blastMode ? new Set(State.blastRadiusIds) : new Set();
  const blastSourceId = blastMode ? State.blastRadiusSourceId : null;

  cy.nodes().forEach((node) => {
    const id = node.id();
    const isSelected = !!selectedId && selectedId === id;
    const inBlast = blastMode && blastSet.has(id);
    const isBlastSource = blastMode && blastSourceId === id;
    const base = nodeStyleFor({
      color: node.data('color'),
      is_bottleneck: node.data('bottleneck'),
    });

    const nodeOpacity = blastMode
      ? (inBlast ? 1 : 0.08)
      : (selectedId ? (isSelected ? 1 : 0.22) : 1);

    const borderColor = isBlastSource
      ? '#ff2200'
      : (inBlast ? '#ff8800' : (isSelected ? '#ffffff' : base.borderColor));

    const bgColor = isBlastSource
      ? '#ff3300'
      : (inBlast ? '#ff7a00' : base.backgroundColor);

    node.style({
      'background-color': bgColor,
      'border-color': borderColor,
      'border-width': (isSelected || isBlastSource) ? 4 : (inBlast ? 3 : base.borderWidth),
      'shadow-color': (isBlastSource || inBlast) ? '#ff5500' : (isSelected ? '#ffffff' : base.shadowColor),
      'shadow-opacity': (isBlastSource || inBlast) ? 0.85 : (isSelected ? 0.8 : base.shadowOpacity),
      'shadow-blur': (isBlastSource || inBlast) ? 42 : (isSelected ? 36 : base.shadowBlur),
      'opacity': nodeOpacity,
      'z-index': (isSelected || isBlastSource) ? 999 : 10,
    });
  });

  cy.edges().forEach((edge) => {
    const isRelated = selectedId && (edge.data('source') === selectedId || edge.data('target') === selectedId);
    const inBlast = blastMode && blastSet.has(edge.data('source')) && blastSet.has(edge.data('target'));
    edge.style({
      'line-color': inBlast ? '#ff6a00' : (isRelated ? '#00f3ff' : '#18364a'),
      'target-arrow-color': inBlast ? '#ff6a00' : (isRelated ? '#00f3ff' : '#18364a'),
      'opacity': blastMode ? (inBlast ? 0.95 : 0.05) : (selectedId ? (isRelated ? 0.9 : 0.08) : 0.45),
      'width': inBlast ? 2.6 : (isRelated ? 2.4 : 1.1),
    });
  });
}

function bindStateListeners() {
  State.on('change:selectedNode', () => {
    applySelectionStyles();
  });

  State.on('change:blastRadiusIds', () => {
    applySelectionStyles();
  });

  State.on('change:blastRadiusSourceId', () => {
    applySelectionStyles();
  });

  State.on('change:activeFilters', () => {
    applyFilterStyles();
  });

  State.on('change:perfMode', () => {
    if (!cy) return;
    cy.nodes().forEach((node) => {
      const bottleneck = !!node.data('bottleneck');
      const targetColor = (State.perfMode && bottleneck) ? '#ff4400' : (node.data('color') || '#00f3ff');
      node.style('background-color', targetColor);
    });
  });
}

export function initDAGView2D(raw) {
  if (mounted) return;
  const container = getContainer();
  if (!container || typeof window.cytoscape === 'undefined') return;

  cy = window.cytoscape({
    container,
    elements: toElements(raw),
    layout: {
      name: 'breadthfirst',
      directed: true,
      padding: 40,
      spacingFactor: 1.15,
      animate: false,
    },
    style: [
      {
        selector: 'node',
        style: {
          'shape': 'round-rectangle',
          'width': 95,
          'height': 38,
          'background-color': '#00f3ff',
          'label': 'data(label)',
          'font-family': 'Courier New, monospace',
          'font-size': 9,
          'font-weight': 700,
          'text-wrap': 'ellipsis',
          'text-max-width': 110,
          'color': '#e9fbff',
          'text-outline-width': 1,
          'text-outline-color': '#03070f',
          'border-width': 1,
          'border-color': '#00f3ff',
          'shadow-blur': 12,
          'shadow-color': '#00f3ff',
          'shadow-opacity': 0.35,
        },
      },
      {
        selector: 'edge',
        style: {
          'curve-style': 'bezier',
          'line-color': '#18364a',
          'target-arrow-shape': 'triangle',
          'target-arrow-color': '#18364a',
          'width': 1.1,
          'opacity': 0.45,
        },
      },
    ],
    wheelSensitivity: 0.18,
    minZoom: 0.2,
    maxZoom: 2.8,
  });

  cy.on('tap', 'node', (evt) => {
    const id = evt.target.id();
    const node = (State.raw?.nodes || []).find((n) => n.id === id);
    if (node) State.set('selectedNode', node);
  });

  cy.on('tap', (evt) => {
    if (evt.target === cy) {
      State.set('selectedNode', null);
    }
  });

  // Middle-mouse double-click => center and fit the whole DAG
  if (container) {
    container.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });

    container.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const now = performance.now();
      if (now - lastMiddleClickTs < 360) {
        fitAll2D();
        lastMiddleClickTs = 0;
      } else {
        lastMiddleClickTs = now;
      }
    });
  }

  bindStateListeners();
  applySelectionStyles();
  applyFilterStyles();
  mounted = true;
}

export function showDAGView2D() {
  const container = getContainer();
  if (!container) return;
  container.style.display = 'block';
  if (cy) {
    cy.resize();
    cy.reset();
    cy.fit(cy.elements(), 90);
  }
}

export function hideDAGView2D() {
  const container = getContainer();
  if (!container) return;
  container.style.display = 'none';
}

export function rebuildDAGView2D(raw) {
  if (!cy) {
    initDAGView2D(raw);
    return;
  }
  cy.elements().remove();
  cy.add(toElements(raw));
  cy.layout({
    name: 'breadthfirst',
    directed: true,
    padding: 40,
    spacingFactor: 1.15,
    animate: false,
  }).run();

  applySelectionStyles();
  applyFilterStyles();
}

export function focusNode2D(nodeNameOrId) {
  if (!cy) return;
  const key = (nodeNameOrId || '').toLowerCase();
  const target = cy.nodes().filter((n) => {
    const id = (n.id() || '').toLowerCase();
    const label = (n.data('label') || '').toLowerCase();
    return id === key || label === key;
  }).first();

  if (!target || target.empty()) return;
  lastFocusedId = target.id();
  cy.animate({
    fit: { eles: target, padding: 140 },
    duration: 360,
  });
}

export function getFocusedNode2D() {
  return lastFocusedId;
}

export function fitView2D() {
  fitAll2D();
}
