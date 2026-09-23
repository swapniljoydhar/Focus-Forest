# Focus Forest — Architecture & Engineering Notes

The engineering deep dive, moved out of the README on 2026-09-22 so the README can stay user-first. Everything here describes the code as of that date; user-facing behavior lives in [README.md](README.md), release history in [CHANGELOG.md](CHANGELOG.md).

## File structure

```text
focus-forest/
├── manifest.json              MV3 manifest (permissions, content scripts, CSP)
├── background/
│   └── service-worker.js      Message router, branch model, mutation queue
├── content/
│   ├── content.js             Companion chip + choice card (closed shadow DOM)
│   └── spa-bridge.js          MAIN-world history.pushState/replaceState hook
├── shared/
│   ├── state.js               Schema, validation, persistence, rewards, drift/health
│   ├── constants.js           Limits and layout constants
│   ├── error-tracing.js       ErrorTrace + root-cause diagnosis
│   ├── theme.js               Dark/light preference for extension pages
│   ├── ram-guard.js           Performance guardian: signals, hysteresis, apply
│   └── chromium-api.js        browser.* -> chrome.* alias shim
├── dashboard/
│   ├── index.html             Garden dashboard page
│   ├── app.js                 Garden map + insights tab
│   ├── tree-layout.js         Sunflower packing, golden-angle placement
│   ├── tree-renderer.js       SVG storybook tree renderer
│   ├── style.css              Dashboard page styles
│   └── tree.css               Botanical layer styles
├── newtab/                    Planting page (chrome_url_overrides.newtab)
├── popup/                     Toolbar popup (depth meter, completion ritual)
├── settings/                  Options page (thresholds, motion, exclusions, guardian)
├── icons/                     16 / 32 / 48 / 128 px icons
└── scripts/
    ├── package.mjs            Build: dist/focus-forest.zip
    ├── profile-newtab.mjs     Performance and memory gate (CI)
    └── preview-trees.mjs      Local SVG artwork preview server
```

Key entry points: [`manifest.json`](manifest.json) · [`background/service-worker.js`](background/service-worker.js) · [`content/content.js`](content/content.js) · [`content/spa-bridge.js`](content/spa-bridge.js) · [`shared/state.js`](shared/state.js) · [`shared/constants.js`](shared/constants.js) · [`shared/error-tracing.js`](shared/error-tracing.js) · [`shared/theme.js`](shared/theme.js) · [`shared/ram-guard.js`](shared/ram-guard.js) · [`shared/chromium-api.js`](shared/chromium-api.js) · [`dashboard/index.html`](dashboard/index.html) · [`dashboard/tree-layout.js`](dashboard/tree-layout.js) · [`dashboard/tree-renderer.js`](dashboard/tree-renderer.js) · [`newtab/index.html`](newtab/index.html) · [`popup/index.html`](popup/index.html) · [`settings/index.html`](settings/index.html) · [`scripts/package.mjs`](scripts/package.mjs)

## Navigation semantics

The origin is the first ordinary webpage after a mission is planted. A link activated in a tracked page creates one branch level. A new tab opened from a tracked page waits until the destination loads, then attaches exactly once using the opener relationship or a short-lived pending-link relationship. Unrelated tabs remain outside the tree.

Manually entered URLs, bookmarks, and other unlinked navigations are recorded as neutral external paths when they occur inside a tracked tab; they do not automatically become deeper distractions. Single-page application route changes are observed through both the History API hooks and `webNavigation`, serialized before the companion refreshes, and deduplicated so one `pushState` or `replaceState` route creates at most one branch. Returning to a known URL reuses its existing node instead of creating artificial depth. Browsers cannot expose every semantic relationship, so the extension records confidence internally and remains intentionally humble about what it knows.

Title-only mutations (playback progress in `<title>`, timers, live dashboards) are coalesced in the content script: a same-URL title change triggers at most one message pair per 5 seconds, trailing edge included, so the final title always lands without spending the tab's rate budget (pinned by Gate 7 of `test-extension-load.mjs`).

## Chromium integration notes

- Chromium browsers share the Chrome extension format. The `chrome.*` API namespace, `chrome-extension://` sender URLs, and `chrome_url_overrides` manifest key are intentional; they should not be renamed to `brave.*`, `edge.*`, or `opera.*`. Edge and Opera may also expose `browser.*`; Focus Forest uses `chrome.*` and falls back to `browser.*` when needed (`shared/chromium-api.js`, side-effect-imported by `state.js` and `error-tracing.js`).
- New-tab placeholders are recognized across Chromium flavors, including `chrome://newtab`, `chrome://new-tab-page`, `brave://newtab`, `edge://newtab`, `opera://startpage`, and `vivaldi://newtab` (`shared/state.js`). The first ordinary web page becomes the mission root.
- The companion runs on HTTP(S) websites, not `chrome://settings`, `brave://extensions`, `edge://settings`, or other protected browser pages.
- Planting from the Focus Forest New Tab saves the mission first, then navigates that same browser tab to the browser's configured default search provider, unless a local provider override is selected in Settings.
- No Google account, telemetry, or vendor-specific service APIs are used: there is no `chrome.gcm`, `chrome.instanceID`, `identity.getAuthToken`, or `sidePanel` integration. The optional `chrome.search` call only hands the user's mission to the browser's already configured default search provider; it does not access Google services or change browser settings. On the rare browser where the Search API is missing or fails, the first-step search falls back to a DuckDuckGo results page rather than silently assuming any specific provider. There is no `update_url` override to port.
- Settings, session history, and compost items remain in `chrome.storage.local`; Focus Forest does not mirror browsing-related data to `chrome.storage.sync` or an external service.
- **Known limitations, per fork:**
  - **Chrome** — reference configuration; no known deviations.
  - **Brave** — may require an explicit confirmation before the new-tab override takes effect. Shields can stay on and should not be disabled as an install step. `chrome.search.query` availability is feature-detected and falls back to a DuckDuckGo results URL.
  - **Microsoft Edge** — may require confirming the new-tab override. Edge can expose `browser.*` alongside `chrome.*`; the shim aliases one to the other.
  - **Opera** — ships Speed Dial as its start page (`opera://startpage`) and may require confirming the override.
  - **Vivaldi** — start page is `chrome://vivaldi-webui/startpage`, recognized separately in `shared/state.js`; the override may require confirming.
  - **All forks** — `minimum_chrome_version: 111` is enforced by Chrome/Chromium only. The `world: "MAIN"` content script (`content/spa-bridge.js`) needs Chromium 111+, and on a fork shipping an older engine that entry may be dropped silently. The extension degrades gracefully (the service worker's `webNavigation` listener plus a visibility-gated poll still track SPA routes), at the cost of slightly slower companion updates.
  - **All forks** — `chrome.system.memory` (guardian signal 1) is documented for extensions from Chrome 91+ and pinned empirically by Gate 0 of `test-extension-load.mjs`; where absent, the guardian falls back to device-class and own-heap signals.
  - **All forks** — automated coverage runs in Chromium only. A manual installed-extension walkthrough on each fork is still required before store submission; this project does not claim per-fork certification.

## Permissions

The extension uses local storage for gardens and the `tabs` permission to replace Chromium new-tab pages, associate mission tabs, and navigate the planting tab to its first search step. The `search` permission is used only when **Browser default** is selected, sending the mission through Chromium's existing default provider without changing that setting. The `system.memory` permission is used solely by the optional Performance guardian to read free system memory locally for calibration; the value is never stored, never transmitted, and the guardian degrades gracefully to device-class and own-heap signals where the API is absent. It uses declared HTTP(S) page access to render the mission chip and detect eligible link activations, plus `webNavigation` and a minimal main-world SPA bridge (`content/spa-bridge.js`, which requires Chrome 111+) to support SPA route tracking on ordinary HTTP(S) sites. Browser-internal, restricted, and other protected pages may not support the content script and degrade gracefully. Per-permission store justification lives in [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md).

For single-page applications, Focus Forest observes `history.pushState`, `history.replaceState`, `popstate`, and Chromium's `webNavigation.onHistoryStateUpdated`. Each URL/title snapshot is captured when the route event occurs, so rapid chapter or product changes remain distinct branches. Browser Back and Forward navigation reports the route restored by the History API, while the page itself continues updating without a full reload. This preserves the SPA's bookmarkable and shareable URLs without treating the application as a new document on every route.

## Accessibility and agency

The mission chip, choice sheet, and garden-care dialog use semantic controls, visible focus states, keyboard navigation, Escape handling, focus restoration when an overlay closes, readable text alternatives, and reduced-motion support. The companion follows the browser's light/dark preference automatically (`prefers-color-scheme`) so the chip never glares on a dark page. The choice sheet is deliberately **non-modal** (`aria-modal="false"`) and shown as a corner card, so it never traps focus or hides page content; whenever it or the chip is hidden, focus is returned to the page control the user was on rather than being stranded on `<body>`. The companion is deliberately compact, habitat-themed, and positioned at the upper-right so it avoids common site branding and navigation areas; it adapts to narrow viewports without becoming a page overlay. When a deeper branch is first observed, a tiny trunk-and-leaf mark grows inside the unchanged chip, flickers briefly, and then settles into the ordinary notification copy. This bounded ritual is skipped under reduced-motion preferences and under the Performance guardian, and never blocks the page. Its mission, branch state, and Pause/Resume action have separate hierarchy, deterministic state styling, and an accessible group label. The garden uses a shape-and-text legend rather than color alone, and destructive-looking actions use a calm local dialog instead of a browser-native prompt. Dashboard controls are separated into garden selection and local-data care groups. The extension does not close unrelated tabs. Recovery actions are phrased as choices, not warnings or punishments — including under Strict mode, where a `test-security.mjs` pin guarantees the "Keep exploring" choice exists in every mode.

## Living garden and branch care

The garden dashboard uses a **storybook-style cartoon tree** with a rounded, layered canopy, a warm tapered trunk, curved limbs, and a small planted patch of grass. It grows through `seed`, `sapling`, `canopy`, and `deep` illustrations. Even a single long research chain keeps a recognizable tree silhouette instead of becoming a tall graph connector. Empty gardens show a two-leaf sprout. Completed gardens use a quieter, resting palette.

The foliage is decorative; **each outlined leaf marker represents a real browsing page**, and the knot in the trunk represents the mission root. Select a leaf to illuminate its actual ancestor chain, or use **Explore a page** to reach small or crowded markers. Page titles appear on selection rather than covering the canopy. The selected-path panel still provides depth, relationship confidence, parent context, and care actions. **Prune this path** and **Return to compost** preserve the historical trail. Leaf positions fill the illustrated crown; their height is not a depth or productivity score.

The illustration uses native SVG DOM construction, local CSS, and deterministic geometry—no images, Canvas, rendering library, or animation loop. Parent validation and cycle repair affect only the visual topology and never rewrite stored history. The New Tab shares the decorative tree artwork without inventing browsing nodes, and the small companion uses a matching inline cartoon icon built without an HTML sink. Keyboard selection, visible focus states, and reduced-motion preferences are preserved.

**Garden health** is a three-step visual verdict — *lush*, *steady*, or *sparse* — derived only from existing local branch data (`gardenHealth()` in `shared/state.js`: the ratio of pages at or beyond the quiet line; gardens of two pages or fewer are never judged). It is a CSS treatment on the same deterministic geometry (`data-health` on the scene: saturation, canopy glints, leaf opacity), never a number and never a layout change. Faithful completions earn rarer seasonal Forest Finds (`low_drift_completion`), and the dashboard's existing tending streak carries positive-only milestone lines at 3/7/14/30 days — the worker emits milestone *keys*; the dashboard owns the wording. In Strict mode the saved list additionally states how many curiosities have been resting for over a week (`agedSavedCount`, age-based only — no revisit claim is made because none is tracked).

## History and tab behavior

Returning to a known URL reuses its canonical garden node. If Chrome opens a duplicate tab on a known path, Focus Forest attaches the new tab as an alias instead of creating a deeper branch. Closing one alias does not erase the path while another attached tab remains. Go Home activates the validated origin without closing tracked or unrelated tabs; both the message and the `return-to-mission` command (`Alt+M`) share one validated flow (`goHome()`), and windowless contexts never turn a graceful "could not return" into an error envelope. Composting also preserves the current page; it changes only the local branch state.

The garden dashboard provides **Forget this garden** for removing one selected local session, alongside the explicit delete-all action (which also clears the theme preference — no setting outlives a data wipe).

## Tending controls and completion ritual

Open **Tend the forest** from the popup or your browser's extension details to choose when the page grows quieter and when the choice sheet appears. The extension enforces a one-branch gap between those moments. Ambient motion can be turned off, and every setting stays local.

**Strict mode** is a copy-and-accent layer, not a behavior change: chip state strings firm up at and beyond the quiet line ("You keep going deeper", "The mission is still waiting"), the choice card adds drift accounting — pages and minutes from the mission, computed by `driftStats()` from existing nodes — and, when a private note exists, quotes the *fact* of the note back without ever transmitting its text (the view carries only `{pages, seconds}` and a `hasNote` boolean, unit-pinned). Gentle-mode strings are byte-identical with Strict off (pinned by e2e F4).

The **Performance guardian** (`shared/ram-guard.js`, mirrored inline in the classic content script) calms decorations under memory pressure: signal 1 is real free system memory (`chrome.system.memory.getInfo()`, worker-cached with a ≤30 s TTL refreshed from the active-view path and the existing 5-minute maintenance alarm — zero new timers — relayed via `activeView.systemMemory`); signal 2 is `navigator.deviceMemory`; signal 3 is the context's own `performance.memory` heap ratio (the same per-renderer value memory-monitor extensions obtain via per-tab script injection, read for free because the companion already lives in the page's renderer). Sensitivity 1–5 maps to per-signal thresholds; release hysteresis (`nextPerfMode`, heap band 0.05 / system band 0.03) prevents flapping; `body[data-perf="reduced"]` / `.perf-reduced` kill ambient layers, fireflies, rituals, reveals, and living-garden animation while tracking, chip, and choice card always keep working. Settings renders the live signals it sees.

Ending a mission opens a small reflection moment with only deterministic facts: pages grown, deepest branch, saved curiosities, and — when nonzero — pages and minutes spent beyond the quiet line. The user can let the garden rest, keep tending, or return to the garden view. No session is graded.

Redirect-like URLs are treated as structural transport when they immediately lead to a final destination. They do not add an extra branch level. Search pages reached directly remain neutral; links clicked from them are ordinary branches.

## Low-memory design

The runtime is dependency-free and uses native HTML, CSS, and SVG. Page scripts receive only a compact active-view object rather than the full garden history. The service worker caches normalized state in memory to reduce storage round-trips, avoids storage writes for no-op observations, caps sessions, branches, events, compost, aliases, and pending relationship records, canonicalizes URLs, and injects only once into top-level HTTP(S) documents. Ambient visuals are CSS/SVG layers rather than images, video, Canvas loops, or external fonts: the planting scene's time-of-day tint is computed once per load (static, zero animation cost), the six dusk/night fireflies are transform/opacity-only (7 DOM nodes; the profiler gate holds the New Tab page under 160 DOM nodes, 32 MiB heap, 100 ms long tasks), and title-only SPA mutations are coalesced to at most one message pair per five seconds. The Performance guardian (above) drops every decoration under memory pressure while core tracking continues.

## Security and reliability

The service worker validates sender identity, treats runtime messages and content-script payloads as untrusted inputs, and rejects malformed message shapes against a schema whitelist. It validates sender-tab metadata and HTTP(S) URLs, ignores synthetic page-dispatched clicks, serializes storage mutations, bounds pending relationships and SPA deduplication, clears redirect state when tabs are removed, keys target-blank relationships by source tab plus destination, detaches all tab aliases when a path is composted, excludes pruned/composted paths from active reuse, and revalidates the stored origin tab before Go Home. If the tab ID was reused or the origin moved to another window, it focuses only the validated origin window; otherwise it opens a safe new origin tab without closing anything. Windowless contexts (headless startup races) are probed via `windows.getLastFocused()` before any welcome-tab or return-tab creation. The companion renders inside a closed `ShadowRoot` and uses DOM-safe construction for all companion markup and dynamic content; no companion stylesheet is exposed as a web-accessible resource. Content scripts receive only the compact active view, while full garden snapshots, settings writes, session deletion, pruning, compost deletion, and clear-data operations require an extension-page sender. The companion host element uses `pointer-events: none` so the page behind it (text, links, scroll) stays fully interactive; only the chip and the choice card opt back in with `pointer-events: auto`. The chip is draggable via a pointer-events handle. Its position is remembered for the current site only: the value is held in extension-private session storage (`chrome.storage.session`) managed by the service worker, keyed by the validated sender tab and origin, so it resets when you move to a different site, is cleared when the tab or the browser session ends, and is never readable by the host page. Saves are validated, serialized, and bounded; keyboard auto-repeat rides a short trailing debounce, a `pagehide` flush covers navigating inside the debounce window, and single-shot retries cover rate-limited saves and restores. On forks without `storage.session` the position degrades to worker memory rather than falling back to page storage. The choice prompt appears as a non-blocking corner card rather than a full-screen modal, so it never hides page content. Dashboard data-bearing lists and detail controls use DOM construction, while popup, New Tab, and dashboard startup failures show local recovery copy instead of remaining blank.

For the original security review, see [`SECURITY_REVIEW_2026-08-15.md`](SECURITY_REVIEW_2026-08-15.md) and [`SECURITY.md`](SECURITY.md). For the modified-fork audit and repair record, see [`AUDIT_REPORT_2026-08-16.md`](AUDIT_REPORT_2026-08-16.md).

Automated checks cover ES-module syntax validation, error-boundary rejection contracts, runtime and message contracts, state normalization and storage-failure behaviour, deterministic tree geometry, sender-boundary and prototype-message checks, service-worker behaviour, bounded stress, repository-integrity and local-asset checks, no-loop/no-network runtime boundaries, no-continuous-animation CSS checks, performance-guardian decision matrices, and no-AI references. The test harnesses are [`test-error-tracing.mjs`](test-error-tracing.mjs), [`test-runtime-contracts.mjs`](test-runtime-contracts.mjs), [`test-state.mjs`](test-state.mjs), [`test-tree-layout.mjs`](test-tree-layout.mjs), [`test-security.mjs`](test-security.mjs), [`test-service-worker.mjs`](test-service-worker.mjs), [`stress-service-worker.mjs`](stress-service-worker.mjs), [`test-repository-integrity.mjs`](test-repository-integrity.mjs), [`test-preview.mjs`](test-preview.mjs), [`test-regression-fixes.mjs`](test-regression-fixes.mjs), [`test-audit-fixes.mjs`](test-audit-fixes.mjs), [`test-worker-inputs.mjs`](test-worker-inputs.mjs), [`test-ram-guard.mjs`](test-ram-guard.mjs), [`test-dashboard-browser.mjs`](test-dashboard-browser.mjs) (`npm run test:dashboard`), [`test-extension-load.mjs`](test-extension-load.mjs) (`npm run test:extension`, 11 gates), and [`test-features-e2e.mjs`](test-features-e2e.mjs) (`npm run test:features`). Real-browser testing is still required for page-specific rendering, restricted origins, redirects, SPA behaviour, multiple windows, keyboard focus, popup sizing, and browser/profile differences.

## Release engineering

The source intentionally remains dependency-light and loadable without a build step. The service worker is the source of truth; content scripts render page UI and report navigation signals; New Tab, popup, and dashboard are separate extension pages. The depth-aware redesign was informed by comparison with [History Tree](https://github.com/initialshl/history-tree), [Galaxy Tab History Graph](https://github.com/Katee/galaxy-tab-history-graph), and [Focus Pilot](https://github.com/Nahid-mahmud555/focus-pilot-pro-official), but no code or dependency was imported.

Packaging needs no build step for the source itself — the archive is the raw `manifest.json`, `background/`, `content/`, `dashboard/`, `icons/`, `newtab/`, `popup/`, `settings/` and `shared/` directories. The archiver is capability-probed rather than assumed: PowerShell on Windows, otherwise `zip`, otherwise `python3 -m zipfile`. Install any one of those if the script reports that no archiver is usable. Upload `dist/focus-forest.zip` to the Chrome Web Store, or keep loading the folder unpacked for development.

The dashboard suite uses Chromium to check first-load visibility, tab switching, live garden updates, leaf selection, dense-canopy page picking, the shared New Tab illustration, the companion under a Trusted Types CSP, and narrow screens against the real HTML/CSS/modules and extension CSP. Only Chromium messaging and storage events are mocked; these UI tests do not replace loading the unpacked extension for end-to-end navigation testing.

`npm run preview:trees` serves an interactive gallery of the actual SVG renderer, including young and full-canopy trees. It uses explicitly labeled sample gardens, does not access Chrome APIs or real browsing history, and binds to loopback (`127.0.0.1:4173`) by default. Set `PORT` to change the port. Remote previews require an explicit `HOST` override, for example `$env:HOST='0.0.0.0'; npm run preview:trees` in PowerShell. Only enable remote access on a trusted development network; unset `HOST` afterward with `Remove-Item Env:HOST`.

### Historical note — v0.3.6 (superseded by CHANGELOG)

Version 0.3.6 gave Forest Finds its compact tier-aware reveal, added the calm animated atmosphere on the New Tab planting page (compositor-friendly `transform`/`opacity` fields respecting reduced-motion and the Ambient motion setting), and introduced the automated SPA performance-regression checks (50 rapid `pushState` transitions, route distinctness, post-GC heap growth, and conservative DOM/long-task/layout/style/heap thresholds). The full history lives in [`CHANGELOG.md`](CHANGELOG.md).
