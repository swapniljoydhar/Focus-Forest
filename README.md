# Focus Forest

Focus Forest is a calm, local-first Chromium extension that helps you return to intention when useful research gradually becomes wandering. It contains **no generative AI, no summarizer, no remote model, no embeddings, and no page-content classifier**. Its intelligence is a transparent branch model built only from browser navigation signals. It is not a domain blocker and does not judge whether a page is relevant. It observes how pages are reached, keeps the current mission visible, and offers a gentle moment of choice when a tracked branch becomes unusually deep.

## The experience

Open a new tab and plant a mission such as "Compare laptops for university." Pressing **Enter** or choosing **Plant Intention** saves the mission locally and opens a search-results starting point for it. You can add a private, optional note about why it matters today; that note stays with the local garden as a reminder, never a score. The mission chip stays quietly available on supported pages. Related links grow healthy branches. At a deeper branch, the page becomes subtly quieter and the chip says that the branch is getting long. At the interruption threshold, the extension offers three equal choices: **Return to my mission**, **Save this for later**, or **Start a new mission**.

A garden view preserves completed missions locally. It shows what grew from the intention, where the path changed, why each path was recognized (link, new tab, search, in-page route, or unlinked exploration), and which curiosities were composted for later. The garden is a reflection, not a productivity score. When a branch reaches the choice threshold, Focus Forest describes it as deep rather than wrong: the user decides whether the detour is useful.

## Install locally (any Chromium desktop browser)

Focus Forest is a Manifest V3 extension for Chromium. It loads the same unpacked folder in Chrome, Brave, Edge, Opera, Vivaldi, Chromium, and other Chromium-based browsers.

1. Open the extensions page: `chrome://extensions` (Chrome, Chromium, Arc), `brave://extensions` (Brave), `edge://extensions` (Edge), `opera://extensions` (Opera), or `vivaldi://extensions` (Vivaldi).
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `focus-forest` directory (the folder containing `manifest.json`).
5. Open a new tab. Focus Forest replaces the browser's new tab page with the planting page. You do not need to turn Shields off.

After updating the files, click **Reload** on Focus Forest's extension card, then reopen the garden and refresh existing web pages so they receive the updated companion script.

### Chromium notes

- Chromium browsers share the Chrome extension format. The `chrome.*` API namespace, `chrome-extension://` sender URLs, and `chrome_url_overrides` manifest key are intentional; they should not be renamed to `brave.*`, `edge.*`, or `opera.*`. Edge and Opera may also expose `browser.*`; Focus Forest uses `chrome.*` and falls back to `browser.*` when needed.
- New-tab placeholders are recognized across Chromium flavors, including `chrome://newtab`, `chrome://new-tab-page`, `brave://newtab`, `edge://newtab`, `opera://startpage`, and `vivaldi://newtab`. The first ordinary web page becomes the mission root.
- The companion runs on HTTP(S) websites, not `chrome://settings`, `brave://extensions`, `edge://settings`, or other protected browser pages.
- If the companion is missing on an ordinary website, check Focus Forest's site access and refresh that page after reloading the extension. In Brave, do not disable Shields globally as an installation step.
- Another new-tab extension, or the browser's own new-tab page setting, can control the same page. Check which extension is enabled for that override if Focus Forest's planting screen does not appear. Brave, Edge, and Opera may ask you to confirm replacing their new-tab page.
- Automated coverage uses mocked extension APIs and Chromium UI tests. A full, installed-extension walkthrough in a real profile of each browser is still required; these checks do not claim end-to-end certification for every Chromium fork.

## File structure

```text
focus-forest/
  [manifest.json](manifest.json)
  [background/service-worker.js](background/service-worker.js)
  [content/content.js](content/content.js)
  [shared/state.js](shared/state.js)
  [shared/error-tracing.js](shared/error-tracing.js)
  [popup/](popup/index.html)
  [newtab/](newtab/index.html)
  [dashboard/](dashboard/index.html)
  [settings/](settings/index.html)
  [icons/](icons/icon-128.png)
```

## Navigation semantics

The origin is the first ordinary webpage after a mission is planted. A link activated in a tracked page creates one branch level. A new tab opened from a tracked page waits until the destination loads, then attaches exactly once using the opener relationship or a short-lived pending-link relationship. Unrelated tabs remain outside the tree.

Manually entered URLs, bookmarks, and other unlinked navigations are recorded as neutral external paths when they occur inside a tracked tab; they do not automatically become deeper distractions. Returning to a known URL reuses its existing node instead of creating artificial depth. Browsers cannot expose every semantic relationship, so the extension records confidence internally and remains intentionally humble about what it knows.

## Browser compatibility

Focus Forest targets desktop Chromium browsers: **Chrome, Brave, Edge, Opera, and Vivaldi**.

- Supported via guarded `chrome.*` calls (`tabs`, `storage`, `alarms`, `contextMenus`, `webNavigation`, `commands`); every cross-browser-uncertain call uses optional chaining or an existence check, and `browser.*` is aliased to `chrome.*` where present (`shared/chromium-api.js`).
- No Google-only APIs are used: no `chrome.gcm`, `chrome.instanceID`, `identity.getAuthToken`, or `sidePanel`. There is no `update_url` override to port.
- `chrome.storage.sync` is a best-effort settings mirror only; core state lives in `chrome.storage.local`, so Brave/Edge local-only sync changes nothing about functionality.
- Install per browser: `chrome://extensions`, `brave://extensions`, `edge://extensions`, `opera://extensions`, `vivaldi://extensions` → Developer mode → Load unpacked.
- Known limitation: Brave, Edge, and Opera may ask to confirm replacing their new-tab page; Brave Shields can stay on.

## Privacy

Session data, URL/title metadata, navigation events, optional mission notes, and compost items are stored in `chrome.storage.local`. The extension does not collect page text, send browsing data to a server, use an account, or run remote analytics. Local history is bounded to 12 gardens and the compost pile to 80 items. The dashboard provides an explicit delete-all-data action.

Dashboard duration statistics represent elapsed time between starting and ending a garden session. They do not claim foreground-tab or keyboard/mouse activity tracking.

## Permissions

The extension uses local storage for gardens and the `tabs` permission only to replace Chromium new-tab pages (including Brave's dashboard) with the planting screen. It uses declared HTTP(S) page access to render the mission chip and detect eligible link activations, plus `webNavigation` to support SPA history tracking on YouTube, Notion, Gmail, GitHub, and similar sites. Browser-internal, restricted, and other protected pages may not support the content script and degrade gracefully.

## Accessibility and agency

The mission chip, choice sheet, and garden-care dialog use semantic controls, visible focus states, keyboard navigation, Escape handling, focus containment, readable text alternatives, and reduced-motion support. The companion is deliberately compact, habitat-themed, and positioned at the upper-right so it avoids common site branding and navigation areas; it adapts to narrow viewports without becoming a page overlay. When a deeper branch is first observed, a tiny trunk-and-leaf mark grows inside the unchanged chip, flickers briefly, and then settles into the ordinary notification copy. This bounded ritual is skipped under reduced-motion preferences and never blocks the page. Its mission, branch state, and Pause/Resume action have separate hierarchy, deterministic state styling, and an accessible group label. The garden uses a shape-and-text legend rather than color alone, and destructive-looking actions use a calm local dialog instead of a browser-native prompt. Dashboard controls are separated into garden selection and local-data care groups. The extension does not close unrelated tabs. Recovery actions are phrased as choices, not warnings or punishments.

## Living garden and branch care

The garden dashboard uses a **storybook-style cartoon tree** with a rounded, layered canopy, a warm tapered trunk, curved limbs, and a small planted patch of grass. It grows through `seed`, `sapling`, `canopy`, and `deep` illustrations. Even a single long research chain keeps a recognizable tree silhouette instead of becoming a tall graph connector. Empty gardens show a two-leaf sprout. Completed gardens use a quieter, resting palette.

The foliage is decorative; **each outlined leaf marker represents a real browsing page**, and the knot in the trunk represents the mission root. Select a leaf to illuminate its actual ancestor chain, or use **Explore a page** to reach small or crowded markers. Page titles appear on selection rather than covering the canopy. The selected-path panel still provides depth, relationship confidence, parent context, and care actions. **Prune this path** and **Return to compost** preserve the historical trail. Leaf positions fill the illustrated crown; their height is not a depth or productivity score.

The illustration uses native SVG DOM construction, local CSS, and deterministic geometry—no images, Canvas, rendering library, or animation loop. Parent validation and cycle repair affect only the visual topology and never rewrite stored history. The New Tab shares the decorative tree artwork without inventing browsing nodes, and the small companion uses a matching inline cartoon icon built without an HTML sink. Keyboard selection, visible focus states, and reduced-motion preferences are preserved.

## History and tab behavior

Returning to a known URL reuses its canonical garden node. If Chrome opens a duplicate tab on a known path, Focus Forest attaches the new tab as an alias instead of creating a deeper branch. Closing one alias does not erase the path while another attached tab remains. Go Home activates the validated origin without closing tracked or unrelated tabs. Composting also preserves the current page; it changes only the local branch state.

The garden dashboard provides **Forget this garden** for removing one selected local session, alongside the explicit delete-all action.

## Tending controls and completion ritual

Open **Tend the forest** from the popup or your browser's extension details to choose when the page grows quieter and when the choice sheet appears. The extension enforces a one-branch gap between those moments. Ambient motion can be turned off, and every setting stays local.

Ending a mission opens a small reflection moment with only deterministic facts: pages grown, deepest branch, and saved curiosities. The user can let the garden rest, keep tending, or return to the garden view. No session is graded.

Redirect-like URLs are treated as structural transport when they immediately lead to a final destination. They do not add an extra branch level. Search pages reached directly remain neutral; links clicked from them are ordinary branches.

## Low-memory design

The runtime is dependency-free and uses native HTML, CSS, and SVG. Page scripts receive only a compact active-view object rather than the full garden history. The service worker caches normalized state in memory to reduce storage round-trips, avoids storage writes for no-op observations, caps sessions, branches, events, compost, aliases, and pending relationship records, canonicalizes URLs, and injects only once into top-level HTTP(S) documents. Ambient visuals are CSS/SVG layers rather than images, video, Canvas loops, or external fonts.

## Security and reliability

The service worker validates sender identity, treats runtime messages and content-script payloads as untrusted inputs, and rejects malformed message shapes. It validates sender-tab metadata and HTTP(S) URLs, ignores synthetic page-dispatched clicks, serializes storage mutations, bounds pending relationships and SPA deduplication, clears redirect state when tabs are removed, keys target-blank relationships by source tab plus destination, detaches all tab aliases when a path is composted, excludes pruned/composted paths from active reuse, and revalidates the stored origin tab before Go Home. If the tab ID was reused or the origin moved to another window, it focuses only the validated origin window; otherwise it opens a safe new origin tab without closing anything. The companion renders inside a closed `ShadowRoot` and uses DOM-safe construction for all companion markup and dynamic content; no companion stylesheet is exposed as a web-accessible resource. Content scripts receive only the compact active view, while full garden snapshots, settings writes, session deletion, pruning, compost deletion, and clear-data operations require an extension-page sender. The companion host element uses `pointer-events: none` so the page behind it (text, links, scroll) stays fully interactive; only the chip and the choice card opt back in with `pointer-events: auto`. The chip is draggable via a pointer-events handle and remembers its position per tab. The choice prompt appears as a non-blocking corner card rather than a full-screen modal, so it never hides page content. Dashboard data-bearing lists and detail controls use DOM construction, while popup, New Tab, and dashboard startup failures show local recovery copy instead of remaining blank.

For the original security review, see [`SECURITY_REVIEW_2026-08-15.md`](SECURITY_REVIEW_2026-08-15.md) and [`SECURITY.md`](SECURITY.md). For the modified-fork audit and repair record, see [`AUDIT_REPORT_2026-08-16.md`](AUDIT_REPORT_2026-08-16.md).

The security review and primary-source comparison are recorded in [`SECURITY_REVIEW_2026-08-15.md`](SECURITY_REVIEW_2026-08-15.md). Automated checks include ES-module syntax validation, error-boundary rejection contracts, runtime/message contracts, state normalization and storage-failure behavior, deterministic tree geometry, sender-boundary and prototype-message checks, service-worker behavior, bounded stress, repository-integrity and local-asset checks, no-loop/no-network runtime boundaries, no-continuous-animation CSS checks, and no-AI references. The repaired worktree also includes `test-error-tracing.mjs`, `test-runtime-contracts.mjs`, `test-state.mjs`, `test-tree-layout.mjs`, `test-security.mjs`, `test-service-worker.mjs`, `stress-service-worker.mjs`, and `test-repository-integrity.mjs`. Real-browser testing is still required for page-specific rendering, restricted origins, redirects, SPA behavior, multiple windows, keyboard focus, popup sizing, and browser/profile differences.

## Development and validation

The source intentionally remains dependency-light and loadable without a build step. The service worker is the source of truth; content scripts render page UI and report navigation signals; New Tab, popup, and dashboard are separate extension pages. This is a polished MVP prototype, not a Chrome Web Store-certified release. The depth-aware redesign was informed by comparison with [History Tree](https://github.com/initialshl/history-tree), [Galaxy Tab History Graph](https://github.com/Katee/galaxy-tab-history-graph), and [Focus Pilot](https://github.com/Nahid-mahmud555/focus-pilot-pro-official), but no code or dependency was imported.

### Run the checks

```sh
npm ci
npm test
npx playwright install chromium
npm run test:dashboard
```

The fast suite includes tree geometry, deep-branch bounds, and malformed-parent regressions. The dashboard suite uses Chromium to check first-load visibility, tab switching, live garden updates, leaf selection, dense-canopy page picking, the shared New Tab illustration, the companion under a Trusted Types CSP, and narrow screens against the real HTML/CSS/modules and extension CSP. Only Chromium messaging and storage events are mocked; these UI tests do not replace loading the unpacked extension for end-to-end navigation testing. Playwright is development-only; the extension still loads without a build step or runtime dependencies. An existing Chromium binary can be selected with `CHROMIUM_EXECUTABLE_PATH`.

### Preview the tree artwork

Run `npm run preview:trees` for an interactive gallery of the actual SVG renderer, including young and full-canopy trees. It uses explicitly labeled sample gardens, does not access Chrome APIs or real browsing history, and binds to `0.0.0.0` for remote development previews.
