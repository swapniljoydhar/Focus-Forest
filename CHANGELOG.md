# Changelog

All notable Focus Forest changes are documented here.

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
