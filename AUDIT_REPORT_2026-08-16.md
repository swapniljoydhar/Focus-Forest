# Focus Forest Modified Fork Audit

**Status:** FIXED AND RESHIPPED PENDING FINAL PUBLISH

**Audited repository:** `https://github.com/swapniljoydhar/focus-forest`

**Audited revision:** `beb4eddd6b60342e6df5a5ecb73cbe23675b23b2`

**Comparison baseline:** last verified Focus Forest build at `9820a0a4821ba2a0b1e83ffc42f25f2e9c23b5d5`

## Executive finding

The modified GitHub revision was not a reliable improvement over the verified build. It combined useful ideas—SPA history tracking, configurable growth rituals, error tracing, stricter message schemas, and redesigned pages—with several integration regressions that prevented the companion from starting normally and caused the service worker to be invalid as an MV3 module.

The first confirmed live-browser failure was `ReferenceError: send is not defined` in `content/content.js`. The interruption path also called the removed `showChoiceCard()` name and retained stale `backdrop`/`sheetCopy` identifiers after the UI had been renamed to `choiceCard`/`choiceCopy`. Independently, the service worker contained literal `#` comment lines that fail module parsing. These failures explain why the modified repository appeared to do nothing.

The repair deliberately keeps the modified fork’s valuable SPA and settings concepts, but restores the verified build’s conservative boundaries: safe HTTP(S) navigation, bounded state, DOM construction, closed Shadow DOM, no destructive browser operations, and deterministic local-only behavior.

## Confirmed findings

| ID | Severity | Finding | Evidence | Resolution |
|---|---|---|---|---|
| F-01 | Critical | The content script called `send(...)` without defining the helper. | Live Chromium fixture logged `ReferenceError: send is not defined` at `content/content.js:89`. | Added a single typed `send(type, payload)` helper that sends `{type, ...payload}`. |
| F-02 | Critical | The interruption renderer called `showChoiceCard(depth)` although only `showChoiceSheet(depth)` existed. | Static symbol trace; interruption UI could not open through the intended function. | Routed the call to `showChoiceSheet(depth)`. |
| F-03 | High | The choice renderer retained stale `backdrop` and `sheetCopy` references after the markup rename. | Static symbol trace in `showChoiceSheet()` and navigation reset code. | Replaced them with `choiceCard` and `choiceCopy`. |
| F-04 | Critical | The MV3 service worker contained literal hash-prefixed lines that are not JavaScript comments. | `node --input-type=module --check` rejected the service worker at the first `# Coerce` line. | Converted the lines to valid `//` comments. |
| F-05 | High | `validateMessage()` returned immediately when an optional field was absent, allowing later required fields to be skipped. | Red runtime-contract test; schema loop returned `optional` instead of continuing. | Missing optional keys now continue; missing required keys return false. |
| F-06 | High | The content script used a full `GET_SNAPSHOT` request to read one setting. | Source trace showed the companion requesting a full garden snapshot. | Content now uses the compact `GET_ACTIVE_VIEW` response. |
| F-07 | High | Full snapshots and global settings mutations were not restricted to extension pages. | Message handler accepted `GET_SNAPSHOT` and `UPDATE_SETTINGS` based only on schema validity. Chrome guidance treats content-script messages as less trustworthy [1]. | Full snapshots, settings updates, clearing data, pruning, session deletion, and compost deletion now require a validated `chrome-extension://<runtime-id>/` sender URL. |
| F-08 | Medium | A content sender could potentially request destructive dashboard operations if it crafted a valid message. | Handler had no extension-page boundary for destructive operations. | Added `isExtensionPageSender()` and regression coverage. |
| F-09 | Medium | A pruned node could be treated as an active known path again because known-path lookup excluded `closedAt` but not terminal state. | Source trace in `observeTab()` versus `TERMINAL_STATES`. | Known-path reuse now excludes `pruned` and `composted` nodes. |
| F-10 | Medium | SPA deduplication was time-bounded but not size-bounded under a burst of unique URLs. | `spaDedup` used one timer per key without a map cap. | Added a 128-entry cap with expiry and oldest-entry eviction. |
| F-11 | Medium | Dashboard actions used mixed raw and recovery-wrapped rerender paths. | Node selection, session changes, detail actions, compost deletion, and startup used different functions. | Routed rerenders through `renderSafely()` and made the existing recovery wrappers effective. |
| F-12 | Medium | The companion static markup used `rootEl.innerHTML`, contradicting the claimed DOM-safe rendering model and making future edits brittle. | Static source inspection; current string was static but remained a security-drift surface. | Rebuilt the companion tree with `createElement`, attributes, `textContent`, and `append`. |
| F-13 | Low | The modified repository deleted the previously verified behavioral, security, layout, stress, and visual-audit artifacts. | Git comparison showed the test harnesses and several audit records removed from `origin/main`. | Restored the core regression suites and added this audit report plus live reproduction evidence. |
| F-14 | Information | The GitHub repository was public during this audit even though the previous verified repository was private. | GitHub metadata reported `isPrivate: false` on 2026-08-16. | No visibility change was made automatically; repository visibility is an account-level decision requiring explicit user confirmation. |

## Product and architecture opinion

The repository’s intended product is coherent: a local, deterministic browsing companion that helps a user notice navigational drift without blocking, shaming, summarizing, or sending browsing data away. The strongest parts of the modified version are its attempt to handle SPA navigation and its user-controlled ritual setting.

The main problem was not the product idea. It was **integration discipline**. The modified fork added several cross-file features at once, then renamed UI elements and message paths without running the complete extension-context tests. The result was a repository that looked more advanced in documentation than it was in executable reliability.

The restored direction is intentionally simpler. Content scripts receive only the compact state they need. Extension pages own garden-wide operations. The service worker remains the single state authority. The broad HTTP(S) host scope is retained because an all-web companion requires it; this is a declared product trade-off rather than hidden access. Chrome documents that content scripts are isolated by default, but still less trustworthy than the service worker, so message validation and privilege separation remain necessary [1].

## Verification

Fresh checks passed in the repaired worktree:

```text
node --check on every JavaScript file                         PASS
node test-runtime-contracts.mjs                              PASS
node test-state.mjs                                           PASS (11 tests)
node test-tree-layout.mjs                                     PASS
node test-security.mjs                                        PASS
node test-service-worker.mjs                                  PASS
node stress-service-worker.mjs                                PASS (96 nodes, 72 events)
Chromium --headless=new --load-extension=...                  PASS
```

The real Chromium smoke test loaded the unpacked Manifest V3 extension, injected the companion into an HTTP page, displayed the mission chip, and displayed the interruption choice card without console errors. The original broken fixture reproduced the missing `send` helper error; the repaired fixture did not.

## Intentional residual boundaries

The extension continues to request HTTP(S) host access because the companion is designed to appear across ordinary websites. Chrome warns that host permissions allow interaction with matching hosts and recommends optional permissions when the functionality permits [2]. Switching to `activeTab` would reduce installation scope but would also change Focus Forest from an always-available companion into a user-invoked tool, so that alternative is not silently adopted.

The repository still needs manual Chrome verification for restricted pages, redirect chains, browser restarts, multiple real windows, incognito/file access, high-contrast mode, zoom levels, and real SPA sites. These are runtime coverage gaps, not claims that the automated suite has already proven them.

## References

[1]: https://developer.chrome.com/docs/extensions/develop/concepts/messaging "Chrome Extensions: Message passing"
[2]: https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions "Chrome Extensions: Declare permissions"
[3]: https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts "Chrome Extensions: Manifest content scripts"
[4]: https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources "Chrome Extensions: Manifest web-accessible resources"
