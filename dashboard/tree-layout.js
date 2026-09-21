import { TREE_LAYOUT } from '../shared/constants.js';

const VIEWBOX_WIDTH = 900;
const CENTER_X = VIEWBOX_WIDTH / 2;
const GOLDEN_ANGLE = TREE_LAYOUT.GOLDEN_ANGLE * (Math.PI / 180); // Convert degrees to radians

// The silhouette is an illustration, not a graph stretched into a tree shape.
// Pages sit inside its crown; the true parent graph is retained for path tracing.
const STAGES = {
  empty: { height: 470, baseY: 374, crownY: 208, rx: 0, ry: 0, boleWidth: 16, viewX: 205, viewWidth: 490 },
  seed: { height: 520, baseY: 437, crownY: 247, rx: 139, ry: 111, boleWidth: 31, viewX: 195, viewWidth: 510 },
  sapling: { height: 560, baseY: 479, crownY: 245, rx: 209, ry: 144, boleWidth: 43, viewX: 140, viewWidth: 620 },
  canopy: { height: 600, baseY: 518, crownY: 251, rx: 268, ry: 173, boleWidth: 56, viewX: 90, viewWidth: 720 },
  deep: { height: 620, baseY: 536, crownY: 261, rx: 296, ry: 185, boleWidth: 61, viewX: 65, viewWidth: 770 }
};

function depthOf(node) { return Math.max(0, Math.floor(Number.isFinite(node?.depth) ? node.depth : 0)); }
function nodeOrder(a, b) {
  return (Number(a.firstSeenAt) || 0) - (Number(b.firstSeenAt) || 0) || a.id.localeCompare(b.id);
}
function modeFor(nodes, maxDepth) {
  if (nodes.length <= 1) return 'seed';
  if (nodes.length <= 5 && maxDepth <= 2) return 'sapling';
  if (nodes.length <= 18 && maxDepth <= 4) return 'canopy';
  return 'deep';
}
export function branchWidth(depth) { 
  return Math.max(
    TREE_LAYOUT.BRANCH_WIDTH_MIN, 
    TREE_LAYOUT.BRANCH_WIDTH_BASE - Math.max(0, depth - 1) * 0.35
  ); 
}
export function labelPlacement(point, nodeId, root = false) {
  return { nodeId, x: Math.max(200, Math.min(700, point.x)), y: point.y + (root ? 62 : 39), anchor: 'middle' };
}
export function treeStage(mode = 'sapling') {
  const config = STAGES[mode] || STAGES.sapling;
  return {
    mode: Object.hasOwn(STAGES, mode) ? mode : 'sapling', width: VIEWBOX_WIDTH, height: config.height,
    baseY: config.baseY,
    viewBox: { x: config.viewX, y: 0, width: config.viewWidth, height: config.height },
    crown: { x: CENTER_X, y: config.crownY, rx: config.rx, ry: config.ry },
    trunk: { x: CENTER_X, baseY: config.baseY, rootY: config.baseY - 42,
      forkY: config.crownY + config.ry * 0.66, boleWidth: config.boleWidth }
  };
}
export function variation(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967296;
}
function edgePath(parent, child, seed = '') {
  const dx = child.x - parent.x;
  const dy = child.y - parent.y;
  const length = Math.hypot(dx, dy) || 1;
  const normal = { x: -dy / length, y: dx / length };
  const bend = (variation(seed) - .5) * Math.min(42, Math.max(12, length * .22));
  const first = { x: parent.x + dx * .28 + normal.x * bend, y: parent.y + dy * .32 + normal.y * bend };
  const second = { x: child.x - dx * .28 - normal.x * bend * .55, y: child.y - dy * .22 - normal.y * bend * .55 };
  return `M${parent.x.toFixed(2)} ${parent.y.toFixed(2)} C${first.x.toFixed(2)} ${first.y.toFixed(2)}, ${second.x.toFixed(2)} ${second.y.toFixed(2)}, ${child.x.toFixed(2)} ${child.y.toFixed(2)}`;
}

export function layoutTree(inputNodes = []) {
  const valid = Array.isArray(inputNodes) ? inputNodes.filter(node => node && typeof node.id === 'string' && node.id) : [];
  const nodes = [...new Map(valid.map(node => [node.id, node])).values()];
  const empty = { ...treeStage('empty'), nodes: [], root: null, positions: new Map(), parentById: new Map(),
    parentAnchors: new Map(), children: new Map(), edges: [], labels: [], maxDepth: 0 };
  if (!nodes.length) return empty;
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const root = nodes.find(node => depthOf(node) === 0) || nodes[0];
  const parentById = new Map();
  nodes.forEach(node => {
    if (node.id === root.id) return;
    const parent = node.parentId !== node.id && nodeMap.has(node.parentId) ? node.parentId : root.id;
    parentById.set(node.id, parent);
  });
  // Repair only the visual topology; never change the user's historical data.
  const resolved = new Set([root.id]);
  nodes.forEach(node => {
    let id = node.id;
    const path = new Set();
    while (!resolved.has(id)) {
      if (path.has(id)) { parentById.set(id, root.id); break; }
      path.add(id);
      id = parentById.get(id) || root.id;
    }
    path.forEach(id => resolved.add(id));
  });
  const children = new Map();
  parentById.forEach((parent, id) => {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(nodeMap.get(id));
  });
  children.forEach(list => list.sort(nodeOrder));
  const levels = new Map();
  const ordered = [];
  function visit(id, level) {
    levels.set(id, level);
    if (id !== root.id) ordered.push(nodeMap.get(id));
    (children.get(id) || []).forEach(child => visit(child.id, level + 1));
  }
  visit(root.id, 0);
  const maxDepth = Math.max(...levels.values());
  const stage = treeStage(modeFor(nodes, maxDepth));
  const { crown, trunk } = stage;
  const positions = new Map([[root.id, { x: trunk.x, y: trunk.rootY, angle: 0 }]]);
  // Sunflower packing fills a rounded crown even for a single long browsing
  // chain. Depth is data, not a reason to turn the artwork into a vertical pole.
  ordered.forEach((node, index) => {
    const spread = Math.max(3, ordered.length);
    const radius = TREE_LAYOUT.LEAF_SPREAD_MIN + (TREE_LAYOUT.LEAF_SPREAD_MAX - TREE_LAYOUT.LEAF_SPREAD_MIN) * Math.sqrt((index + .5) / spread);
    const angle = -2.32 + index * GOLDEN_ANGLE + (variation(node.id) - .5) * .24;
    const radial = radius * (.92 + variation(`${node.id}:radius`) * .12);
    positions.set(node.id, {
      x: crown.x + Math.cos(angle) * crown.rx * .82 * radial,
      y: crown.y + Math.sin(angle) * crown.ry * .78 * radial,
      angle: Math.cos(angle) * 32
    });
  });
  const parentAnchors = new Map();
  const edges = ordered.map(node => {
    const parentId = parentById.get(node.id);
    const parent = parentId === root.id ? { x: trunk.x, y: trunk.forkY } : positions.get(parentId);
    parentAnchors.set(node.id, parent);
    const depth = levels.get(node.id);
    return { nodeId: node.id, parentId, depth, kind: depth === 1 ? 'primary' : 'secondary',
      width: branchWidth(depth), path: edgePath(parent, positions.get(node.id), node.id) };
  });
  return { ...stage, nodes, root, positions, parentById, parentAnchors, children, edges,
    labels: [labelPlacement(positions.get(root.id), root.id, true)], maxDepth };
}
