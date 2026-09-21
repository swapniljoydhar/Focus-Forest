# Changelog

All notable Focus Forest changes are documented here.

## [Unreleased]

### Fixed (secondary QA pass over the 2026-09-21 audit fixes)

- **Phantom focus time for repaired imports:** clearing an inverted `endedAt` to `null` (import validation) made `getDashboardStats` treat completed sessions as still running (`endedAt || now`), inflating Total Session Time and the Recent Sessions table by the session's full age (a 90-day-old import showed 7,776,000 s). Completed sessions without a usable `endedAt` now count as zero-length; genuinely active sessions still accrue to the present. The pre-existing future-skew repair path shared the hazard and is covered by the same rule. (`test-audit-fixes.mjs` A11)
- **Self-link reloads lost their trail note:** suppressing the spurious `reload` event for `link`-hint observations also silenced the genuine case — clicking a link to the page the tab already shows. `trackLink` now leaves a short-lived (15 s, commit-verified, per-tab, size-capped) self-link mark that `observeTab` consumes after the browser actually commits, recording exactly one `reload`. Marks never survive tab close, Forget Site, or Clear Data, and new-tab/SPA clicks are never marked. (A10)
- **Storage-sync refreshes ran on hidden tabs:** the new cross-context sync listener now skips background tabs entirely (`document.hidden` gate) — nobody can see the chip there, the `visibilitychange` handler already refreshes on reveal, and busy multi-tab sessions stay well inside the worker's message rate budget. (A12 sentinel)
- **`START_MISSION` could fail on bookkeeping:** `createSession`'s follow-up `recordActiveTab` write shared the user-facing promise chain; a storage hiccup between the session write and the interval write would reject the whole response even though the mission was planted. The bookkeeping failure is now logged and isolated. (A12 sentinel)
- **SPA bridge crashed on frozen History:** pages that freeze or redefine `History` methods made the MAIN-world bridge throw under `'use strict'`. The patch is now guarded; such pages fall back to `webNavigation.onHistoryStateUpdated` and the companion's polling watch. (A12 sentinel)
- README file structure and SPA wording updated for `content/spa-bridge.js`.

### Fixed

- **Critical — storage read failures could wipe the local forest:** `loadState()` resolves to an empty state when `chrome.storage.local.get` transiently fails; any mutation that ran against that fallback then persisted it, silently destroying every stored garden, setting, and compost item. Write paths (the worker mutation queue and quota compaction) now use a new strict `loadStateForWrite()` that aborts the mutation and surfaces `INTERNAL_ERROR` instead; read-only UI consumers keep the gentle empty-state fallback. Covered by `test-audit-fixes.mjs` (A1).
- **"Start a new mission" on the choice card never navigated:** the content script set `window.location.href` to a `chrome-extension://` URL, but Chrome blocks web-origin navigation to extension resources that are not `web_accessible_resources` — a list this extension deliberately keeps empty. The action now ends the mission and asks the worker (an extension context) to navigate the sender tab to the planting page via the new `OPEN_PLANTING_PAGE` message. (A4, A9)
- **Every ordinary link click was double-recorded as a "reload":** after `LINK_CLICK` grew the branch, the follow-up `tabs.onUpdated` observation matched the same URL and stamped a spurious `reload` event — trail noise, wrongly doubled eviction pressure on the 72-event cap, and misleading dashboard notes. Genuine reloads and back/forward returns are still recorded. (A2)
- **`search_refinement` events were mutated into the shared cache but returned `NO_CHANGE`,** so they were never persisted: visible in reads, then lost on a worker restart or smuggled into a later unrelated write. They are now durably saved like every other event. (A3)
- **The companion went stale on idle pages:** missions planted from the popup, ended from the New Tab page, or re-tuned in Settings never reached already-open pages until the next navigation. The content script now watches `chrome.storage.onChanged` (debounced, with a freshness gate so active browsing stays well inside the worker rate limit) and refreshes its view.
- **`history.pushState`/`replaceState` interception was inert in production:** content scripts run in the isolated world, where the patch cannot see page-initiated calls (the Playwright harness imports the module into the main world, so tests passed while production relied solely on the worker's `webNavigation.onHistoryStateUpdated` and the 2.5 s poll). A tiny MAIN-world bridge (`content/spa-bridge.js`, manifest `world: "MAIN"`, `document_start`) now re-announces history writes as a payload-less DOM event the isolated script listens for; the chip updates immediately on SPA route changes. `minimum_chrome_version` raised 110 → 111 for main-world content script support. (A9)
- **Popup footer and New Tab resume button ignored `hidden`:** author rules (`footer{display:flex}`, `.action-btn{display:flex}`) override the UA sheet's `[hidden]{display:none}`, so the popup's "Let this garden rest" footer showed in the empty state and during the completion dialog, and "Continue Session" showed with no active session. Both stylesheets now carry the dashboard's `[hidden]{display:none!important}` guard. (A8)
- **Context-menu re-registration could throw unhandled promise rejections:** MV3 `create()` returns promises and rejects on duplicate ids; the fire-and-forget calls also skipped the remaining menus when the first threw. Registration now removes all menus first and awaits each create inside the existing error boundary. (A5)
- **Popup crashed to its error state on a legal null snapshot** (rate limit / worker restart): `render()` now normalizes null like the dashboard already did; the dashboard's "Forget selected site" got the same null guard.
- **Imports accepted sessions ending before they started:** `endedAt < startedAt` is now cleared during import validation instead of only rejecting absurd five-year-past values. (A6)
- **`isSearchUrl` misread the Brave marketing site as a search engine:** the root-path special case is now scoped to `search.brave.com`, so `www.brave.com/` visits grow normal branches. (A7)
- `dashboard/tree-renderer.js` renders recent-node buds from a dedicated `TREE_LAYOUT.RECENT_NODE_WINDOW_MS` constant instead of borrowing `SERVICE_WORKER.RATE_LIMIT_WINDOW_MS`, decoupling a visual choice from an unrelated messaging limit.
- `shared/state.js` documents which loader is safe for write paths, and `test-audit-fixes.mjs` (wired into `npm test` and `npm run test:audit`) pins every fix above.
- Fixed Forget Site freezing the active session tree when the forgotten host was the mission origin: the origin now resets to the New Tab placeholder and the next ordinary page plants a fresh root instead of overwriting surviving nodes. Sessions already frozen by the old behavior are healed automatically on load.
- Fixed the first-step search fallback for the "Browser default" engine silently routing missions to Google when the Search API is unavailable; the last-resort fallback is now DuckDuckGo, as README privacy notes require.
- Fixed the dashboard never counting or showing choice-sheet dismissals: dismissing via "Keep exploring" or Escape now records an event, surfaced as the "Prompts Declined" stat.
- Fixed tab-close cleanup leaving per-tab navigation hints, SPA dedupe entries, and pending branches in memory until TTL eviction.
- Fixed the origin growth ritual being able to replay when a second depth-0 load arrived mid-animation.
- Fixed the companion chip restoring a saved position that can fall outside the current viewport.
- Fixed the popup depth meter never rendering 0%, and unified "branches" wording between the chip and popup.
- Fixed the dashboard session ordering comparator mixing different rows' timestamps.
- Removed the never-read `interventionsPaused` setting and the fabricated `depth` field on compost entries.

### Security

- Tightened the extension-page Content Security Policy: removed `style-src 'unsafe-inline'` (all dynamic styling is CSSOM-only).

### Improved

- The dashboard's dark/light theme choice is now respected by the popup, settings, and New Tab pages.

## [0.3.6] — 2026-09-18

### Improved

- Made Forest Finds appear as a compact tier-aware discovery reveal with a small one-shot entrance motion, instead of a plain text toast.
- Added distinct but restrained visual treatment for seeds, blooms, and seasonal discoveries while keeping the page usable and unobscured.
- Preserved reduced-motion behavior and the existing offline, cooldown, and per-session reward limits.

## [0.3.5] — 2026-09-18

### Added

- Added a short, rotating reflection prompt to the existing choice card so users can examine a detour without being graded, blocked, or rushed.

### Improved

- Tuned the New Tab atmosphere with slower, more organic mist and sun motion, paint containment for blurred layers, and the existing reduced-motion and hidden-tab pauses intact.
- Kept the intervention bounded to one prompt per observed URL and three offline strings, with no new timers, network calls, or stored data.

## [0.3.4] — 2026-09-17

### Fixed

- Fixed opt-in Forest Finds so reward history survives normalization and reloads while storing only a reward ID and timestamp locally.
- Fixed reward cooldown accounting and awaited reward persistence for composting, mission completion, and returning to the mission root.
- Added non-blocking reward feedback to the companion and New Tab status area without changing the extension’s passive browsing model.
- Fixed storage-pressure compaction so it no longer calls a service-worker-only mutation helper or overwrites a concurrent save.

### Cleanup

- Removed unused tree node and DOM pooling scaffolding that was not connected to the renderer.
- Added regression coverage for bounded reward history, minimal local records, cooldowns, and deterministic catalog selection.

## [0.3.3] — 2026-09-16

### Added

- Added a subtle animated atmospheric background to the New Tab planting page using CSS-only drifting light fields.
- Added reduced-motion handling for both browser preferences and the extension’s **Ambient motion** setting.
- Added a reusable New Tab performance and memory profiler for the built extension package.
- Added CI checks for 50 rapid SPA `history.pushState` transitions, heap growth, long tasks, layout work, style recalculation, and DOM-size regressions.

### Reliability

- Verified that rapid SPA route changes remain distinct and are delivered without runaway memory growth.
- Preserved existing `pushState`, `replaceState`, `popstate`, Back/Forward, and title-only route handling.
- Kept the local-first data model and existing extension behavior unchanged outside the requested visual and verification improvements.

### Verification

- Full unit, service-worker, state, security, stress, and browser suites pass.
- The built extension archive passes ZIP integrity validation.
- `npm audit --omit=optional --audit-level=moderate` reports zero vulnerabilities.
- The extracted package profile reports 103 DOM nodes, no long tasks, zero layout operations during the profile interval, approximately 20 ms of style recalculation over five seconds, and approximately 10 MB JavaScript heap usage in headless Chromium.

## [0.3.2] — 2026-09-15

- Removed the unintended settings sync mirror so session, settings, and compost data remain local-only.
- Corrected browser compatibility documentation.

## [0.3.1] — 2026-09-15

- Fixed recent-bud rendering, title-only SPA updates, rapid History API route snapshots, Back/Forward tracking, and persistent MV3 quota scheduling.

## [0.3.0] — 2026-09-14

- Added browser-default search through Chromium’s Search API, stronger SPA route serialization, richer storybook tree details, site-level pause controls, release CI, and reproducible packaging.
