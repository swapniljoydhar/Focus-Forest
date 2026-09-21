import { layoutTree, treeStage, labelPlacement, variation } from './tree-layout.js';
import { TREE_LAYOUT } from '../shared/constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
// Leaves first seen within this window get a one-shot sprout entrance when
// the garden live-refreshes, so a branch visibly "arrives" instead of popping
// in. Own visualization constant (same discipline as RECENT_NODE_WINDOW_MS).
const SPROUT_WINDOW_MS = 2600;

// Hand-drawn, softly scalloped silhouettes. Kept as vector paths so the crown
// stays crisp at every size and doesn't depend on the shape of a browsing graph.
const CROWN = 'M-.91 .21 C-1.09 .06 -1.02 -.23 -.82 -.29 C-.92 -.54 -.69 -.79 -.46 -.70 C-.39 -1.01 -.08 -1.08 .10 -.86 C.29 -1.03 .60 -.89 .63 -.66 C.90 -.73 1.08 -.43 .88 -.22 C1.09 -.06 1.02 .27 .82 .37 C.90 .62 .63 .79 .43 .67 C.23 .91 -.02 .86 -.18 .71 C-.42 .90 -.77 .72 -.73 .49 C-.97 .59 -1.09 .35 -.91 .21 Z';
// Organic leaf shapes with varied curvature for more natural branching appearance
const PAGE_LEAF = 'M0 17 C-20 9 -22 -9 -11 -23 C7 -24 24 -7 14 8 C10 14 4 16 0 17 Z';
// Alternative leaf variant for visual diversity in dense branches
const PAGE_LEAF_ALT = 'M0 16 C-18 8 -20 -8 -9 -21 C6 -22 22 -6 13 9 C9 14 3 15 0 16 Z';
// Bud shape for new/recent nodes
const PAGE_BUD = 'M0 12 C-8 6 -8 -4 0 -10 C8 -4 8 6 0 12 Z';

function element(tag, attributes = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text != null) node.textContent = text;
  return node;
}
function path(className, d, attributes = {}) { return element('path', { class: className, d, ...attributes }); }
function group(className, attributes = {}) { return element('g', { class: className, ...attributes }); }
function cloud(className, x, y, rx, ry) {
  return path(className, CROWN, { transform: `translate(${x} ${y}) scale(${rx} ${ry})`, 'vector-effect': 'non-scaling-stroke' });
}
function addDefinitions(svg, prefix) {
  const defs = element('defs');
  const gradient = element('linearGradient', { id: `${prefix}-bark`, x1: '0%', x2: '100%', y1: '0%', y2: '20%' });
  gradient.append(element('stop', { offset: '0', 'stop-color': '#d3a269' }),
    element('stop', { offset: '.45', 'stop-color': '#bb874f' }), element('stop', { offset: '1', 'stop-color': '#a46c40' }));
  defs.append(gradient);
  svg.append(defs);
}
function limb(start, end, width, tip, bend) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length, ny = dx / length;
  const c1 = { x: start.x + dx * .26 + bend, y: start.y + dy * .45 };
  const c2 = { x: end.x - dx * .25, y: end.y - dy * .18 };
  return `M${start.x + nx * width} ${start.y + ny * width} C${c1.x + nx * width} ${c1.y + ny * width} ${c2.x + nx * tip} ${c2.y + ny * tip} ${end.x + nx * tip} ${end.y + ny * tip} Q${end.x} ${end.y - tip} ${end.x - nx * tip} ${end.y - ny * tip} C${c2.x - nx * tip} ${c2.y - ny * tip} ${c1.x - nx * width} ${c1.y - ny * width} ${start.x - nx * width} ${start.y - ny * width} Z`;
}
function ground(tree) {
  const { x } = tree.trunk, y = tree.baseY;
  const radius = tree.mode === 'empty' ? 133 : tree.crown.rx * .57 + 40;
  const layer = group('forest-ground', { 'aria-hidden': 'true' });
  layer.append(element('ellipse', { class: 'ground-halo', cx: x, cy: y + 13, rx: radius + 27, ry: 25 }),
    element('ellipse', { class: 'ground-island', cx: x, cy: y + 6, rx: radius, ry: 16 }),
    element('ellipse', { class: 'ground-shadow', cx: x + 8, cy: y + 4, rx: tree.trunk.boleWidth + 25, ry: 8 }));
  for (const [offset, flip] of [[-radius * .61, 1], [radius * .7, -1]]) {
    const grass = group('grass-tuft', { transform: `translate(${x + offset} ${y + 3}) scale(${flip} 1)` });
    grass.append(path('grass-blade', 'M0 0 C-14 -1 -19 -11 -18 -20 C-9 -18 -3 -9 0 0 Z'),
      path('grass-blade light', 'M0 0 C0 -13 5 -23 13 -25 C16 -14 10 -4 0 0 Z'));
    layer.append(grass);
  }
  const flower = group('ground-flower', { transform: `translate(${x + radius * .4} ${y - 2})` });
  flower.append(path('flower-stem', 'M0 2 Q-3 -11 1 -18'));
  for (const [cx, cy] of [[0, -22], [6, -18], [4, -12], [-4, -12], [-6, -18]]) {
    flower.append(element('ellipse', { class: 'flower-petal', cx, cy, rx: 4.5, ry: 5 }));
  }
  flower.append(element('circle', { class: 'flower-center', cx: 0, cy: -17, r: 3.5 }));
  layer.append(flower);
  return layer;
}
function canopyBack(tree) {
  const { x, y, rx, ry } = tree.crown;
  const layer = group('canopy-back', { 'aria-hidden': 'true' });
  layer.append(cloud('canopy-shadow', x + 4, y + 13, rx, ry), cloud('canopy-silhouette', x, y, rx, ry));
  return layer;
}
function woodyStructure(tree, prefix) {
  const { crown: c, trunk: t } = tree;
  const x = t.x, y = t.baseY, f = t.forkY, w = t.boleWidth * .65;
  const layer = group('tree-structure', { 'aria-hidden': 'true', fill: `url(#${prefix}-bark)` });
  const leftTip = { x: x - c.rx * .61, y: c.y + c.ry * .03 };
  const rightTip = { x: x + c.rx * .59, y: c.y - c.ry * .08 };
  layer.append(path('wood-limb', limb({ x: x - 3, y: f + 53 }, leftTip, w * .51, 5, -12)),
    path('wood-limb', limb({ x, y: f + 37 }, rightTip, w * .48, 5, 11)));
  const twigs = [
    [leftTip, { x: leftTip.x - c.rx * .18, y: leftTip.y - c.ry * .34 }, -1],
    [leftTip, { x: leftTip.x + c.rx * .06, y: leftTip.y - c.ry * .29 }, 1],
    [rightTip, { x: rightTip.x + c.rx * .17, y: rightTip.y - c.ry * .31 }, 1],
    [rightTip, { x: rightTip.x - c.rx * .07, y: rightTip.y - c.ry * .26 }, -1]
  ];
  twigs.forEach(([start, end, side]) => {
    layer.append(path('branch-twig', `M${start.x} ${start.y} Q${(start.x + end.x) / 2 + side * 10} ${(start.y + end.y) / 2 - 8} ${end.x} ${end.y}`),
      element('circle', { class: 'branch-bud', cx: end.x, cy: end.y, r: Math.max(3, w * .12) }));
  });
  const bole = `M${x - w * 1.27} ${y} C${x - w * .57} ${y - 31} ${x - w * .60} ${f + 44} ${x - w * .68} ${f} C${x - w * .87} ${f - 32} ${x - w * .68} ${c.y + 29} ${x - w * .37} ${c.y + 9} Q${x + w * .22} ${c.y - 2} ${x + w * .26} ${c.y + 30} C${x + w * .40} ${f + 32} ${x + w * .51} ${y - 30} ${x + w * 1.30} ${y} Q${x + w * .8} ${y + 8} ${x + 8} ${y - 2} Q${x - w * .57} ${y + 8} ${x - w * 1.27} ${y} Z`;
  layer.append(path('tree-bole', bole),
    path('bark-light', `M${x - w * .3} ${y - 21} C${x - w * .12} ${y - 54} ${x - w * .28} ${f + 28} ${x - w * .37} ${f + 4}`),
    path('bark-line', `M${x + w * .4} ${y - 28} Q${x + w * .1} ${y - 60} ${x + w * .23} ${y - 84}`),
    path('bark-line fine', `M${x - w * .58} ${y - 9} Q${x - w * .4} ${y - 22} ${x - w * .46} ${y - 35}`));
  return layer;
}
function canopyFront(tree) {
  const { x, y, rx, ry } = tree.crown;
  const layer = group('canopy-front', { 'aria-hidden': 'true' });
  // Large overlapping foliage masses, not a fringe of tiny graph-tip leaves.
  layer.append(cloud('foliage-puff left', x - rx * .49, y - ry * .10, rx * .48, ry * .62),
    cloud('foliage-puff right', x + rx * .49, y - ry * .06, rx * .46, ry * .60),
    cloud('foliage-puff top', x - rx * .06, y - ry * .48, rx * .53, ry * .49),
    cloud('foliage-puff middle', x - rx * .025, y + ry * .025, rx * .29, ry * .33),
    cloud('foliage-puff lower-left', x - rx * .57, y + ry * .28, rx * .33, ry * .32),
    cloud('foliage-puff lower-right', x + rx * .59, y + ry * .31, rx * .29, ry * .31));
  const glints = group('canopy-glints', { transform: `translate(${x} ${y}) scale(${rx} ${ry})` });
  glints.append(path('canopy-shine', 'M-.40 -.70 C-.33 -.86 -.12 -.94 .04 -.78 C-.10 -.84 -.27 -.81 -.40 -.70 Z'),
    path('canopy-shine', 'M-.82 -.25 C-.89 -.37 -.75 -.57 -.61 -.51 C-.74 -.49 -.78 -.39 -.82 -.25 Z'),
    path('canopy-shine', 'M.44 -.44 C.57 -.58 .77 -.44 .78 -.28 C.69 -.42 .57 -.45 .44 -.44 Z'));
  layer.append(glints);
  const marks = [[-.68, -.05, -30], [-.42, -.44, 26], [.11, -.61, -15], [.50, -.18, 35], [.66, .22, -25], [-.50, .36, 18], [.23, .40, 32], [-.03, .17, -26]];
  for (const [dx, dy, angle] of marks) {
    const mark = group('foliage-detail', { transform: `translate(${x + rx * dx} ${y + ry * dy}) rotate(${angle})` });
    mark.append(path('foliage-dash', 'M-9 0 Q-4 -7 0 0 M2 1 Q7 -6 12 1'));
    layer.append(mark);
  }
  return layer;
}
function emptySprout(tree) {
  const { x } = tree.trunk, y = tree.baseY;
  const layer = group('empty-garden', { 'aria-hidden': 'true' });
  layer.append(path('empty-trunk', `M${x} ${y} C${x - 8} ${y - 45} ${x + 10} ${y - 76} ${x - 1} ${y - 117}`),
    path('sprout-leaf left', `M${x} ${y - 71} C${x - 41} ${y - 59} ${x - 92} ${y - 89} ${x - 88} ${y - 131} C${x - 46} ${y - 143} ${x - 3} ${y - 121} ${x} ${y - 71} Z`),
    path('sprout-leaf right', `M${x + 2} ${y - 96} C${x - 2} ${y - 147} ${x + 39} ${y - 167} ${x + 81} ${y - 153} C${x + 86} ${y - 109} ${x + 41} ${y - 84} ${x + 2} ${y - 96} Z`),
    path('sprout-vein', `M${x - 4} ${y - 79} Q${x - 37} ${y - 107} ${x - 63} ${y - 119} M${x + 5} ${y - 104} Q${x + 35} ${y - 133} ${x + 61} ${y - 141}`));
  return layer;
}
function drawScene(svg, tree, prefix) {
  const { viewBox } = tree;
  svg.classList.add('forest-scene');
  svg.dataset.treeMode = tree.mode;
  svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
  svg.style.setProperty('--forest-aspect', `${viewBox.width} / ${viewBox.height}`);
  addDefinitions(svg, prefix);
  const art = group('forest-art');
  art.append(ground(tree));
  if (tree.mode === 'empty') art.append(emptySprout(tree));
  else art.append(canopyBack(tree), woodyStructure(tree, prefix), canopyFront(tree));
  svg.append(art);
}
function pageMark(node, point, root, count, selected, describeNode, classForNode, onTrail = false) {
  // The sprout entrance is one-shot and class-driven; the CSS animates only
  // opacity and the leaf path's own transform (never the group's translate
  // attribute), so positioning cannot be disturbed.
  const sprouting = !root && Number.isFinite(node.firstSeenAt) && Date.now() - node.firstSeenAt < SPROUT_WINDOW_MS;
  const mark = group(`node ${classForNode(node)}${root ? ' mission-root' : ''}${selected ? ' selected' : ''}${onTrail ? ' on-trail' : ''}${sprouting ? ' sprouting' : ''}`, {
    tabindex: 0, role: 'button', 'aria-pressed': String(selected), 'aria-label': describeNode(node),
    'data-node-id': node.id, transform: `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`
  });
  mark.append(element('title', {}, describeNode(node)), element('circle', { class: 'node-hit-target', r: count > 35 ? 20 : 29 }));
  if (root) {
    mark.append(element('circle', { class: 'root-knot', r: 16 }),
      path('root-glyph', 'M0 7 L0 -2 M0 1 C-10 0 -11 -8 -9 -10 C-2 -10 1 -5 0 1 M0 -2 C8 -3 11 -9 9 -11 C3 -11 0 -7 0 -2'));
  } else {
    // Vary leaf shapes organically based on node position for natural diversity
    const leafIndex = node.id.charCodeAt(node.id.length - 1) % 3;
    const leafShape = leafIndex === 0 ? PAGE_LEAF : (leafIndex === 1 ? PAGE_LEAF_ALT : PAGE_LEAF);
    const createdAt = Number.isFinite(node.firstSeenAt) ? node.firstSeenAt : 0;
    // Own visualization constant: this previously borrowed
    // SERVICE_WORKER.RATE_LIMIT_WINDOW_MS, silently tying leaf rendering to an
    // unrelated messaging limit.
    const isRecent = createdAt > 0 && Date.now() - createdAt < TREE_LAYOUT.RECENT_NODE_WINDOW_MS; // Last 60 seconds
    const scale = count > 35 ? .69 : .90;
    const finalScale = isRecent ? scale * 0.85 : scale; // Slightly smaller for buds
    
    const leaf = group('page-leaf-group', { transform: `rotate(${point.angle.toFixed(2)}) scale(${finalScale})` });
    
    if (isRecent) {
      // Render as a bud for very recent nodes
      leaf.append(path('page-bud leaf-shape', PAGE_BUD), 
                  path('page-bud-vein', 'M0 8 Q-1 -2 -4 -8 M0 5 L3 -2 M0 5 L-3 -2'));
    } else {
      // Render as full leaf with varied shape
      leaf.append(path('page-leaf leaf-shape', leafShape), 
                  path('page-leaf-vein', 'M0 13 Q-2 -1 -7 -17 M-1 3 L8 -3 M-3 -5 L-12 -10'));
    }
    mark.append(leaf);
  }
  return mark;
}

export function renderGardenTree(svg, session, { selectedNodeId = null, describeNode = node => node.title || node.id,
  classForNode = () => 'healthy', shortLabel = node => node.title || node.id } = {}) {
  const tree = layoutTree(session?.nodes);
  const selected = tree.nodes.find(node => node.id === selectedNodeId);
  const prefix = `${svg.id || 'forest'}-art`;
  svg.replaceChildren();
  svg.dataset.selected = String(Boolean(selected));
  svg.append(element('title', {}, session ? `The growing tree of ${session.mission}` : 'A little sprout waiting for an intention'),
    element('desc', {}, 'A rounded cartoon tree. Each marked leaf is a browsing page; selecting it traces its path back to the mission root.'));
  drawScene(svg, tree, prefix);
  // Mature gardens get a few slow pollen motes above the crown — ambient
  // life, aria-hidden, paused by every motion kill-switch like the rest of
  // the scene. Garden only: the New Tab illustration stays pristine.
  if (tree.mode === 'canopy' || tree.mode === 'deep') {
    const pollen = group('pollen', { 'aria-hidden': 'true' });
    const { x: cx, y: cy, rx, ry } = tree.crown;
    [[-.34, -.66], [.42, -.52], [.06, -.9]].forEach(([dx, dy], i) => {
      const jitter = (variation(`pollen:${tree.mode}:${i}`) - .5) * 16;
      pollen.append(element('circle', { cx: (cx + rx * dx + jitter).toFixed(1), cy: (cy + ry * dy).toFixed(1), r: (2.3 + i * 0.5).toFixed(1) }));
    });
    svg.append(pollen);
  }
  // Ancestry of the selection, computed once: it drives the highlight layer
  // (unchanged contract), the on-trail classes for focus dimming, and stays
  // consistent with the hover preview in app.js.
  const trailIds = new Set();
  if (selected) {
    let id = selected.id;
    while (id && !trailIds.has(id)) { trailIds.add(id); id = tree.parentById.get(id); }
  }
  const branches = group('branch-layer', { 'aria-hidden': 'true' });
  // Apply dynamic classes based on depth and position for organic branching appearance
  tree.edges.forEach(edge => {
    const node = tree.nodes.find(n => n.id === edge.nodeId);
    const depth = node ? node.depth : 0;
    const isDeep = depth > 3;
    const isRootPath = depth <= 2 && edge.kind === 'primary';
    const kindClass = edge.kind || '';
    const depthClass = isDeep ? ' deep' : (isRootPath ? ' root-path' : '');
    const trailClass = trailIds.has(edge.nodeId) ? ' on-trail' : '';
    const edgePath = path(`branch-taper ${kindClass}${depthClass}${trailClass}`, edge.path);
    // data-edge-for lets the dashboard paint a soft hover preview of a
    // leaf's ancestry without touching the selection highlight layer.
    edgePath.dataset.edgeFor = edge.nodeId;
    branches.append(edgePath);
  });
  svg.append(branches);
  if (selected) {
    const ancestry = trailIds;
    const highlights = group('highlight-layer', { 'aria-hidden': 'true' });
    for (const edge of tree.edges) {
      if (ancestry.has(edge.nodeId)) highlights.append(path(`branch-taper ${edge.kind} highlight`, edge.path));
    }
    // Connect the visible root knot to the branch fork as part of the trail.
    if (selected.id !== tree.root.id) highlights.prepend(path('root-trail', `M${tree.trunk.x} ${tree.trunk.rootY} Q${tree.trunk.x - 9} ${tree.trunk.forkY + 28} ${tree.trunk.x} ${tree.trunk.forkY}`));
    svg.append(highlights);
  }
  const marks = group('mark-layer');
  tree.nodes.forEach(node => marks.append(pageMark(node, tree.positions.get(node.id), node.id === tree.root.id,
    tree.nodes.length, node.id === selectedNodeId, describeNode, classForNode, trailIds.has(node.id))));
  svg.append(marks);
  if (selected && selected.id !== tree.root.id) {
    const label = labelPlacement(tree.positions.get(selected.id));
    const text = shortLabel(selected);
    const width = Math.min(244, Math.max(96, text.length * 6.6 + 26));
    const badge = group('selection-label', { 'aria-hidden': 'true', transform: `translate(${label.x} ${label.y})` });
    badge.append(element('rect', { x: -width / 2, y: -14, width, height: 27, rx: 13.5 }),
      element('text', { class: 'node-label', 'text-anchor': 'middle', y: 4 }, text));
    svg.append(badge);
  }
  if (tree.root) svg.append(element('text', { class: 'root-caption', x: tree.trunk.x, y: tree.baseY + 55, 'text-anchor': 'middle' }, 'ROOTED IN YOUR INTENTION'));
  return tree;
}

// The New Tab uses the same illustration, without invented browsing nodes or
// hidden focusable buttons inside its decorative, aria-hidden artwork.
export function renderTreeIllustration(svg, mode = 'sapling') {
  svg.replaceChildren();
  drawScene(svg, treeStage(mode), `${svg.id || 'forest-preview'}-art`);
}
