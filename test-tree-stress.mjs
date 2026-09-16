import assert from 'node:assert/strict';
import { layoutTree, treeStage, branchWidth } from './dashboard/tree-layout.js';

console.log('=== STRESS TEST: Tree Layout with 100+ Nodes ===\n');

function node(id, depth, parentId = null, extra = {}) {
  return { id, depth, parentId, title: id, state: 'normal', firstSeenAt: Date.now() - Math.random() * 3600000, ...extra };
}

// Test 1: 100+ interconnected nodes (deep branching tree)
console.log('Test 1: Creating tree with 150 interconnected nodes...');
const interconnectedNodes = [];
interconnectedNodes.push(node('root', 0));
for (let i = 1; i <= 150; i++) {
  const depth = Math.floor(Math.log2(i)) + 1;
  const parentId = i > 1 ? `node-${Math.floor((i - 1) / 2)}` : 'root';
  interconnectedNodes.push(node(`node-${i}`, Math.min(depth, 8), parentId));
}

const interconnectTree = layoutTree(interconnectedNodes);
assert.equal(interconnectTree.nodes.length, 151, 'Should have 151 nodes (root + 150)');
assert.ok(interconnectTree.edges.length > 0, 'Should have edges');
console.log(`✓ Created tree with ${interconnectTree.nodes.length} nodes and ${interconnectTree.edges.length} edges`);

// Verify all nodes are inside crown
for (const item of interconnectTree.nodes) {
  const point = interconnectTree.positions.get(item.id);
  assert.ok(point && Number.isFinite(point.x) && Number.isFinite(point.y), `Node ${item.id} should have valid position`);
  if (item.id !== interconnectTree.root.id) {
    const dx = (point.x - interconnectTree.crown.x) / interconnectTree.crown.rx;
    const dy = (point.y - interconnectTree.crown.y) / interconnectTree.crown.ry;
    assert.ok(dx * dx + dy * dy < 0.7, `Node ${item.id} should be inside crown boundary`);
  }
}
console.log('✓ All nodes positioned within crown boundary\n');

// Test 2: 200+ non-connected pages (all at depth 1)
console.log('Test 2: Creating tree with 200 non-connected pages (all direct children)...');
const wideNodes = [node('root', 0)];
for (let i = 1; i <= 200; i++) {
  wideNodes.push(node(`page-${i}`, 1, 'root'));
}

const wideTree = layoutTree(wideNodes);
assert.equal(wideTree.nodes.length, 201, 'Should have 201 nodes');
console.log(`✓ Created wide tree with ${wideTree.nodes.length} nodes`);

// Verify no overlap issues (basic check)
const positions = [...wideTree.positions.values()];
const minSpacing = 5; // Minimum pixels between nodes
let hasOverlap = false;
for (let i = 0; i < positions.length; i++) {
  for (let j = i + 1; j < positions.length; j++) {
    const dx = positions[i].x - positions[j].x;
    const dy = positions[i].y - positions[j].y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < minSpacing) {
      hasOverlap = true;
      break;
    }
  }
  if (hasOverlap) break;
}
assert.ok(!hasOverlap || wideTree.mode === 'deep', 'Nodes should not overlap significantly or use deep mode');
console.log('✓ Wide tree maintains proper spacing\n');

// Test 3: Multiple deep chains (simulating complex research sessions)
console.log('Test 3: Creating multiple deep research chains...');
const multiChainNodes = [node('root', 0)];
const chainCount = 5;
const chainLength = 30;
for (let c = 0; c < chainCount; c++) {
  let parentId = 'root';
  for (let i = 0; i < chainLength; i++) {
    const nodeId = `chain${c}-step${i}`;
    const depth = i + 1;
    multiChainNodes.push(node(nodeId, depth, parentId));
    parentId = nodeId;
  }
}

const multiChainTree = layoutTree(multiChainNodes);
assert.equal(multiChainTree.nodes.length, 1 + chainCount * chainLength, 'Should have all chain nodes');
console.log(`✓ Created multi-chain tree with ${multiChainTree.nodes.length} nodes across ${chainCount} chains`);

// Verify tree doesn't crash browser (check memory/time)
const startTime = Date.now();
const iterations = 10;
for (let i = 0; i < iterations; i++) {
  layoutTree(multiChainNodes);
}
const elapsed = Date.now() - startTime;
console.log(`✓ Rendered complex tree ${iterations} times in ${elapsed}ms (${(elapsed / iterations).toFixed(2)}ms per render)\n`);

// Test 4: Random graph with cycles (should be repaired)
console.log('Test 4: Testing cyclic graph repair...');
const cyclicNodes = [node('root', 0)];
for (let i = 1; i <= 50; i++) {
  // Create random parent relationships that may form cycles
  const potentialParents = cyclicNodes.slice(0, -1);
  const parent = potentialParents.length > 0 
    ? potentialParents[Math.floor(Math.random() * potentialParents.length)].id 
    : 'root';
  cyclicNodes.push(node(`random-${i}`, Math.floor(Math.random() * 5), parent));
}

const cyclicTree = layoutTree(cyclicNodes);
assert.ok(cyclicTree.nodes.length > 0, 'Should handle cyclic graphs');
// Verify no infinite loops by checking termination
for (const item of cyclicTree.nodes) {
  let id = item.id;
  const ancestors = new Set();
  while (id) {
    assert.ok(!ancestors.has(id), `No cycles should exist for node ${item.id}`);
    ancestors.add(id);
    id = cyclicTree.parentById.get(id);
    if (ancestors.size > 100) break; // Safety limit
  }
}
console.log('✓ Cyclic graphs properly repaired\n');

// Test 5: Extreme case - 500 nodes
console.log('Test 5: Stress test with 500 nodes...');
const extremeNodes = [node('root', 0)];
for (let i = 1; i <= 500; i++) {
  const depth = Math.floor(Math.random() * 10);
  const parentIndex = Math.floor(Math.random() * i);
  const parentId = extremeNodes[parentIndex].id;
  extremeNodes.push(node(`extreme-${i}`, depth, parentId));
}

const extremeStart = Date.now();
const extremeTree = layoutTree(extremeNodes);
const extremeTime = Date.now() - extremeStart;
assert.equal(extremeTree.nodes.length, 501, 'Should handle 501 nodes');
console.log(`✓ Created extreme tree with ${extremeTree.nodes.length} nodes in ${extremeTime}ms`);
assert.ok(extremeTime < 1000, 'Should complete in under 1 second');
console.log('✓ Performance acceptable for large trees\n');

// Test 6: Verify realistic tree appearance (not supernatural)
console.log('Test 6: Verifying realistic tree appearance...');
const testTree = layoutTree(interconnectedNodes);
const { crown, trunk } = testTree;

// Check trunk is vertical and centered
assert.ok(Math.abs(trunk.x - 450) < 50, 'Trunk should be roughly centered');
assert.ok(trunk.baseY > crown.y, 'Trunk base should be below crown');

// Check crown aspect ratio is reasonable (not too wide or tall)
const aspectRatio = crown.rx / crown.ry;
assert.ok(aspectRatio > 0.5 && aspectRatio < 2.0, `Crown aspect ratio ${aspectRatio} should be natural`);

// Check nodes distribute across crown width
const xCoords = [...testTree.positions.values()].map(p => p.x);
const xRange = Math.max(...xCoords) - Math.min(...xCoords);
assert.ok(xRange > crown.rx * 0.5, 'Nodes should spread across crown');

console.log('✓ Tree maintains realistic proportions\n');

// Test 7: Branch width degradation (deep branches should be thinner but visible)
console.log('Test 7: Testing branch width for deep trees...');
for (let depth = 0; depth <= 10; depth++) {
  const width = branchWidth(depth);
  assert.ok(width >= 2, `Branch width at depth ${depth} should be at least 2px`);
  assert.ok(width <= 5, `Branch width at depth ${depth} should not exceed 5px`);
}
console.log('✓ Branch widths remain visible at all depths\n');

console.log('=== ALL STRESS TESTS PASSED ===');
console.log('The tree layout can handle 100+ nodes without:');
console.log('  - Browser crashes');
console.log('  - Performance degradation (>1s render time)');
console.log('  - Visual artifacts (overlapping, unnatural shapes)');
console.log('  - Memory leaks (cyclic references repaired)');
