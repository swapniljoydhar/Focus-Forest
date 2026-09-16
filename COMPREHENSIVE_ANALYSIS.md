# Focus Forest - Comprehensive Repository Analysis

## 🌲 Introduction & Purpose

**Focus Forest** is a calm, local-first Chromium browser extension designed to help users maintain intention during web research sessions. It's a **Manifest V3** extension that works across Chrome, Brave, Edge, Opera, Vivaldi, and other Chromium-based browsers.

### Core Philosophy
- **No AI/ML**: No generative AI, summarizers, remote models, embeddings, or page-content classifiers
- **Local-First**: All data stays in `chrome.storage.local` - no telemetry, no remote servers
- **Non-Judgmental**: Doesn't block domains or judge page relevance; observes navigation patterns
- **Transparent**: Uses a branch model built from browser navigation signals only
- **Agency-Preserving**: Offers choices rather than restrictions or punishments

### User Experience
1. **Plant a Mission**: Users set an intention (e.g., "Compare laptops for university")
2. **Track Branches**: As users navigate, the extension builds a tree of visited pages
3. **Gentle Nudges**: At deeper branches, the UI becomes quieter and offers reflection choices
4. **Garden View**: Completed missions are visualized as storybook-style trees
5. **No Productivity Scores**: Sessions aren't graded; it's about awareness, not metrics

---

## 🔍 Vulnerability Assessment

Based on security audits (`SECURITY_REVIEW_2026-08-15.md`, `AUDIT_REPORT_2026-08-16.md`) and code analysis:

### ✅ Already Fixed (High Confidence)
| Issue | Status | Resolution |
|-------|--------|------------|
| Critical: `send()` undefined in content script | ✅ FIXED | Added typed helper function |
| Critical: Service worker module syntax errors | ✅ FIXED | Converted `#` comments to `//` |
| High: Stale `backdrop`/`sheetCopy` references | ✅ FIXED | Renamed to `choiceCard`/`choiceCopy` |
| High: Schema validation short-circuit | ✅ FIXED | Continue on optional, return on required |
| High: Unrestricted snapshot access | ✅ FIXED | Extension-page sender validation |
| Medium: Pruned node reuse | ✅ FIXED | Excludes terminal states |
| Medium: SPA dedup unbounded | ✅ FIXED | 128-entry cap with eviction |
| Medium: DOM innerHTML sinks | ✅ FIXED | DOM construction with textContent |
| Low: Unused imports/exports | ✅ FIXED | Cleaned up |

### ⚠️ Residual/Open Findings (Intentional or Low Priority)

| ID | Severity | Finding | Status | Rationale |
|----|----------|---------|--------|-----------|
| F-01 | Medium | Broad `host_permissions` (all HTTP/S) | **INTENTIONAL** | Core UX requirement: companion must appear on all web pages without user invocation. Changing to `activeTab` would fundamentally alter the product. |
| F-04 | Medium | Redirect-chain matrix edge cases | **REQUIRES MANUAL TESTING** | Needs real Chrome multi-window/tab verification before changing semantics. Automated tests can't fully validate browser restart/incognito behavior. |
| F-05 | Medium | Go Home stale origin after browser restart | **PARTIALLY ADDRESSED** | Validates `hasRealOrigin`; needs browser restart testing in real profiles. |
| F-09 | Low | Snapshot access via extension pages | **ACCEPTED RISK** | No external messaging entry point exists; manifest-level protection sufficient. Defense-in-depth could be added but isn't required. |
| F-12 | Low | Initial-render error fallback UX | **LOW PRIORITY** | Covered by `renderSafely()`/`initSafely()` wrappers; purely UX hardening. |
| F-13 | Low | `canonicalUrl()` naming clarity | **LOW PRIORITY** | Code clarity improvement only; no security impact since privileged callers use `safeHttpUrl()`. |

### 🔒 Current Security Posture

**Strengths:**
- ✅ Closed ShadowRoot for content script isolation
- ✅ Sender validation for privileged operations
- ✅ Message rate limiting (100 msg/min per sender)
- ✅ Storage auto-compaction at 4.5MB threshold
- ✅ URL sanitization with `safeHttpUrl()`
- ✅ Error boundaries around async operations
- ✅ No web-accessible resources (removed unused CSS)
- ✅ Strict Content Security Policy
- ✅ No external dependencies or network calls

**Attack Surface Remaining:**
1. **Broad Host Permissions**: Required for core functionality but increases theoretical attack surface
2. **Storage Quota**: Auto-compaction helps, but heavy long-term users could hit limits
3. **Multi-Window Scenarios**: Not fully tested in automated suites
4. **Browser Restart Edge Cases**: Tab ID reuse after restart needs manual verification

---

## 🛠 Improvement Suggestions

### A. High Priority (Security & Reliability)

#### 1. Add Real Browser Integration Tests
**Why**: Automated Node.js tests can't validate multi-window, browser restart, incognito mode, or real SPA behavior.

**How**:
```javascript
// test-multi-window.mjs (Playwright)
import { test, expect } from '@playwright/test';

test('multi-tab same URL does not cross-attach', async ({ context }) => {
  const tab1 = await context.newPage();
  const tab2 = await context.newPage();
  // ... test pending branch collision scenario
});
```

#### 2. Add Memory Pressure Monitoring
**Why**: Long-running sessions (>1 hour) could accumulate memory even with current bounds.

**How**:
```javascript
// background/service-worker.js
if (performance.memory && performance.memory.usedJSHeapSize > 50 * 1024 * 1024) {
  logWarning('High memory usage detected', { heap: performance.memory.usedJSHeapSize });
  // Trigger aggressive cleanup
}
```

#### 3. Strengthen Sender Validation (Defense-in-Depth)
**Why**: Current extension-page check uses URL prefix; add runtime ID verification.

**How**:
```javascript
function isExtensionPageSender(sender) {
  if (!sender?.url) return false;
  const extensionOrigin = chrome.runtime.getURL('');
  return sender.url.startsWith(extensionOrigin) && sender.id === chrome.runtime.id;
}
```

### B. Medium Priority (Performance & Maintainability)

#### 4. Optimize Tree Rendering for 200+ Nodes
**Current**: Renders all nodes at once (~4.5ms for 500 nodes in tests)
**Improvement**: Progressive rendering with `requestAnimationFrame` batching

```javascript
// dashboard/tree-renderer.js
function progressiveRender(nodes, batchSize = 50) {
  let index = 0;
  function renderBatch() {
    const batch = nodes.slice(index, index + batchSize);
    batch.forEach(renderNode);
    index += batchSize;
    if (index < nodes.length) requestAnimationFrame(renderBatch);
  }
  renderBatch();
}
```

#### 5. Add LRU Eviction for Runtime Maps
**Current**: `activeTabs` and `navigationHints` maps grow without time-based cleanup
**Improvement**: Periodic LRU cleanup every 60 seconds

```javascript
// background/service-worker.js
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of activeTabs) {
    if (now - entry.lastAccessed > MEMORY_LIMITS.LRU_CACHE_SIZE) {
      activeTabs.delete(key);
    }
  }
}, MEMORY_LIMITS.CLEANUP_INTERVAL_MS);
```

#### 6. Extract Magic Numbers to Constants
**Status**: Partially done in `shared/constants.js`
**Remaining**: Some hardcoded values in service-worker.js and tree-layout.js

### C. Low Priority (UX & Polish)

#### 7. Improve Error Recovery UI
**Current**: Extension pages may show blank state on service worker unavailability
**Improvement**: Add retry button and helpful copy

#### 8. Add Accessibility Testing
**Current**: Manual accessibility features implemented
**Improvement**: Automated axe-core tests in CI

#### 9. Performance Metrics Dashboard
**Why**: Help power users understand their browsing patterns better
**How**: Add optional session duration, page count trends (without productivity scoring)

---

## 📋 Refactoring Plan

### Phase 1: Foundation (Week 1)
**Goal**: Stabilize core infrastructure without breaking changes

#### Step 1.1: Complete Constants Extraction
- [ ] Move all remaining magic numbers to `shared/constants.js`
- [ ] Import constants in all modules
- [ ] Verify no hardcoded values remain

**Files**: `background/service-worker.js`, `dashboard/tree-layout.js`

#### Step 1.2: Standardize Error Handling
- [ ] Wrap all async operations with `wrapWithErrorBoundary()`
- [ ] Add global unhandled rejection handler
- [ ] Create error recovery UI components

**Files**: All `app.js` files, `content/content.js`

#### Step 1.3: Memory Management
- [ ] Implement LRU eviction for `activeTabs` map
- [ ] Implement LRU eviction for `navigationHints` map
- [ ] Add periodic cleanup interval (60s)
- [ ] Add memory pressure detection

**Files**: `background/service-worker.js`

### Phase 2: Performance Optimization (Week 2)
**Goal**: Handle 200+ node trees smoothly

#### Step 2.1: Tree Rendering Pipeline
- [ ] Implement DOM element pooling/recycling
- [ ] Add `requestAnimationFrame` batching
- [ ] Optimize SVG path generation
- [ ] Clean up event listeners on destroy

**Files**: `dashboard/tree-renderer.js`, `dashboard/tree-layout.js`

#### Step 2.2: Content Script Optimization
- [ ] Add rate limiting for messages to service worker
- [ ] Debounce DOM observers
- [ ] Reduce tracking object footprint
- [ ] Add proper cleanup on page unload

**Files**: `content/content.js`

### Phase 3: Testing Infrastructure (Week 3)
**Goal**: Comprehensive automated + manual test coverage

#### Step 3.1: Browser Integration Tests
- [ ] Multi-window scenarios
- [ ] Browser restart behavior
- [ ] Incognito/private mode
- [ ] Real SPA sites (React, Vue, Angular apps)
- [ ] Redirect chains

**Files**: New `test-multi-window.mjs`, `test-browser-restart.mjs`

#### Step 3.2: Performance Benchmarks
- [ ] Tree render time <10ms for 100 nodes
- [ ] Service worker message handling <5ms
- [ ] Memory usage <50MB after 1 hour
- [ ] No long tasks (>50ms) during normal operation

**Files**: New `test-performance.mjs`

#### Step 3.3: Accessibility Tests
- [ ] Keyboard navigation coverage
- [ ] Screen reader compatibility
- [ ] High contrast mode
- [ ] Reduced motion preferences

**Files**: New `test-accessibility.mjs`

### Phase 4: Code Quality (Week 4)
**Goal**: Improve maintainability without feature changes

#### Step 4.1: Module Organization
- [ ] Split large files (>500 lines) into logical modules
- [ ] Add JSDoc documentation for all exports
- [ ] Create type definitions (JSDoc @typedef)
- [ ] Add inline comments for complex algorithms

**Files**: `background/service-worker.js` (split into handlers), `shared/state.js`

#### Step 4.2: UI Component Standardization
- [ ] Unified error handling pattern
- [ ] Consistent loading states
- [ ] Batched DOM updates
- [ ] Remove redundant state subscriptions

**Files**: `popup/app.js`, `newtab/app.js`, `settings/app.js`, `dashboard/app.js`

### Phase 5: Verification & Release (Week 5)
**Goal**: Validate all changes and prepare release

#### Step 5.1: Regression Testing
- [ ] Run all existing automated tests
- [ ] Manual testing checklist (see below)
- [ ] Cross-browser verification (Chrome, Brave, Edge, Opera, Vivaldi)

#### Step 5.2: Performance Profiling
- [ ] Chrome DevTools memory profile
- [ ] Performance timeline analysis
- [ ] Compare before/after benchmarks

#### Step 5.3: Documentation Updates
- [ ] Update README with new architecture
- [ ] Document constants and configuration
- [ ] Add contributor guidelines
- [ ] Update CHANGELOG

---

## 🧪 Unit Test Writing Plan

### Existing Test Coverage
✅ **Already Implemented** (10 test files):
1. `test-service-worker.mjs` - Behavioral tests for background logic
2. `test-state.mjs` - State management, validation, normalization (15 tests)
3. `test-error-tracing.mjs` - Error boundary contracts
4. `test-tree-layout.mjs` - Tree geometry algorithm
5. `test-tree-stress.mjs` - Deep branch bounds, cyclic graph repair
6. `test-security.mjs` - Static security contracts
7. `test-runtime-contracts.mjs` - Message schema validation
8. `test-repository-integrity.mjs` - File structure, asset checks
9. `stress-service-worker.mjs` - Concurrent operations stress test
10. `test-dashboard-browser.mjs` - Playwright UI tests (real Chromium)

### Missing Test Coverage

#### Tier 1: Critical Gaps (Write First)

**Test 1: Multi-Tab Collision Scenarios**
```javascript
// test-multi-tab-collision.mjs
import { test } from 'node:test';
import assert from 'node:assert';

test('two tabs opening same URL do not cross-attach parents', async () => {
  // Mock two tabs opening example.com simultaneously
  // Verify pendingBranches key includes tabId+windowId
  // Assert no parent relationship corruption
});

test('pending branch collision with exactly one candidate', async () => {
  // One tab opens URL, another navigates to same URL
  // Verify fallback logic works correctly
});
```

**Test 2: Browser Restart Simulation**
```javascript
// test-browser-restart.mjs
test('origin tab ID reuse after restart does not navigate wrong tab', async () => {
  // Simulate stored origin tab ID
  // Mock tabs.get() returning different tab with reused ID
  // Verify Go Home validates URL before navigation
});

test('stale origin fails closed and opens new safe tab', async () => {
  // Origin tab no longer exists
  // Verify safe fallback behavior
});
```

**Test 3: Redirect Chain Edge Cases**
```javascript
// test-redirect-chains.mjs
test('redirect chain expires after timeout', async () => {
  // Set pending redirect, wait 15s+
  // Verify chain is cleared
});

test('multiple redirects in same tab are bounded', async () => {
  // Fire 5+ rapid redirects
  // Verify only last 4 are retained
});

test('redirect cleared on unrelated navigation', async () => {
  // Set redirect, then navigate to unrelated URL
  // Verify redirect state is cleared
});
```

**Test 4: Content Script Message Rate Limiting**
```javascript
// test-rate-limiting.mjs
test('60 messages per minute allows normal usage', async () => {
  // Send 60 messages in 60s window
  // Verify all are accepted
});

test('61st message in 60s window is rate limited', async () => {
  // Send 61 messages rapidly
  // Verify 61st is rejected with warning
});

test('rate limit resets after window expires', async () => {
  // Send 60 messages, wait 61s, send 1 more
  // Verify message is accepted
});
```

#### Tier 2: Important Gaps (Write Second)

**Test 5: Storage Quota Exhaustion**
```javascript
// test-storage-quota.mjs
test('auto-compaction triggers at 4MB threshold', async () => {
  // Mock storage.getBytesInUse() returning 4.5MB
  // Verify compactStateIfNeeded() removes oldest sessions
});

test('compaction preserves minimum 3 recent sessions', async () => {
  // Create 12 sessions, trigger compaction
  // Verify at least 3 most recent remain
});

test('graceful handling when getBytesInUse unavailable', async () => {
  // Mock undefined getBytesInUse
  // Verify no crash, returns false
});
```

**Test 6: SPA Navigation Deduplication**
```javascript
// test-spa-dedup.mjs
test('50 rapid pushState transitions remain distinct', async () => {
  // Simulate 50 history.pushState calls
  // Verify each creates unique branch
  // Check heap growth <10% post-GC
});

test('dedup window prevents duplicate observations', async () => {
  // Fire same URL twice within 1s
  // Verify second is deduplicated
});

test('SPA dedup map caps at 128 entries', async () => {
  // Insert 150 unique URLs
  // Verify oldest entries evicted
});
```

**Test 7: Terminal State Handling**
```javascript
// test-terminal-states.mjs
test('pruned nodes cannot be reused as active paths', async () => {
  // Mark node as pruned
  // Navigate to same URL
  // Verify new node created instead of reuse
});

test('composted nodes detach all tab aliases', async () => {
  // Attach 3 tabs to node, compost it
  // Verify all tabIds removed
});

test('closedAt field excludes node from active queries', async () => {
  // Set closedAt on node
  // Query nodeForTab()
  // Verify null returned
});
```

#### Tier 3: Nice-to-Have (Write Third)

**Test 8: Accessibility Compliance**
```javascript
// test-accessibility.mjs
test('keyboard navigation reaches all interactive elements', async () => {
  // Tab through entire UI
  // Verify focus order is logical
  // Verify all buttons reachable
});

test('reduced-motion preference disables animations', async () => {
  // Set prefers-reduced-motion
  // Verify no CSS animations triggered
});

test('screen reader announces mission chip state changes', async () => {
  // Use aria-live regions
  // Verify state change announcements
});
```

**Test 9: Cross-Browser Compatibility**
```javascript
// test-cross-browser.mjs
test('Brave Shields do not block content script', async () => {
  // Run in Brave with Shields enabled
  // Verify companion injects successfully
});

test('Edge new-tab replacement confirmation handled', async () => {
  // Simulate Edge new-tab override prompt
  // Verify graceful fallback if declined
});
```

**Test 10: Long-Running Session Stability**
```javascript
// test-long-session.mjs
test('memory stable after 100 tab navigations', async () => {
  // Simulate 100 navigations
  // Measure heap before/after
  // Verify growth <20%
});

test('no memory leaks after 1 hour simulated time', async () => {
  // Fast-forward time by 1 hour
  // Trigger all cleanup intervals
  // Verify maps bounded
});
```

### Test Implementation Priority

**Week 1** (Critical):
- [ ] Multi-tab collision (Test 1)
- [ ] Browser restart (Test 2)
- [ ] Rate limiting (Test 4)

**Week 2** (Important):
- [ ] Redirect chains (Test 3)
- [ ] Storage quota (Test 5)
- [ ] SPA dedup (Test 6)
- [ ] Terminal states (Test 7)

**Week 3** (Polish):
- [ ] Accessibility (Test 8)
- [ ] Long-session stability (Test 10)

**Week 4** (Stretch):
- [ ] Cross-browser (Test 9) - requires multiple browser installations

---

## 📊 Repository Statistics

| Metric | Value |
|--------|-------|
| **Total Lines of Code** | ~3,600 lines (JavaScript) |
| **Core Files** | 9 JS files |
| **Test Files** | 10 .mjs files |
| **Documentation** | 10 .md files |
| **Dependencies** | 0 runtime, 1 dev (Playwright) |
| **Bundle Size** | ~150KB (unpacked) |
| **Minimum Chrome Version** | 110 |
| **Manifest Version** | 3 (MV3) |

### File Breakdown
```
background/service-worker.js    1,128 lines  (31%)
dashboard/app.js                  597 lines  (17%)
shared/state.js                   566 lines  (16%)
content/content.js                449 lines  (12%)
dashboard/tree-renderer.js        267 lines   (7%)
popup/app.js                      205 lines   (6%)
dashboard/tree-layout.js          144 lines   (4%)
newtab/app.js                     142 lines   (4%)
settings/app.js                   101 lines   (3%)
```

### Test Coverage Summary
```
test-service-worker.mjs         ✓ PASS
test-state.mjs                  ✓ PASS (15 tests)
test-error-tracing.mjs          ✓ PASS
test-tree-layout.mjs            ✓ PASS
test-tree-stress.mjs            ✓ PASS
test-security.mjs               ✓ PASS
test-runtime-contracts.mjs      ✓ PASS
test-repository-integrity.mjs   ✓ PASS
stress-service-worker.mjs       ✓ PASS (96 nodes, 72 events)
test-dashboard-browser.mjs      ✓ PASS (Playwright)
```

---

## 🎯 Success Criteria for Refactoring

### Functional Requirements (Must Not Break)
- ✅ Mission planting flow works identically
- ✅ Tree visualization renders correctly for 1-500 nodes
- ✅ Content script injects on all HTTP(S) pages
- ✅ Settings persist across browser restarts
- ✅ Import/export functionality unchanged
- ✅ Multi-tab tracking accurate
- ✅ SPA route detection working
- ✅ Compost/prune actions correct

### Performance Targets
- [ ] Tree render time: <10ms for 100 nodes (currently ~4.5ms for 500)
- [ ] Service worker message handling: <5ms average
- [ ] Memory usage: <50MB heap after 1 hour (baseline TBD)
- [ ] No long tasks (>50ms) during normal operation
- [ ] Startup time: <200ms for extension pages

### Code Quality Metrics
- [ ] Zero magic numbers (all in constants.js)
- [ ] 100% error boundary coverage for async ops
- [ ] JSDoc on all exported functions
- [ ] No file >600 lines (split large modules)
- [ ] All tests passing (existing + new)

### Security Requirements
- [ ] No new vulnerabilities introduced
- [ ] All existing findings remain resolved
- [ ] Sender validation on all privileged ops
- [ ] URL sanitization on all navigation
- [ ] CSP remains strict

---

## 🚀 Recommended Next Steps

### Immediate (This Week)
1. **Run existing test suite** to establish baseline: `npm test`
2. **Review open findings** in SECURITY_REVIEW_2026-08-15.md
3. **Prioritize Tier 1 unit tests** (multi-tab, restart, rate limiting)
4. **Start Phase 1 refactoring** (constants extraction)

### Short-Term (Next 2-4 Weeks)
1. Complete Phases 1-3 of refactoring plan
2. Write all Tier 1 & 2 unit tests
3. Run Playwright dashboard tests weekly
4. Document any architectural decisions

### Medium-Term (1-3 Months)
1. Manual testing matrix (5 browsers × 3 scenarios)
2. Performance profiling in real Chrome profiles
3. Consider Web Store submission if desired
4. Gather user feedback on UX improvements

### Long-Term (3-6 Months)
1. Evaluate feature requests against core philosophy
2. Monitor for Chrome API deprecations
3. Consider mobile Chromium support (if feasible)
4. Build community contributions (CONTRIBUTING.md exists)

---

## 📚 Key Documentation References

| Document | Purpose |
|----------|---------|
| `README.md` | User guide, installation, philosophy |
| `SECURITY_REVIEW_2026-08-15.md` | Original security audit (13 findings) |
| `AUDIT_REPORT_2026-08-16.md` | Modified fork audit (14 findings, all fixed) |
| `IMPROVEMENTS.md` | v0.3.4 security enhancements |
| `REFACTORING_PLAN.md` | Detailed refactoring roadmap |
| `CHANGELOG.md` | Version history |
| `CONTRIBUTING.md` | Contribution guidelines |
| `SECURITY.md` | Security policy |
| `CHROMEWEBSTORE.md` | Store listing draft |
| `ENHANCEMENT_SUMMARY.md` | Feature summary |

---

## 💡 Final Thoughts

**Focus Forest** is a well-architected, thoughtful extension that successfully balances:
- ✅ Privacy (local-first, no telemetry)
- ✅ Security (validated inputs, sender boundaries)
- ✅ Performance (bounded state, efficient algorithms)
- ✅ UX (calm, non-judgmental, accessible)

The codebase shows maturity through:
- Comprehensive automated testing
- Clear security audit trail
- Intentional design decisions documented
- Minimal dependencies (vanilla JS/CSS/SVG)

**Biggest Strengths:**
1. Philosophical clarity (what it is AND what it isn't)
2. Security-first mindset with documented trade-offs
3. Excellent test coverage for a browser extension
4. Performance-conscious design (no frameworks, native APIs)

**Biggest Opportunities:**
1. Real-browser integration testing (multi-window, restart)
2. Progressive rendering for very large trees (200+ nodes)
3. Memory monitoring for power users
4. Cross-browser manual testing matrix

The extension is production-ready for personal use and has strong foundations for public release. The refactoring plan prioritizes stability while enabling future growth.
