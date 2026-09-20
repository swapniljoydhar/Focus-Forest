# Changelog

All notable Focus Forest changes are documented here.

## [Unreleased]

### Fixed

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
