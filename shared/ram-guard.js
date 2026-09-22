/**
 * Focus Forest — memory-aware performance guardian.
 *
 * Signal priority (all local, never transmitted):
 *   1. chrome.system.memory.getInfo() — real system free RAM (extensions
 *      API, Chrome 91+, "system.memory" permission). Sampled by the service
 *      worker (relayed to the companion via the active view) and directly on
 *      extension pages.
 *   2. navigator.deviceMemory — coarse, capped device-memory class; the
 *      fallback where system.memory is absent (forks, older engines).
 *   3. performance.memory — this context's own JS heap. Inside a page this
 *      is the same renderer-heap value per-tab memory monitors obtain via
 *      script injection; the companion reads it for free because it already
 *      lives in the page's renderer — no "scripting" permission, no probing
 *      of frozen tabs.
 *
 * The guardian only ever calms decorations (animations, rituals, reveals);
 * core functionality — tracking, companion, choices, local data — always
 * keeps working. All sampling is guarded and never throws; missing signals
 * degrade to "no evidence" = normal mode. No timers, no polling: contexts
 * sample on load and on user-driven refreshes only, and the worker refreshes
 * its cached system sample at most once per 30 s from paths that already run.
 * Release hysteresis prevents mode flapping on noisy near-threshold samples.
 */

// Sensitivity levels 1..5: higher calms decorations earlier. systemFloor is
// the free-system-RAM ratio at or below which decorations rest; heapCeiling
// is a fraction of this context's own JS heap limit; deviceFloorGb is the
// navigator.deviceMemory bucket (GB) treated as low-memory.
const GUARD_LEVELS = [
  { heapCeiling: 0.9, deviceFloorGb: 0.25, systemFloor: 0.03 },
  { heapCeiling: 0.8, deviceFloorGb: 0.5, systemFloor: 0.05 },
  { heapCeiling: 0.7, deviceFloorGb: 1, systemFloor: 0.08 },
  { heapCeiling: 0.6, deviceFloorGb: 2, systemFloor: 0.12 },
  { heapCeiling: 0.5, deviceFloorGb: 4, systemFloor: 0.18 }
];
const HEAP_RELEASE_BAND = 0.05;
const SYSTEM_RELEASE_BAND = 0.03;

function levelFor(settings) {
  return GUARD_LEVELS[Math.max(1, Math.min(5, Number(settings?.ramGuardLevel) || 3)) - 1];
}

/** Sample the synchronous context signals; each is null when not exposed. */
export function sampleMemoryPressure() {
  const deviceGb = Number.isFinite(globalThis.navigator?.deviceMemory) ? globalThis.navigator.deviceMemory : null;
  const mem = globalThis.performance?.memory;
  const heapRatio = mem && Number.isFinite(mem.jsHeapSizeLimit) && mem.jsHeapSizeLimit > 0 && Number.isFinite(mem.usedJSHeapSize)
    ? mem.usedJSHeapSize / mem.jsHeapSizeLimit
    : null;
  return { deviceGb, heapRatio };
}

/**
 * Sample real system memory where the browser exposes it (extension contexts
 * holding the "system.memory" permission). Returns null when absent or on
 * failure — never throws, never stores, never transmits.
 */
export async function sampleSystemMemory() {
  try {
    if (!globalThis.chrome?.system?.memory?.getInfo) return null;
    const info = await chrome.system.memory.getInfo();
    const capacity = Number(info?.capacity);
    const available = Number(info?.availableCapacity);
    if (!Number.isFinite(capacity) || capacity <= 0 || !Number.isFinite(available)) return null;
    return { freeRatio: Math.max(0, Math.min(1, available / capacity)), totalGb: +(capacity / 1073741824).toFixed(1), freeGb: +(available / 1073741824).toFixed(1) };
  } catch { return null; }
}

/** Pure decision: 'reduced' only on positive evidence (or reduced-motion). */
export function resolvePerfMode(settings, sample, prefersReducedMotion = false) {
  if (prefersReducedMotion) return 'reduced';
  if (!settings || settings.ramGuard === false) return 'normal';
  const level = levelFor(settings);
  if (Number.isFinite(sample?.freeRatio) && sample.freeRatio <= level.systemFloor) return 'reduced';
  if (Number.isFinite(sample?.deviceGb) && sample.deviceGb <= level.deviceFloorGb) return 'reduced';
  if (Number.isFinite(sample?.heapRatio) && sample.heapRatio >= level.heapCeiling) return 'reduced';
  return 'normal';
}

/**
 * Hysteresis wrapper: engage on any positive evidence of pressure; release
 * only once measurable signals sit clearly below their thresholds. Without
 * this, a noisy heap sample near the ceiling would flap the UI between modes
 * on every refresh. An opt-out releases immediately.
 */
export function nextPerfMode(previousMode, settings, sample, prefersReducedMotion = false) {
  if (resolvePerfMode(settings, sample, prefersReducedMotion) === 'reduced') return 'reduced';
  if (previousMode !== 'reduced') return 'normal';
  if (!settings || settings.ramGuard === false) return 'normal';
  const level = levelFor(settings);
  if (Number.isFinite(sample?.heapRatio) && sample.heapRatio >= level.heapCeiling - HEAP_RELEASE_BAND) return 'reduced';
  if (Number.isFinite(sample?.freeRatio) && sample.freeRatio <= level.systemFloor + SYSTEM_RELEASE_BAND) return 'reduced';
  return 'normal';
}

/** Apply the mode to the current page; CSS/JS key off body[data-perf]. */
export function applyPerfMode(mode) {
  try { document.body.dataset.perf = mode === 'reduced' ? 'reduced' : 'normal'; } catch { /* no DOM in some contexts */ }
}
