# Contributing to Focus Forest

Thank you for helping improve Focus Forest. The project is a local-first Chromium extension, so changes should preserve user agency, privacy, and the ability to run without a build step.

## Before opening a change

Run `npm ci`, then run `npm test` and `npm run test:dashboard`. For behavior changes, add a focused regression test before or alongside the implementation. Do not add remote analytics, page-content collection, AI services, or dependencies without documenting the product and privacy impact.

## Pull requests

Describe the user-facing problem, the smallest change that solves it, and the verification performed. Include screenshots for visual changes and note any Chromium-version or permission implications. Keep unrelated refactors out of the same change.

## Security

Please do not publish exploitable details in a public issue. Follow the reporting guidance in `SECURITY.md`.

## License

Add or review the repository license before accepting external contributions. Contributions should be accepted only under terms that match the chosen project license.
