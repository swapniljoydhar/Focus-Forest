/**
 * Focus Forest — memory-aware performance guardian.
 *
 * Chromium gives extensions no API to read system-wide free RAM. The honest
 * signals available in every JS context are:
 *   - navigator.deviceMemory: a coarse, capped device-memory class (GB)
 *   - performance.memory: this extension context's own JS heap
 * The guardian combines both with the user's sensitivity setting so pages can
 * drop decorations (animations, rituals, reveals) while core functionality —
 * tracking, companion, choices, local data — always keeps running. All
 * sampling is guarded; where a signal is missing (Node tests, some contexts)
 * it degrades to "no evidence" = normal mode. Never a network call, never a
 * timer: contexts sample on load and on user-driven refreshes only.
 */

// Sensitivity levels 1..5: higher calms decorations earlier. heapCeiling is a
// fraction of this context's own JS heap limit; deviceFloorGb is the
// navigator.deviceMemory bucket (GB) treated as low-memory for that level.
const GUARD_LEVELS = [
  { heapCeiling: 0.9, deviceFloorGb: 0.25 },
  { heapCeiling: 0.8, deviceFloorGb: 0.5 },
  { heapCeiling: 0.7, deviceFloorGb: 1 },
  { heapCeiling: 0.6, deviceFloorGb: 2 },
  { heapCeiling: 0.5, deviceFloorGb: 4 }
];

/** Sample the available memory signals; each is null when not exposed. */
export function sampleMemoryPressure() {
  const deviceGb = Number.isFinite(globalThis.navigator?.deviceMemory) ? globalThis.navigator.deviceMemory : null;
  const mem = globalThis.performance?.memory;
  const heapRatio = mem && Number.isFinite(mem.jsHeapSizeLimit) && mem.jsHeapSizeLimit > 0 && Number.isFinite(mem.usedJSHeapSize)
    ? mem.usedJSHeapSize / mem.jsHeapSizeLimit
    : null;
  return { deviceGb, heapRatio };
}

/**
 * Pure decision, 'reduced' only on positive evidence of pressure (or a
 * reduced-motion preference). An opt-out (ramGuard === false) always wins.
 * @param {{ramGuard?: boolean, ramGuardLevel?: number}|null} settings
 * @param {{deviceGb?: number|null, heapRatio?: number|null}|null} sample
 * @param {boolean} [prefersReducedMotion]
 * @returns {'normal'|'reduced'}
 */
export function resolvePerfMode(settings, sample, prefersReducedMotion = false) {
  if (prefersReducedMotion) return 'reduced';
  if (!settings || settings.ramGuard === false) return 'normal';
  const level = GUARD_LEVELS[Math.max(1, Math.min(5, Number(settings.ramGuardLevel) || 3)) - 1];
  if (Number.isFinite(sample?.deviceGb) && sample.deviceGb <= level.deviceFloorGb) return 'reduced';
  if (Number.isFinite(sample?.heapRatio) && sample.heapRatio >= level.heapCeiling) return 'reduced';
  return 'normal';
}

/** Apply the mode to the current page; CSS/JS key off body[data-perf]. */
export function applyPerfMode(mode) {
  try { document.body.dataset.perf = mode === 'reduced' ? 'reduced' : 'normal'; } catch { /* no DOM in some contexts */ }
}
