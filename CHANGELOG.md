# Changelog

All notable Focus Forest changes are documented here.

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
