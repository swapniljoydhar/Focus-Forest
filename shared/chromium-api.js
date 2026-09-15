// Chromium browsers expose the extension API as `chrome.*`.
// Edge and Opera also provide the WebExtensions `browser.*` alias.
if (typeof globalThis !== 'undefined' && globalThis.chrome == null && globalThis.browser != null) {
  globalThis.chrome = globalThis.browser;
}
