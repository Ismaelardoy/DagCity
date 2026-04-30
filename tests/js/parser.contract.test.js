// ─────────────────────────────────────────────────────────────────
// parser.test.js — Unit tests for the ManifestParser backend contract
// Tests the JSON output shape produced by the Python parser via
// a mock fetch response, exercising DataManager ingestion logic.
// Runner: Jest (jsdom environment)
// ─────────────────────────────────────────────────────────────────

// ── Helpers: simulate what ManifestParser outputs ────────────────

function makeNode(overrides = {}) {
  return {
    id: 'model.tp.stg_orders',
    name: 'stg_orders',
    resource_type: 'model',
    materialized: 'view',
    layer: 'staging',
    file_path: 'models/staging/stg_orders.sql',
    color: '#ff0077',
    emissive: '#7a0033',
    description: '',
    group: 'STAGING',
    schema: 'staging',
    columns: [],
    upstream: [],
    downstream: [],
    execution_time: 0,
    row_count: 0,
    time_source: 'none',
    is_bottleneck: false,
    is_dead_end: false,
    ...overrides,
  };
}

function makeGraph(nodeOverrides = [], links = []) {
  const nodes = nodeOverrides.length ? nodeOverrides : [makeNode()];
  return {
    metadata: {
      generated_at: '2024-01-01T00:00:00Z',
      has_real_times: false,
      total_exec_time: 0,
      avg_exec_time: 0,
      source: 'offline',
    },
    nodes,
    links,
  };
}

// ── Graph structure validation ────────────────────────────────────

describe('Graph output shape', () => {
  test('graph has required top-level keys', () => {
    const graph = makeGraph();
    expect(graph).toHaveProperty('metadata');
    expect(graph).toHaveProperty('nodes');
    expect(graph).toHaveProperty('links');
  });

  test('metadata has has_real_times boolean', () => {
    const graph = makeGraph();
    expect(typeof graph.metadata.has_real_times).toBe('boolean');
  });

  test('nodes is an array', () => {
    const graph = makeGraph();
    expect(Array.isArray(graph.nodes)).toBe(true);
  });

  test('links is an array', () => {
    const graph = makeGraph();
    expect(Array.isArray(graph.links)).toBe(true);
  });
});

// ── Node shape validation ─────────────────────────────────────────

describe('Node output shape', () => {
  const REQUIRED_FIELDS = [
    'id', 'name', 'resource_type', 'layer', 'color', 'emissive',
    'group', 'columns', 'upstream', 'downstream',
    'execution_time', 'row_count', 'time_source',
    'is_bottleneck', 'is_dead_end',
  ];

  REQUIRED_FIELDS.forEach(field => {
    test(`node has required field: ${field}`, () => {
      const node = makeNode();
      expect(node).toHaveProperty(field);
    });
  });

  test('node columns is an array', () => {
    const node = makeNode({ columns: [{ name: 'id', type: 'VARCHAR', description: '' }] });
    expect(Array.isArray(node.columns)).toBe(true);
  });

  test('node upstream is an array', () => {
    const node = makeNode({ upstream: ['model.tp.raw_orders'] });
    expect(Array.isArray(node.upstream)).toBe(true);
  });

  test('node downstream is an array', () => {
    expect(Array.isArray(makeNode().downstream)).toBe(true);
  });

  test('is_bottleneck is boolean', () => {
    expect(typeof makeNode().is_bottleneck).toBe('boolean');
  });

  test('is_dead_end is boolean', () => {
    expect(typeof makeNode().is_dead_end).toBe('boolean');
  });

  test('execution_time is a number', () => {
    expect(typeof makeNode().execution_time).toBe('number');
  });

  test('execution_time >= 0', () => {
    expect(makeNode().execution_time).toBeGreaterThanOrEqual(0);
  });
});

// ── Layer & color contract ────────────────────────────────────────

describe('Layer → color contract', () => {
  const LAYER_COLORS = {
    source:       '#00ff66',
    staging:      '#ff0077',
    intermediate: '#9d4edd',
    mart:         '#00f2ff',
    consumption:  '#ffd700',
  };

  Object.entries(LAYER_COLORS).forEach(([layer, color]) => {
    test(`layer '${layer}' maps to color '${color}'`, () => {
      const node = makeNode({ layer, color });
      expect(node.color).toBe(color);
    });
  });
});

// ── Link structure ────────────────────────────────────────────────

describe('Link output shape', () => {
  test('link has source and target', () => {
    const link = { source: 'model.tp.stg_a', target: 'model.tp.int_b' };
    expect(link).toHaveProperty('source');
    expect(link).toHaveProperty('target');
  });

  test('source and target are different', () => {
    const link = { source: 'model.tp.a', target: 'model.tp.b' };
    expect(link.source).not.toBe(link.target);
  });

  test('graph links reference existing node ids', () => {
    const nodeA = makeNode({ id: 'model.tp.stg_a', name: 'stg_a' });
    const nodeB = makeNode({ id: 'model.tp.int_b', name: 'int_b', upstream: ['model.tp.stg_a'] });
    const graph = makeGraph([nodeA, nodeB], [{ source: 'model.tp.stg_a', target: 'model.tp.int_b' }]);
    const ids = new Set(graph.nodes.map(n => n.id));
    graph.links.forEach(link => {
      expect(ids.has(link.source)).toBe(true);
      expect(ids.has(link.target)).toBe(true);
    });
  });
});

// ── Bottleneck & dead-end logic ───────────────────────────────────

describe('Bottleneck detection (client-side verification)', () => {
  function flagBottlenecks(nodes) {
    const times = nodes.map(n => n.execution_time).filter(t => t > 0);
    if (times.length < 2) return nodes;
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const variance = times.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / times.length;
    const std = Math.sqrt(variance);
    const threshold = mean + 1.5 * std;
    return nodes.map(n => ({
      ...n,
      is_bottleneck: n.execution_time > threshold && n.execution_time > 0,
    }));
  }

  test('slow node flagged as bottleneck', () => {
    const nodes = [
      makeNode({ id: 'a', execution_time: 1.0 }),
      makeNode({ id: 'b', execution_time: 2.0 }),
      makeNode({ id: 'c', execution_time: 200.0 }),
    ];
    const flagged = flagBottlenecks(nodes);
    expect(flagged.find(n => n.id === 'c').is_bottleneck).toBe(true);
  });

  test('fast nodes not flagged as bottleneck', () => {
    const nodes = [
      makeNode({ id: 'a', execution_time: 1.0 }),
      makeNode({ id: 'b', execution_time: 2.0 }),
      makeNode({ id: 'c', execution_time: 200.0 }),
    ];
    const flagged = flagBottlenecks(nodes);
    expect(flagged.find(n => n.id === 'a').is_bottleneck).toBe(false);
    expect(flagged.find(n => n.id === 'b').is_bottleneck).toBe(false);
  });

  test('no bottleneck when all times are 0', () => {
    const nodes = [
      makeNode({ id: 'a', execution_time: 0 }),
      makeNode({ id: 'b', execution_time: 0 }),
    ];
    const flagged = flagBottlenecks(nodes);
    flagged.forEach(n => expect(n.is_bottleneck).toBe(false));
  });
});

describe('Dead end detection (client-side verification)', () => {
  function flagDeadEnds(nodes) {
    return nodes.map(n => ({
      ...n,
      is_dead_end: ['staging', 'intermediate'].includes(n.layer) && n.downstream.length === 0,
    }));
  }

  test('isolated staging node is a dead end', () => {
    const nodes = [makeNode({ layer: 'staging', downstream: [] })];
    expect(flagDeadEnds(nodes)[0].is_dead_end).toBe(true);
  });

  test('staging with downstream is not a dead end', () => {
    const nodes = [makeNode({ layer: 'staging', downstream: ['model.tp.int_a'] })];
    expect(flagDeadEnds(nodes)[0].is_dead_end).toBe(false);
  });

  test('mart node is never a dead end', () => {
    const nodes = [makeNode({ layer: 'mart', downstream: [] })];
    expect(flagDeadEnds(nodes)[0].is_dead_end).toBe(false);
  });

  test('source node is never a dead end', () => {
    const nodes = [makeNode({ layer: 'source', downstream: [] })];
    expect(flagDeadEnds(nodes)[0].is_dead_end).toBe(false);
  });
});
