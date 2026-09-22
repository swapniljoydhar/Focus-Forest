# Focus Forest

Focus Forest is a calm, local-first Chromium extension that helps you return to intention when useful research gradually becomes wandering. It contains **no generative AI, no summarizer, no remote model, no embeddings, and no page-content classifier**. Its intelligence is a transparent branch model built only from browser navigation signals. It is not a domain blocker and does not judge whether a page is relevant. It observes how pages are reached, keeps the current mission visible, and offers a gentle moment of choice when a tracked branch becomes unusually deep.

## The experience

Open a new tab and plant a mission such as "Compare laptops for university." Pressing **Enter** or choosing **Plant Intention** saves the mission locally and opens a search-results starting point for it. You can add a private, optional note about why it matters today; that note stays with the local garden as a reminder, never a score. The mission chip stays quietly available on supported pages. Related links grow healthy branches. At a deeper branch, the page becomes subtly quieter and the chip says that the branch is getting long. At the interruption threshold, the extension offers three equal choices: **Return to my mission**, **Save this for later**, or **Start a new mission**.

A garden view preserves completed missions locally. It shows what grew from the intention, where the path changed, why each path was recognized (link, new tab, search, in-page route, or unlinked exploration), and which curiosities were composted for later. The garden is a reflection, not a productivity score. When a branch reaches the choice threshold, Focus Forest describes it as deep rather than wrong: the user decides whether the detour is useful.

## v0.3.6 release notes

Version 0.3.6 gives **Forest Finds** a compact, tier-aware discovery reveal: a small one-shot entrance motion and restrained seed, bloom, or seasonal-detail treatment. It does not cover the page or interrupt navigation, and it respects reduced-motion preferences. The reward path remains offline and bounded: the extension stores only a reward ID and timestamp, applies a cooldown, and shows a small discovery only after an intentional choice or mission action.

Earlier releases added the calm animated atmosphere and SPA performance regression checks described below.

The calm animated atmosphere on the New Tab planting page uses two lightweight CSS light fields that drift behind the existing forest scene, without changing the extension’s core browsing model. The effect uses only compositor-friendly `transform` and `opacity` animation, automatically respects browser reduced-motion preferences, and follows the extension’s local **Ambient motion** setting.

This release also adds automated protection against SPA performance regressions. CI now stress-tests 50 rapid `history.pushState` transitions, checks that every route remains distinct, measures post-GC heap growth, and enforces conservative thresholds for DOM size, long tasks, layout work, style recalculation, and JavaScript heap usage. See the complete [`CHANGELOG.md`](CHANGELOG.md) for the release history.

## Install locally (any Chromium desktop browser)

Focus Forest is a Manifest V3 extension for Chromium. It loads the same unpacked folder in Chrome, Brave, Edge, Opera, Vivaldi, Chromium, and other Chromium-based browsers.

1. Open the extensions page: `chrome://extensions` (Chrome, Chromium, Arc), `brave://extensions` (Brave), `edge://extensions` (Edge), `opera://extensions` (Opera), or `vivaldi://extensions` (Vivaldi).
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `focus-forest` directory (the folder containing `manifest.json`).
5. Open a new tab. Focus Forest replaces the browser's new tab page with the planting page. You do not need to turn Shields off.

### Per-browser install

| Browser | Extensions page | Known install caveats |
| --- | --- | --- |
| **Chrome** / Chromium / Arc | [`chrome://extensions`](chrome://extensions) | Reference configuration. |
| **Brave** | [`brave://extensions`](brave://extensions) | May ask to confirm replacing its new tab page. **Shields can stay on** — do not disable them as an install step. |
| **Microsoft Edge** | [`edge://extensions`](edge://extensions) | May ask to confirm replacing its new tab page. |
| **Opera** | [`opera://extensions`](opera://extensions) | Ships its own Speed Dial start page and may ask to confirm the override. |
| **Vivaldi** | [`vivaldi://extensions`](vivaldi://extensions) | Start page is `chrome://vivaldi-webui/startpage`; the override may need confirming. |

After updating the files, click **Reload** on Focus Forest's extension card, then reopen the garden and refresh existing web pages so they receive the updated companion script.

### Chromium notes

- Chromium browsers share the Chrome extension format. The `chrome.*` API namespace, `chrome-extension://` sender URLs, and `chrome_url_overrides` manifest key are intentional; they should not be renamed to `brave.*`, `edge.*`, or `opera.*`. Edge and Opera may also expose `browser.*`; Focus Forest uses `chrome.*` and falls back to `browser.*` when needed.
- New-tab placeholders are recognized across Chromium flavors, including `chrome://newtab`, `chrome://new-tab-page`, `brave://newtab`, `edge://newtab`, `opera://startpage`, and `vivaldi://newtab`. The first ordinary web page becomes the mission root.
- The companion runs on HTTP(S) websites, not `chrome://settings`, `brave://extensions`, `edge://settings`, or other protected browser pages.
- Planting from the Focus Forest New Tab saves the mission first, then navigates that same browser tab to the browser’s configured default search provider, unless a local provider override is selected in Settings.
- If the companion is missing on an ordinary website, check Focus Forest's site access and refresh that page after reloading the extension. In Brave, do not disable Shields globally as an installation step.
- Another new-tab extension, or the browser's own new-tab page setting, can control the same page. Check which extension is enabled for that override if Focus Forest's planting screen does not appear. Brave, Edge, and Opera may ask you to confirm replacing their new-tab page.
- Automated coverage runs on three lanes: mocked-API unit/contract tests, Chromium page tests for the extension UIs, and `test-extension-load.mjs`, which loads the real manifest in Chromium (`--load-extension`, new headless) and exercises the service worker, both content-script worlds, the new-tab override, the choice card, cross-context chip sync, and the message-rate budget end to end. A full, installed-extension walkthrough in a real profile of each Chromium fork (Brave/Edge/Opera/Vivaldi) is still required before store submission; these checks do not claim certification for every fork.

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
│   ├── state.js               Schema, validation, persistence, rewards
│   ├── constants.js           Limits and layout constants
│   ├── error-tracing.js       ErrorTrace + root-cause diagnosis
│   ├── theme.js               Dark/light preference for extension pages
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
├── settings/                  Options page (thresholds, motion, exclusions)
├── icons/                     16 / 32 / 48 / 128 px icons
└── scripts/
    ├── package.mjs            Build: dist/focus-forest.zip
    ├── profile-newtab.mjs     Performance and memory gate (CI)
    └── preview-trees.mjs      Local SVG artwork preview server
```

Key entry points: [`manifest.json`](manifest.json) · [`background/service-worker.js`](background/service-worker.js) · [`content/content.js`](content/content.js) · [`content/spa-bridge.js`](content/spa-bridge.js) · [`shared/state.js`](shared/state.js) · [`shared/constants.js`](shared/constants.js) · [`shared/error-tracing.js`](shared/error-tracing.js) · [`shared/theme.js`](shared/theme.js) · [`shared/chromium-api.js`](shared/chromium-api.js) · [`dashboard/index.html`](dashboard/index.html) · [`dashboard/tree-layout.js`](dashboard/tree-layout.js) · [`dashboard/tree-renderer.js`](dashboard/tree-renderer.js) · [`newtab/index.html`](newtab/index.html) · [`popup/index.html`](popup/index.html) · [`settings/index.html`](settings/index.html) · [`scripts/package.mjs`](scripts/package.mjs)

## Navigation semantics

The origin is the first ordinary webpage after a mission is planted. A link activated in a tracked page creates one branch level. A new tab opened from a tracked page waits until the destination loads, then attaches exactly once using the opener relationship or a short-lived pending-link relationship. Unrelated tabs remain outside the tree.

Manually entered URLs, bookmarks, and other unlinked navigations are recorded as neutral external paths when they occur inside a tracked tab; they do not automatically become deeper distractions. Single-page application route changes are observed through both the History API hooks and `webNavigation`, serialized before the companion refreshes, and deduplicated so one `pushState` or `replaceState` route creates at most one branch. Returning to a known URL reuses its existing node instead of creating artificial depth. Browsers cannot expose every semantic relationship, so the extension records confidence internally and remains intentionally humble about what it knows.

## Browser compatibility

Focus Forest targets desktop Chromium browsers: **Chrome, Brave, Edge, Opera, and Vivaldi**.

- Supported via guarded `chrome.*` calls (`tabs`, `storage`, `alarms`, `contextMenus`, `webNavigation`, `commands`); every cross-browser-uncertain call uses optional chaining or an existence check, and `browser.*` is aliased to `chrome.*` where present (`shared/chromium-api.js`).
- No Google account, telemetry, or vendor-specific service APIs are used: there is no `chrome.gcm`, `chrome.instanceID`, `identity.getAuthToken`, or `sidePanel` integration. The optional `chrome.search` call only hands the user's mission to the browser's already configured default search provider; it does not access Google services or change browser settings. On the rare browser where the Search API is missing or fails, the first-step search falls back to a DuckDuckGo results page rather than silently assuming any specific provider. There is no `update_url` override to port.
- Settings, session history, and compost items remain in `chrome.storage.local`; Focus Forest does not mirror browsing-related data to `chrome.storage.sync` or an external service.
- Install per browser: `chrome://extensions`, `brave://extensions`, `edge://extensions`, `opera://extensions`, `vivaldi://extensions` → Developer mode → Load unpacked.
- **Known limitations, per browser:**
  - **Chrome** — reference configuration; no known deviations.
  - **Brave** — Brave shows its own new-tab page and may require an explicit confirmation before the override takes effect. Shields can stay on and should not be disabled as an install step. `chrome.search.query` availability is feature-detected and falls back to a DuckDuckGo results URL.
  - **Microsoft Edge** — may require confirming the new-tab override. Edge can expose `browser.*` alongside `chrome.*`; [`shared/chromium-api.js`](shared/chromium-api.js) aliases one to the other.
  - **Opera** — ships Speed Dial as its start page (`opera://startpage`) and may require confirming the override.
  - **Vivaldi** — start page is `chrome://vivaldi-webui/startpage`, which is recognized separately in [`shared/state.js`](shared/state.js); the override may require confirming.
  - **All forks** — `minimum_chrome_version: 111` is enforced by Chrome/Chromium only. The `world: "MAIN"` content script ([`content/spa-bridge.js`](content/spa-bridge.js)) needs Chromium 111+, and on a fork shipping an older engine that entry may be dropped silently. The extension degrades gracefully (the service worker's `webNavigation` listener plus a visibility-gated poll still track SPA routes), at the cost of slightly slower companion updates.
  - **All forks** — automated coverage runs in Chromium only. A manual installed-extension walkthrough on each fork is still required before store submission; this project does not claim per-fork certification.

## Privacy

Session data, URL/title metadata, navigation events, optional mission notes, and compost items are stored in `chrome.storage.local`. The extension does not collect page text, send browsing data to a server, use an account, or run remote analytics. Local history is bounded to 12 gardens and the compost pile to 80 items. The dashboard provides an explicit delete-all-data action.

Dashboard duration statistics represent elapsed time between starting and ending a garden session. They do not claim foreground-tab or keyboard/mouse activity tracking.

## Permissions

The extension uses local storage for gardens and the `tabs` permission to replace Chromium new-tab pages, associate mission tabs, and navigate the planting tab to its first search step. The `search` permission is used only when **Browser default** is selected, sending the mission through Chromium's existing default provider without changing that setting. It uses declared HTTP(S) page access to render the mission chip and detect eligible link activations, plus `webNavigation` and a minimal main-world SPA bridge (`content/spa-bridge.js`, which requires Chrome 111+) to support SPA route tracking on ordinary HTTP(S) sites. Browser-internal, restricted, and other protected pages may not support the content script and degrade gracefully.

For single-page applications, Focus Forest observes `history.pushState`, `history.replaceState`, `popstate`, and Chromium's `webNavigation.onHistoryStateUpdated`. Each URL/title snapshot is captured when the route event occurs, so rapid chapter or product changes remain distinct branches. Browser Back and Forward navigation reports the route restored by the History API, while the page itself continues updating without a full reload. This preserves the SPA's bookmarkable and shareable URLs without treating the application as a new document on every route.

## Accessibility and agency

The mission chip, choice sheet, and garden-care dialog use semantic controls, visible focus states, keyboard navigation, Escape handling, focus restoration when an overlay closes, readable text alternatives, and reduced-motion support. The companion follows the browser's light/dark preference automatically (`prefers-color-scheme`) so the chip never glares on a dark page. The choice sheet is deliberately **non-modal** (`aria-modal="false"`) and shown as a corner card, so it never traps focus or hides page content; whenever it or the chip is hidden, focus is returned to the page control the user was on rather than being stranded on `<body>`. The companion is deliberately compact, habitat-themed, and positioned at the upper-right so it avoids common site branding and navigation areas; it adapts to narrow viewports without becoming a page overlay. When a deeper branch is first observed, a tiny trunk-and-leaf mark grows inside the unchanged chip, flickers briefly, and then settles into the ordinary notification copy. This bounded ritual is skipped under reduced-motion preferences and never blocks the page. Its mission, branch state, and Pause/Resume action have separate hierarchy, deterministic state styling, and an accessible group label. The garden uses a shape-and-text legend rather than color alone, and destructive-looking actions use a calm local dialog instead of a browser-native prompt. Dashboard controls are separated into garden selection and local-data care groups. The extension does not close unrelated tabs. Recovery actions are phrased as choices, not warnings or punishments.

## Living garden and branch care

The garden dashboard uses a **storybook-style cartoon tree** with a rounded, layered canopy, a warm tapered trunk, curved limbs, and a small planted patch of grass. It grows through `seed`, `sapling`, `canopy`, and `deep` illustrations. Even a single long research chain keeps a recognizable tree silhouette instead of becoming a tall graph connector. Empty gardens show a two-leaf sprout. Completed gardens use a quieter, resting palette.

The foliage is decorative; **each outlined leaf marker represents a real browsing page**, and the knot in the trunk represents the mission root. Select a leaf to illuminate its actual ancestor chain, or use **Explore a page** to reach small or crowded markers. Page titles appear on selection rather than covering the canopy. The selected-path panel still provides depth, relationship confidence, parent context, and care actions. **Prune this path** and **Return to compost** preserve the historical trail. Leaf positions fill the illustrated crown; their height is not a depth or productivity score.

The illustration uses native SVG DOM construction, local CSS, and deterministic geometry—no images, Canvas, rendering library, or animation loop. Parent validation and cycle repair affect only the visual topology and never rewrite stored history. The New Tab shares the decorative tree artwork without inventing browsing nodes, and the small companion uses a matching inline cartoon icon built without an HTML sink. Keyboard selection, visible focus states, and reduced-motion preferences are preserved.

**Garden health** is a three-step visual verdict — *lush*, *steady*, or *sparse* — derived only from existing local branch data (how much of the path stayed near the intention). It is a treatment on the same deterministic geometry (saturation, glints, leaf opacity), never a number, never a layout change, and young gardens of two pages or fewer are never judged. Faithful missions also earn rarer seasonal **Forest Finds** at completion, and the dashboard's tending streak (consecutive active days, already local) carries positive-only milestone lines at 3/7/14/30 days — a broken streak simply shows nothing. In Strict mode, the saved list additionally states how many curiosities have been resting for over a week; the extension never claims to know whether you revisited a page.

## History and tab behavior

Returning to a known URL reuses its canonical garden node. If Chrome opens a duplicate tab on a known path, Focus Forest attaches the new tab as an alias instead of creating a deeper branch. Closing one alias does not erase the path while another attached tab remains. Go Home activates the validated origin without closing tracked or unrelated tabs. Composting also preserves the current page; it changes only the local branch state.

The garden dashboard provides **Forget this garden** for removing one selected local session, alongside the explicit delete-all action.

## Tending controls and completion ritual

Open **Tend the forest** from the popup or your browser's extension details to choose when the page grows quieter and when the choice sheet appears. The extension enforces a one-branch gap between those moments. Ambient motion can be turned off, and every setting stays local.

**Hold me to my word (Strict mode)** is an opt-in tone: the chip and the choice card state the same facts more firmly — pages and minutes away from your intention, and, when you wrote one, a reminder that you recorded *why this mattered today* (the note itself is never sent to the page). The four choices, including **Keep exploring**, never change; Strict mode raises accountability, never removes agency, and nothing is ever blocked. **Alt+F** starts or ends a mission; **Alt+M** returns you to the mission origin through the same validated flow as the card's *Return to my mission*.

The **Performance guardian** (on by default, opt-out in Settings) calms every decoration — ambient layers, fireflies, growth rituals, discovery reveals, living-garden animation — when memory pressure is high, while tracking, the companion, and your data always keep working. Chromium cannot report free system RAM, so the guardian honestly uses two signals: the browser's device-memory class and the extension context's own JS-heap use. The sensitivity bar (1–5) sets how early decorations rest.

Ending a mission opens a small reflection moment with only deterministic facts: pages grown, deepest branch, and saved curiosities. The user can let the garden rest, keep tending, or return to the garden view. No session is graded.

Redirect-like URLs are treated as structural transport when they immediately lead to a final destination. They do not add an extra branch level. Search pages reached directly remain neutral; links clicked from them are ordinary branches.

## Low-memory design

The runtime is dependency-free and uses native HTML, CSS, and SVG. Page scripts receive only a compact active-view object rather than the full garden history. The service worker caches normalized state in memory to reduce storage round-trips, avoids storage writes for no-op observations, caps sessions, branches, events, compost, aliases, and pending relationship records, canonicalizes URLs, and injects only once into top-level HTTP(S) documents. Ambient visuals are CSS/SVG layers rather than images, video, Canvas loops, or external fonts: the planting scene's time-of-day tint is computed once per load (static, zero animation cost), the six dusk/night fireflies are transform/opacity-only, and title-only SPA mutations are coalesced to at most one message pair per five seconds so video-progress titles cannot spend a tab's rate budget. The Performance guardian (see Tending controls) drops every decoration under memory pressure while core tracking continues.

## Security and reliability

The service worker validates sender identity, treats runtime messages and content-script payloads as untrusted inputs, and rejects malformed message shapes. It validates sender-tab metadata and HTTP(S) URLs, ignores synthetic page-dispatched clicks, serializes storage mutations, bounds pending relationships and SPA deduplication, clears redirect state when tabs are removed, keys target-blank relationships by source tab plus destination, detaches all tab aliases when a path is composted, excludes pruned/composted paths from active reuse, and revalidates the stored origin tab before Go Home. If the tab ID was reused or the origin moved to another window, it focuses only the validated origin window; otherwise it opens a safe new origin tab without closing anything. The companion renders inside a closed `ShadowRoot` and uses DOM-safe construction for all companion markup and dynamic content; no companion stylesheet is exposed as a web-accessible resource. Content scripts receive only the compact active view, while full garden snapshots, settings writes, session deletion, pruning, compost deletion, and clear-data operations require an extension-page sender. The companion host element uses `pointer-events: none` so the page behind it (text, links, scroll) stays fully interactive; only the chip and the choice card opt back in with `pointer-events: auto`. The chip is draggable via a pointer-events handle. Its position is remembered for the current site only: the value is held in extension-private session storage (`chrome.storage.session`) managed by the service worker, keyed by the validated sender tab and origin, so it resets when you move to a different site, is cleared when the tab or the browser session ends, and is never readable by the host page. Saves are validated, serialized, and bounded; keyboard auto-repeat rides a short trailing debounce so position saves never crowd the message budget. On forks without `storage.session` the position degrades to worker memory rather than falling back to page storage. The choice prompt appears as a non-blocking corner card rather than a full-screen modal, so it never hides page content. Dashboard data-bearing lists and detail controls use DOM construction, while popup, New Tab, and dashboard startup failures show local recovery copy instead of remaining blank.

For the original security review, see [`SECURITY_REVIEW_2026-08-15.md`](SECURITY_REVIEW_2026-08-15.md) and [`SECURITY.md`](SECURITY.md). For the modified-fork audit and repair record, see [`AUDIT_REPORT_2026-08-16.md`](AUDIT_REPORT_2026-08-16.md).

Automated checks cover ES-module syntax validation, error-boundary rejection contracts, runtime and message contracts, state normalization and storage-failure behaviour, deterministic tree geometry, sender-boundary and prototype-message checks, service-worker behaviour, bounded stress, repository-integrity and local-asset checks, no-loop/no-network runtime boundaries, no-continuous-animation CSS checks, and no-AI references. The test harnesses are [`test-error-tracing.mjs`](test-error-tracing.mjs), [`test-runtime-contracts.mjs`](test-runtime-contracts.mjs), [`test-state.mjs`](test-state.mjs), [`test-tree-layout.mjs`](test-tree-layout.mjs), [`test-security.mjs`](test-security.mjs), [`test-service-worker.mjs`](test-service-worker.mjs), [`stress-service-worker.mjs`](stress-service-worker.mjs), [`test-repository-integrity.mjs`](test-repository-integrity.mjs), [`test-preview.mjs`](test-preview.mjs), [`test-regression-fixes.mjs`](test-regression-fixes.mjs), [`test-audit-fixes.mjs`](test-audit-fixes.mjs), [`test-worker-inputs.mjs`](test-worker-inputs.mjs), [`test-ram-guard.mjs`](test-ram-guard.mjs), [`test-dashboard-browser.mjs`](test-dashboard-browser.mjs) (`npm run test:dashboard`), [`test-extension-load.mjs`](test-extension-load.mjs) (`npm run test:extension`), and [`test-features-e2e.mjs`](test-features-e2e.mjs) (`npm run test:features`). Real-browser testing is still required for page-specific rendering, restricted origins, redirects, SPA behaviour, multiple windows, keyboard focus, popup sizing, and browser/profile differences.

## Roadmap

Committed next (owner-confirmed direction — see [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md)): the accountability layer — gentle drift accounting with an optional **Strict mode** — and the **garden health** reward system (lush versus sparse gardens, extended Forest Finds, local streaks and milestones). The QA-derived improvements below are ranked by impact from the 2026-09-22 audit.

| # | Item | Status |
| --- | --- | --- |
| 1 | Per-fork manual QA pass (Brave, Edge, Opera, Vivaldi) driven by a generated checklist script — required before store submission | Planned (owner) |
| 2 | Throttle title-only SPA updates (coalesce same-URL title changes to at most one message pair per 5 s) to protect the message budget on title-mutating sites | **Shipped 2026-09-22** — pinned by Gate 7 in real Chromium |
| 3 | Automated coverage for the untested branches of the chip-position system: `pagehide` flush, rate-limit retry, clear-data theme guard | Planned — rate-limit branch covered; flush + theme guard remain manual-checklist items |
| 4 | Popup error state distinct from the empty state; settings rewards copy re-synced when streaks ship | **Shipped 2026-09-22** — retry affordance in the popup; rewards copy now truthful about streaks |
| 5 | Dark-mode companion chip (`prefers-color-scheme`) and a `return-to-mission` keyboard command | **Shipped 2026-09-22** — Alt+M returns to the mission origin |

## Development and validation

The source intentionally remains dependency-light and loadable without a build step. The service worker is the source of truth; content scripts render page UI and report navigation signals; New Tab, popup, and dashboard are separate extension pages. This is a polished MVP prototype, not a Chrome Web Store-certified release. The depth-aware redesign was informed by comparison with [History Tree](https://github.com/initialshl/history-tree), [Galaxy Tab History Graph](https://github.com/Katee/galaxy-tab-history-graph), and [Focus Pilot](https://github.com/Nahid-mahmud555/focus-pilot-pro-official), but no code or dependency was imported.

### Run the checks

```bash
npm ci                    # install the dev-only toolchain (Playwright)
npm test                  # 13 unit/contract suites, no browser required
npx playwright install chromium
npm run test:dashboard    # dashboard UI in real Chromium (39 assertions)
npm run test:extension    # loads the real manifest (11 gates)
npm run test:features     # end-to-end walk of every user surface (13 steps)
npm run test:spa-stress   # 50 rapid history.pushState transitions
npm run profile:performance   # memory/perf gate for the New Tab page
```

`npm test` runs without a browser. The three browser suites need Playwright's Chromium; an existing binary can be selected with `CHROMIUM_EXECUTABLE_PATH`.

### Build the store package

```bash
npm run package           # writes dist/focus-forest.zip
```

Packaging needs no build step for the source itself — the archive is the raw `manifest.json`, `background/`, `content/`, `dashboard/`, `icons/`, `newtab/`, `popup/`, `settings/` and `shared/` directories. The archiver is capability-probed rather than assumed: PowerShell on Windows, otherwise `zip`, otherwise `python3 -m zipfile`. Install any one of those if the script reports that no archiver is usable. Upload `dist/focus-forest.zip` to the Chrome Web Store, or keep loading the folder unpacked for development.

The fast suite includes tree geometry, deep-branch bounds, and malformed-parent regressions. The dashboard suite uses Chromium to check first-load visibility, tab switching, live garden updates, leaf selection, dense-canopy page picking, the shared New Tab illustration, the companion under a Trusted Types CSP, and narrow screens against the real HTML/CSS/modules and extension CSP. Only Chromium messaging and storage events are mocked; these UI tests do not replace loading the unpacked extension for end-to-end navigation testing. Playwright is development-only; the extension still loads without a build step or runtime dependencies. An existing Chromium binary can be selected with `CHROMIUM_EXECUTABLE_PATH`.

### Preview the tree artwork

Run `npm run preview:trees` for an interactive gallery of the actual SVG renderer, including young and full-canopy trees. It uses explicitly labeled sample gardens, does not access Chrome APIs or real browsing history, and binds to loopback (`127.0.0.1:4173`) by default. Set `PORT` to change the port. Remote previews require an explicit `HOST` override, for example `$env:HOST='0.0.0.0'; npm run preview:trees` in PowerShell. Only enable remote access on a trusted development network; unset `HOST` afterward with `Remove-Item Env:HOST`.
