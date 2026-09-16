# Focus Forest Refactoring Plan

## Executive Summary
This plan outlines a comprehensive refactoring of the Focus Forest extension to improve:
- **RAM Efficiency**: Reduce memory footprint without sacrificing functionality
- **Code Quality**: Standardize patterns, remove magic numbers, improve consistency
- **Performance**: Optimize tree rendering for 100+ nodes
- **Maintainability**: Better organization, documentation, and error handling

**CRITICAL CONSTRAINT**: No functionality will be removed. All existing features must work exactly as before.

---

## Phase 1: Code Inspection & Analysis

### Files Inspected (Total: ~3,700 lines)

#### Core Files:
1. **manifest.json** (72 lines) - ✓ Permissions fixed (windows added), CSP cleaned
2. **background/service-worker.js** (1,103 lines) - Main background logic
3. **shared/state.js** (566 lines) - State management & validation
4. **shared/error-tracing.js** (187 lines) - Error handling utilities
5. **shared/chromium-api.js** (5 lines) - Browser API shim
6. **content/content.js** (449 lines) - Content script for page monitoring

#### UI Components:
7. **dashboard/app.js** (597 lines) - Dashboard main logic
8. **dashboard/tree-layout.js** (113 lines) - Tree positioning algorithm
9. **dashboard/tree-renderer.js** (229 lines) - SVG tree rendering
10. **dashboard/tree.css** - Tree visualization styles
11. **dashboard/style.css** - Dashboard styles
12. **dashboard/index.html** - Dashboard page

13. **popup/app.js** (205 lines) - Popup UI logic
14. **popup/style.css** - Popup styles
15. **popup/index.html** - Popup page

16. **newtab/app.js** (142 lines) - New tab override page
17. **newtab/style.css** - New tab styles
18. **newtab/index.html** - New tab page

19. **settings/app.js** (101 lines) - Settings page logic
20. **settings/style.css** - Settings styles
21. **settings/index.html** - Settings page

---

## Phase 2: Identified Issues & Refactoring Strategy

### A. Memory Optimization Opportunities

#### 1. Service Worker Memory Leaks (service-worker.js)
**Issue**: Global Maps grow unbounded in long-running sessions
- `pendingBranches` - Limited to 64 entries ✓ (already bounded)
- `spaDedup` - Limited to 128 entries ✓ (already bounded)
- `activeTabs` - Unbounded growth risk
- `navigationHints` - Unbounded growth risk
- `messageCounts` - Uses absolute timestamps ✓ (already fixed)

**Fix**: Add LRU eviction with time-based cleanup for activeTabs and navigationHints

#### 2. State Storage Bloat (state.js)
**Issue**: Sessions array can grow large over time
- Current limit: 12 sessions × 96 nodes = 1,152 nodes max
- Each node has ~15 properties
- Events: 12 sessions × 72 events = 864 events max

**Status**: Already properly bounded ✓

#### 3. Tree Rendering Memory (tree-renderer.js)
**Issue**: SVG DOM nodes not cleaned up on re-render
- Each node creates multiple SVG elements (circle, branch, text)
- 100+ nodes = 300+ DOM elements
- Old elements may persist if cleanup fails

**Fix**: Implement proper DOM recycling pool

### B. Magic Numbers Extraction

#### Found Magic Numbers:
```javascript
// service-worker.js
MAX_PENDING_BRANCHES = 64        // Should be constant
MAX_SPA_DEDUP = 128              // Should be constant
MAX_MESSAGES_PER_MINUTE = 60     // Should be constant
RATE_LIMIT_WINDOW_MS = 60000     // Should be constant
15000                           // Pending branch timeout (×3 occurrences)
1500                            // SPA dedup window
1000                            // SPA observation window
128                             // Active intervals limit
4                               // Pending redirects limit

// state.js
LIMITS object already defined ✓
SCHEMA_VERSION = 4 ✓
STORAGE_QUOTA_WARNING_THRESHOLD = 4MB ✓
STORAGE_QUOTA_CRITICAL_THRESHOLD = 7MB ✓
REWARD_LIMITS object already defined ✓

// tree-layout.js
Golden Angle constant used ✓
Ellipse aspect ratios hardcoded
Node spacing constants

// tree-renderer.js
Branch widths: 2px, 3px, 4px, 5px
Node radius: 8px, 12px
Colors hardcoded in CSS ✓
```

### C. Error Handling Inconsistencies

#### Patterns Found:
1. **Good**: `wrapWithErrorBoundary()` used in most places ✓
2. **Good**: `wrapMutationWithErrorBoundary()` for state mutations ✓
3. **Inconsistent**: Some async operations lack try-catch
4. **Missing**: No global error handler for unhandled promise rejections

### D. Tree Layout Stress Testing Results

From previous stress tests:
- ✓ 150 interconnected nodes: PASS (~1.2ms render time)
- ✓ 200 non-connected pages: PASS (~1.8ms render time)
- ✓ 500 nodes extreme case: PASS (~4.5ms render time)
- ✓ Cyclic graph repair: PASS
- ✓ Realistic proportions: PASS (aspect ratio 0.5-2.0)

**Status**: Tree layout is already optimized ✓

---

## Phase 3: Refactoring Actions

### Module 1: Shared Utilities (Priority: HIGH)

#### File: shared/constants.js (NEW)
Extract all magic numbers into named constants:
```javascript
export const SERVICE_WORKER_LIMITS = {
  MAX_PENDING_BRANCHES: 64,
  MAX_SPA_DEDUP: 128,
  MAX_MESSAGES_PER_MINUTE: 60,
  RATE_LIMIT_WINDOW_MS: 60000,
  PENDING_BRANCH_TIMEOUT_MS: 15000,
  SPA_DEDUP_WINDOW_MS: 1500,
  SPA_OBSERVATION_WINDOW_MS: 1000,
  MAX_ACTIVE_INTERVALS: 128,
  MAX_PENDING_REDIRECTS: 4
};

export const TREE_LAYOUT = {
  GOLDEN_ANGLE: 2.399963229728653,
  ELLIPSE_ASPECT_RATIO_MIN: 0.5,
  ELLIPSE_ASPECT_RATIO_MAX: 2.0,
  NODE_SPACING_BASE: 12,
  BRANCH_WIDTH_BY_DEPTH: [5, 4, 3, 2],
  NODE_RADIUS_SMALL: 8,
  NODE_RADIUS_LARGE: 12
};

export const MEMORY_LIMITS = {
  MAX_ACTIVE_TABS_TRACKING: 256,
  MAX_NAVIGATION_HINTS: 128,
  LRU_CLEANUP_INTERVAL_MS: 60000,
  MAX_DOM_ELEMENTS_POOL: 500
};
```

#### File: shared/state.js
Changes:
1. Import constants from shared/constants.js
2. Add deep validation for importAllData() ✓ (already done)
3. Add timestamp range validation ✓ (already done)
4. Optimize normalizeState() for large datasets
5. Add memory pressure detection

### Module 2: Service Worker (Priority: HIGH)

#### File: background/service-worker.js
Changes:
1. Import constants from shared/constants.js
2. Replace all magic numbers with constants
3. Add LRU eviction for activeTabs Map
4. Add LRU eviction for navigationHints Map
5. Add periodic cleanup interval (every 60s)
6. Standardize error handling with wrapWithErrorBoundary
7. Add memory usage monitoring
8. Optimize mutate() queue for better performance

### Module 3: Tree Rendering (Priority: MEDIUM)

#### File: dashboard/tree-renderer.js
Changes:
1. Import constants from shared/constants.js
2. Implement DOM element pooling/recycling
3. Add requestAnimationFrame batching
4. Optimize SVG path generation
5. Add progressive rendering for 100+ nodes
6. Clean up event listeners on destroy

#### File: dashboard/tree-layout.js
Changes:
1. Import constants from shared/constants.js
2. Optimize sunflower packing algorithm
3. Add early exit for single-node trees
4. Cache computed positions when possible

### Module 4: Content Script (Priority: MEDIUM)

#### File: content/content.js
Changes:
1. Add rate limiting for messages to service worker
2. Optimize DOM observers (debounce mutations)
3. Reduce memory footprint of tracking objects
4. Add proper cleanup on page unload

### Module 5: UI Components (Priority: LOW)

#### Files: popup/app.js, newtab/app.js, settings/app.js, dashboard/app.js
Changes:
1. Standardize error handling patterns
2. Add loading states for async operations
3. Optimize DOM updates (batch changes)
4. Remove redundant state subscriptions

### Module 6: Manifest & Configuration (Priority: LOW)

#### File: manifest.json
Status: Already fixed ✓
- windows permission added
- CSP cleaned (require-trusted-types-for removed)

---

## Phase 4: Testing Strategy

### Automated Tests (Already Exist) ✓
- test-security.mjs
- test-state.mjs
- test-tree-layout.mjs
- test-tree-stress.mjs
- test-service-worker.mjs
- test-error-tracing.mjs
- test-runtime-contracts.mjs
- test-repository-integrity.mjs

### Manual Testing Checklist
- [ ] Start/end mission flow
- [ ] Tree visualization with 1, 10, 50, 100, 200 nodes
- [ ] Import/export functionality
- [ ] Settings persistence
- [ ] Popup interactions
- [ ] New tab override
- [ ] Content script detection
- [ ] Multi-tab scenarios
- [ ] Long-running session (1+ hour)
- [ ] Memory profile after 100 tab navigations

### Performance Benchmarks
Target metrics:
- Tree render time: <10ms for 100 nodes
- Service worker message handling: <5ms
- Memory usage: <50MB heap after 1 hour
- No long tasks (>50ms) during normal operation

---

## Phase 5: Implementation Order

1. **Step 1**: Create shared/constants.js
2. **Step 2**: Update shared/state.js to use constants
3. **Step 3**: Refactor background/service-worker.js
4. **Step 4**: Optimize dashboard/tree-renderer.js
5. **Step 5**: Improve dashboard/tree-layout.js
6. **Step 6**: Update content/content.js
7. **Step 7**: Refactor UI components (popup, newtab, settings, dashboard)
8. **Step 8**: Run all automated tests
9. **Step 9**: Manual testing
10. **Step 10**: Performance profiling

---

## Risk Mitigation

### Potential Risks:
1. **Breaking Changes**: Mitigated by keeping all functionality intact
2. **Performance Regression**: Mitigated by benchmarking before/after
3. **Memory Leaks**: Mitigated by adding monitoring and cleanup
4. **Browser Compatibility**: Mitigated by testing on Chrome, Brave, Edge

### Rollback Plan:
- Git commits at each major step
- Ability to revert individual modules
- Feature flags for experimental optimizations

---

## Success Criteria

✅ All existing tests pass
✅ No functionality removed or changed
✅ Memory usage reduced by 20%+
✅ Tree rendering handles 200+ nodes smoothly
✅ Zero crashes in stress testing
✅ Works on all Chromium browsers (Chrome, Brave, Edge, Opera, Vivaldi)
✅ Code quality improved (fewer magic numbers, consistent patterns)

---

## Estimated Effort

- Phase 1 (Inspection): Complete ✓
- Phase 2 (Analysis): Complete ✓
- Phase 3 (Implementation): ~4-6 hours
- Phase 4 (Testing): ~2-3 hours
- Phase 5 (Verification): ~1 hour

**Total**: ~7-10 hours

