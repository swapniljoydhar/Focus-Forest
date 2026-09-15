import assert from 'node:assert/strict';
import { branchWidth, labelPlacement, layoutTree, treeStage } from './dashboard/tree-layout.js';

function node(id, depth, parentId = null, extra = {}) {
  return { id, depth, parentId, title: id, state: 'normal', ...extra };
}
function assertConnected(tree, nodes) {
  assert.equal(tree.edges.length, Math.max(0, nodes.length - 1), 'each non-root page retains its actual parent edge');
  for (const item of nodes) {
    const point = tree.positions.get(item.id);
    assert.ok(point && Number.isFinite(point.x) && Number.isFinite(point.y));
    if (item.id !== tree.root.id) {
      const edge = tree.edges.find(edge => edge.nodeId === item.id);
      assert.equal(edge.parentId, tree.parentById.get(item.id));
      assert.ok(edge.path.includes('C') && edge.width > 0, 'trail edges must be curved and visible when selected');
    }
  }
}
function assertInsideCrown(tree) {
  for (const item of tree.nodes) {
    const point = tree.positions.get(item.id);
    const { x, y, width, height } = tree.viewBox;
    assert.ok(point.x - 29 >= x && point.x + 29 <= x + width, 'hit areas must fit horizontally');
    assert.ok(point.y - 29 >= y && point.y + 29 <= y + height, 'hit areas must fit vertically');
    if (item.id === tree.root.id) continue;
    const dx = (point.x - tree.crown.x) / tree.crown.rx;
    const dy = (point.y - tree.crown.y) / tree.crown.ry;
    assert.ok(dx * dx + dy * dy < .6, 'page leaves must sit inside the rounded foliage, not beyond the canopy');
  }
}

assert.equal(layoutTree().mode, 'empty');
assert.equal(layoutTree(null).root, null);
assert.equal(layoutTree([null, { id: '' }]).nodes.length, 0);
const seed = [node('root', 0)];
const seedTree = layoutTree(seed);
assert.equal(seedTree.mode, 'seed');
assert.equal(seedTree.positions.get('root').x, 450);
assert.ok(seedTree.crown.rx > 100 && seedTree.crown.ry > 100, 'even the first planted tree has a recognizable leafy crown');
assert.ok(seedTree.trunk.boleWidth > 20, 'a young tree has a substantial tapered trunk');
assert.ok(seedTree.trunk.rootY > seedTree.crown.y + seedTree.crown.ry, 'the root is below the foliage');
assertConnected(seedTree, seed);
assertInsideCrown(seedTree);

const sapling = [node('root', 0), node('leaf-a', 1, 'root')];
const saplingTree = layoutTree(sapling);
assert.equal(saplingTree.mode, 'sapling');
assert.ok(saplingTree.crown.rx > seedTree.crown.rx, 'the silhouette fills out as browsing grows');
assertConnected(saplingTree, sapling);
assertInsideCrown(saplingTree);
assert.ok(saplingTree.edges[0].path.startsWith(`M450.00 ${saplingTree.trunk.forkY.toFixed(2)}`), 'root paths begin at the physical trunk fork');
assert.ok(saplingTree.positions.get('leaf-a').y < saplingTree.trunk.rootY);

const canopy = [node('root', 0), node('left', 1, 'root'), node('right', 1, 'root'),
  node('left-deep', 2, 'left'), node('right-deep', 2, 'right'), node('right-tip', 3, 'right-deep')];
const canopyTree = layoutTree(canopy);
assert.equal(canopyTree.mode, 'canopy');
assert.ok(canopyTree.crown.rx > saplingTree.crown.rx);
assertConnected(canopyTree, canopy);
assertInsideCrown(canopyTree);
assert.equal(canopyTree.parentById.get('right-tip'), 'right-deep', 'artistic placement must not fabricate browsing relationships');
assert.equal(canopyTree.edges.filter(edge => edge.depth === 1).every(edge => edge.kind === 'primary'), true);

// A single deep research chain must remain a broad tree, not a vertical pole.
for (const length of [7, 13, 96]) {
  const chain = Array.from({ length }, (_, index) => node(`step-${index}`, index, index ? `step-${index - 1}` : null));
  const tree = layoutTree(chain);
  assertConnected(tree, chain);
  assertInsideCrown(tree);
  const leafX = chain.slice(1).map(item => tree.positions.get(item.id).x);
  assert.ok(Math.max(...leafX) - Math.min(...leafX) > 100, 'long browsing chains should still occupy a leafy crown');
  assert.equal(tree.mode, 'deep');
}
const wide = [node('root', 0), ...Array.from({ length: 95 }, (_, i) => node(`leaf-${i}`, 1, 'root'))];
assertInsideCrown(layoutTree(wide));
assertConnected(layoutTree(wide), wide);
assert.equal(layoutTree(wide).labels.length, 1, 'page titles should not clutter the illustration before selection');

const malformed = [node('root', 0), node('orphan', 4, 'missing'), node('self', 2, 'self')];
const malformedTree = layoutTree(malformed);
assertConnected(malformedTree, malformed);
assert.equal(malformedTree.parentById.get('orphan'), 'root');
assert.equal(malformedTree.parentById.get('self'), 'root');
const cyclic = [node('root', 0), node('a', 1, 'c'), node('b', 2, 'a'), node('c', 3, 'b')];
const original = structuredClone(cyclic);
const cyclicTree = layoutTree(cyclic);
assert.deepEqual(cyclic, original, 'repairs must not mutate historical data');
assertConnected(cyclicTree, cyclic);
for (const item of cyclic) {
  let id = item.id;
  const ancestors = new Set();
  while (id) {
    assert.ok(!ancestors.has(id), 'resolved ancestry must terminate');
    ancestors.add(id);
    id = cyclicTree.parentById.get(id);
  }
  assert.ok(ancestors.has('root'));
}
const duplicates = layoutTree([node('root', 0), node('a', 1, 'root'), node('a', 1, 'root')]);
assert.equal(duplicates.positions.size, 2);
assert.equal(duplicates.edges.length, 1);
const staleDepths = Array.from({ length: 13 }, (_, i) => node(`node-${i}`, 0, i ? `node-${i - 1}` : null));
assert.equal(layoutTree(staleDepths).maxDepth, 12, 'stale metadata must not change the true ancestry');
assert.deepEqual(layoutTree(canopy), layoutTree(canopy), 'all geometry and Maps must be deterministic');
assert.equal(treeStage('invalid').mode, 'sapling');
assert.equal(layoutTree([]).mode, 'empty', 'an empty garden stays an empty stage');
assert.equal(layoutTree([node('root', 0), node('a', 1, 'root')]).mode, 'sapling', 'a small garden stays a sapling');
assert.equal(branchWidth(0), 5, 'roots and shallow branches stay thick');
assert.equal(branchWidth(1), 5);
assert.equal(branchWidth(5), 3.6);
assert.equal(branchWidth(99), 2, 'deep branches never vanish below the minimum width');
const rootLabel = labelPlacement({ x: 450, y: 400 }, 'root', true);
assert.deepEqual(rootLabel, { nodeId: 'root', x: 450, y: 462, anchor: 'middle' });
assert.equal(labelPlacement({ x: 50, y: 100 }, 'leaf').x, 200, 'labels clamp inside the artwork');
assert.equal(labelPlacement({ x: 850, y: 100 }, 'leaf').x, 700);
console.log('storybook tree geometry and graph-preservation tests passed');
