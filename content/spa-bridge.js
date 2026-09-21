/**
 * Focus Forest — MAIN-world SPA bridge.
 *
 * Registered in manifest.json with "world": "MAIN" (Chrome 111+), this tiny
 * classic script runs in the PAGE's JavaScript world, where it can wrap
 * history.pushState / history.replaceState. The isolated content-script world
 * cannot see page-initiated calls to those methods: assigning to `history.*`
 * there only shadows the method for the isolated world.
 *
 * The bridge carries NO payload. It re-announces each same-document history
 * write as a plain DOM CustomEvent, which crosses into the isolated world;
 * content/content.js listens for it and re-reads `location.href` and
 * `document.title` itself. A page therefore cannot smuggle data into the
 * extension through this channel, and dispatching a synthetic event without an
 * actual URL/title change is a no-op downstream (the isolated side only acts
 * when the URL or title really differs).
 *
 * The service worker independently observes these navigations through
 * chrome.webNavigation.onHistoryStateUpdated; this bridge exists so the
 * on-page companion chip updates immediately instead of waiting for the
 * 2.5 s polling fallback.
 */
(() => {
  'use strict';
  // Namespace matches the listener in content/content.js.
  const BRIDGE_EVENT = 'focus-forest-history';

  function announce() {
    try {
      document.dispatchEvent(new CustomEvent(BRIDGE_EVENT));
    } catch {
      // The document can be gone mid-teardown; the service worker's
      // webNavigation listener still covers the navigation itself.
    }
  }

  // Another extension's document_start MAIN-world script (or a hostile page
  // in a future injection order) could have removed or replaced these before
  // us; .bind on a non-function would throw uncaught on every page. Bail out
  // quietly — the worker's webNavigation events still cover SPA tracking.
  if (typeof history.pushState !== 'function' || typeof history.replaceState !== 'function') return;

  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  try {
    history.pushState = function pushState(...args) {
      const result = originalPushState(...args);
      announce();
      return result;
    };

    history.replaceState = function replaceState(...args) {
      const result = originalReplaceState(...args);
      announce();
      return result;
    };
  } catch {
    // A page can freeze or redefine History methods; this bridge runs in the
    // page world under 'use strict', where assigning to a non-writable
    // property throws. Losing the bridge is acceptable: the service worker's
    // webNavigation.onHistoryStateUpdated and the content script's polling
    // watch still cover SPA route changes on such pages.
  }
})();
