# Focus Forest

Focus Forest is a calm, local-first extension for Chromium-family browsers. You plant an intention — *"Compare laptops for university"* — then browse normally while it grows your session into a small garden. When useful research drifts into a rabbit hole, it quietly shows you how far you've wandered and offers a gentle set of choices. **It never blocks anything, never scores you, and nothing ever leaves your device.**

There is no generative AI, no summarizer, no remote model, and no page-content classifier — just a transparent branch model built from navigation signals. Focus Forest does not judge whether a page is relevant; the detour is yours to keep or drop.

## Quick install (any Chromium desktop browser)

1. Open your browser's extensions page — see the table below.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the `focus-forest` folder (the one containing `manifest.json`).
5. Open a new tab: the planting page appears. Brave, Edge, and Opera may ask you to confirm replacing their new-tab page. In Brave, **Shields can stay on** — never disable them as an install step.

| Browser | Extensions page | Notes |
| --- | --- | --- |
| **Chrome** / Chromium / Arc | `chrome://extensions` | Reference configuration. |
| **Brave** | `brave://extensions` | May ask to confirm the new-tab replacement. Shields stay on. |
| **Microsoft Edge** | `edge://extensions` | May ask to confirm the new-tab replacement. |
| **Opera** | `opera://extensions` | Ships Speed Dial; may ask to confirm the override. |
| **Vivaldi** | `vivaldi://extensions` | Start page is `chrome://vivaldi-webui/startpage`; may ask to confirm. |

After updating files, click **Reload** on the extension card, then refresh open web pages so they receive the updated companion.

## How it works

- **Plant a mission** on the new-tab page, with an optional private note about *why it matters today*. Your first step opens through your browser's own search provider (or a local override).
- **A small chip** keeps the mission visible on ordinary websites. Drag it anywhere; it remembers the spot for that site in that tab, and no website can read that (or anything else).
- **Links you follow grow branches.** The garden understands SPA route changes, new tabs, back/forward, and redirects without inventing depth.
- **When a branch gets deep,** the page settles slightly and the chip says so. At your choice threshold, a non-blocking corner card offers four equal choices: **Keep exploring · Return to my mission · Save this for later · Start a new mission.** Nothing is ever hidden or blocked.
- **Strict mode (opt-in)** adds firmer, factual copy — pages and minutes away from your intention, and a reminder that you wrote down *why*. The choices never change; accountability without shame.
- **Completed missions become storybook gardens** in the dashboard: every leaf is a real page. Trace a path home, prune, or compost. A garden's lushness reflects how closely the path stayed to your intention — a visual record, never a number.
- **Tending streaks** mark 3 / 7 / 14 / 30 active days with a quiet milestone line. Positive-only: a broken streak simply shows nothing.
- **Forest Finds (opt-in):** small offline discoveries when you return or choose deliberately; missions that stayed close to their intention can earn rarer seasonal details.
- **The companion follows your browser's light/dark preference**, and the whole extension respects reduced-motion settings.
- **Shortcuts:** `Alt+F` starts or ends a mission · `Alt+M` returns you to the mission origin.

## Settings ("Tend the forest")

| Setting | What it does |
| --- | --- |
| Quieter at *N* branches (2–8) | When the page first settles and the chip notes the depth. |
| Choice appears at *N* branches (3–10) | When the corner card offers its four choices (always ≥ quieter + 1). |
| Hold me to my word (Strict mode) | Firmer factual reminders; choices unchanged; never blocks. |
| Let leaves and branches move softly | Ambient motion; also follows your system reduced-motion preference. |
| Growth ritual | When the tiny branch-growth animation plays (once per mission / every branch / never). |
| Performance guardian + sensitivity (1–5) | Automatically calms animations and rituals under memory pressure. Tracking, the chip, and your data always keep working. Uses real free system memory where the browser exposes it, plus device class and the extension's own heap as fallbacks — all read locally, shown live in Settings. |
| First-step search engine | Your browser's default, or a local override (Google, Bing, DuckDuckGo, Brave Search, Startpage). |
| Pause the companion on these sites | One hostname per line (up to 40); hides the companion there, deletes nothing. |
| Occasional quiet discoveries | Enables Forest Finds. Never scores, never punishments. |

## Privacy

- **Everything stays on your device** in `chrome.storage.local`. No servers, no analytics, no accounts, no cloud sync of browsing data.
- Only **URL/title metadata** is stored — never page text.
- Local history is **bounded**: 12 gardens · 96 pages per garden · 80 compost items · 30 days of reward history.
- **Delete-all-data** in the dashboard wipes everything, including the theme preference.
- The chip's drag position lives in **extension-private session storage** — host pages cannot read it; it clears when the tab or browser session ends.
- Your mission note never leaves the worker: the companion only learns *that* a note exists, never its text.
- Duration statistics are elapsed time between starting and ending a mission — no foreground-tab or keyboard/mouse activity tracking.

## Browser support

Desktop Chromium: **Chrome, Brave, Edge, Opera, Vivaldi** (and Chromium/Arc). Not Firefox. The engine floor is Chromium 111; on a fork shipping an older engine the extension still works — SPA route tracking just falls back to a slightly slower path. Automated tests run in Chromium; a manual walkthrough per fork is required before store submission (see the roadmap).

**Troubleshooting.** Another new-tab extension (or the browser's own start-page setting) can own the same override — check which extension is enabled if the planting page doesn't appear. If the companion chip is missing on a site, check the extension's site access and refresh the page after reloading the extension. Browser-internal pages (`chrome://…`, `brave://extensions`, …) never run the companion, by design.

## Roadmap

Committed next (owner-confirmed direction): the accountability layer is **shipped** — Strict mode, drift accounting, garden health, extended Forest Finds, and streak milestones. Remaining priorities from the 2026-09-22 audit:

| # | Item | Status |
| --- | --- | --- |
| 1 | Per-fork manual QA pass (Brave, Edge, Opera, Vivaldi) driven by a generated checklist script — required before store submission | Planned (owner) |
| 2 | Throttle title-only SPA updates (coalesce same-URL title changes to at most one message pair per 5 s) to protect the message budget on title-mutating sites | **Shipped 2026-09-22** — pinned by Gate 7 in real Chromium |
| 3 | Automated coverage for the untested branches of the chip-position system: `pagehide` flush, rate-limit retry, clear-data theme guard | Planned — rate-limit branch covered; flush + theme guard remain manual-checklist items |
| 4 | Popup error state distinct from the empty state; settings rewards copy re-synced when streaks ship | **Shipped 2026-09-22** — retry affordance in the popup; rewards copy now truthful about streaks |
| 5 | Dark-mode companion chip (`prefers-color-scheme`) and a `return-to-mission` keyboard command | **Shipped 2026-09-22** — Alt+M returns to the mission origin |

## Development

No build step, no runtime dependencies — plain HTML/CSS/JS modules. Playwright is dev-only (browser test lanes); an existing Chromium binary can be selected with `CHROMIUM_EXECUTABLE_PATH`.

```bash
npm ci                        # dev toolchain only
npm test                      # 13 unit/contract suites, no browser required
npx playwright install chromium
npm run test:dashboard        # dashboard UI in real Chromium
npm run test:extension        # loads the real manifest (11 gates)
npm run test:features         # end-to-end walk of every user surface (13 steps)
npm run test:spa-stress       # 50 rapid history.pushState transitions
npm run profile:performance   # memory/perf gate for the New Tab page
npm run package               # writes dist/focus-forest.zip (the store artifact)
npm run preview:trees         # local gallery of the real SVG tree renderer
```

## Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — the engineering deep dive: file structure, navigation semantics, Chromium integration notes, permissions rationale, accessibility engineering, garden rendering, tab/history behavior, memory and performance design, security & reliability implementation, and the full test-lane inventory.
- **[CHANGELOG.md](CHANGELOG.md)** — complete release history, including the v0.3.6 notes previously duplicated in this README.
- **[SECURITY.md](SECURITY.md)** · original [security review](SECURITY_REVIEW_2026-08-15.md) · [modified-fork audit](AUDIT_REPORT_2026-08-16.md) · [September 2026 audit](AUDIT_2026-09-21.md)
- **[CHROMEWEBSTORE.md](CHROMEWEBSTORE.md)** — store listing copy and per-permission justification · **[CONTRIBUTING.md](CONTRIBUTING.md)**
