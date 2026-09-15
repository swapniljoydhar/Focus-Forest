const VIEWBOX_WIDTH = 900;
const CENTER_X = VIEWBOX_WIDTH / 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

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
export function branchWidth(depth) { return Math.max(2, 5 - Math.max(0, depth - 1) * 0.35); }
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
function edgePath(parent, child) {
  const dx = child.x - parent.x;
  const dy = child.y - parent.y;
  const bow = Math.max(12, Math.min(38, Math.abs(dx) * 0.2));
  return `M${parent.x.toFixed(2)} ${parent.y.toFixed(2)} C${(parent.x + dx * .25).toFixed(2)} ${(parent.y + dy * .35 - bow).toFixed(2)}, ${(child.x - dx * .3).toFixed(2)} ${(child.y - dy * .2 + bow).toFixed(2)}, ${child.x.toFixed(2)} ${child.y.toFixed(2)}`;
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
    const radius = .24 + .64 * Math.sqrt((index + .5) / Math.max(3, ordered.length));
    const angle = -2.32 + index * GOLDEN_ANGLE;
    positions.set(node.id, {
      x: crown.x + Math.cos(angle) * crown.rx * .82 * radius,
      y: crown.y + Math.sin(angle) * crown.ry * .78 * radius,
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
      width: branchWidth(depth), path: edgePath(parent, positions.get(node.id)) };
  });
  return { ...stage, nodes, root, positions, parentById, parentAnchors, children, edges,
    labels: [labelPlacement(positions.get(root.id), root.id, true)], maxDepth };
}
