# Contributing to Intent Grove

Thank you for helping improve Intent Grove. The project is a local-first Chromium extension, so changes should preserve user agency, privacy, and the ability to run without a build step.

## Before opening a change

Run `npm ci`, then verify with `npm test` (13 unit/contract suites, no browser needed) plus the real-Chromium lanes `npm run test:dashboard`, `npm run test:extension`, `npm run test:features`, and `npm run test:spa-stress` (one-time `npx playwright install chromium` first) — see the README's Development section. For behavior changes, add a focused regression test before or alongside the implementation. Do not add remote analytics, page-content collection, AI services, or dependencies without documenting the product and privacy impact.

## Pull requests

Describe the user-facing problem, the smallest change that solves it, and the verification performed. Include screenshots for visual changes and note any Chromium-version or permission implications. Keep unrelated refactors out of the same change.

## Security

Please do not publish exploitable details in a public issue. Follow the reporting guidance in `SECURITY.md`.

## License

Intent Grove is licensed under **GNU GPL-3.0-or-later**. See [LICENSE](LICENSE) for the complete terms.

By submitting a contribution, you confirm that you have the right to submit it and agree that it is provided under the same GPL-3.0-or-later terms. Do not submit code, artwork, or other material that you cannot license under those terms.
