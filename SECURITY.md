# Security Considerations

## Host Permissions

Focus Forest requests `host_permissions: ["http://*/*", "https://*/*"]` because the companion chip must be injected on every ordinary webpage to observe navigation signals, display mission state, and detect link activations. The extension does not read page content, inject scripts into frames, or exfiltrate data; it only renders a closed shadow-DOM chip and listens for trusted navigation events.

If the permission scope were narrowed, the companion would fail to appear on many sites, breaking the core browsing-companion experience.

## Default Search Provider

When the user leaves the first-step search setting on **Browser default**, the service worker uses Chromium's `search.query` API with the user's mission text. Focus Forest does not change the browser's search setting or install a search provider. Explicit provider choices are local overrides; browsers without the Search API use the documented URL fallback.

## WebNavigation Permission

The `webNavigation` permission is used solely to track `historyStateUpdated` events in SPAs (YouTube, Notion, Gmail, GitHub, etc.) so that in-page navigations update the branch depth correctly. No additional browsing data is collected through this API.

## Error Handling

The service worker sanitizes all error responses returned to content scripts. Internal error details are never exposed to page context; content scripts receive only a generic `INTERNAL_ERROR` code.

## Message Validation

All runtime messages are validated against explicit per-type schemas before processing. Sender identity is checked against `chrome.runtime.id` to reject external messages. Full snapshots and global settings writes are additionally restricted to senders whose URL is an extension page belonging to this extension. Destructive garden operations—clear data, session deletion, pruning, and compost deletion—use the same extension-page boundary. Chip-position messages take their identity (tab id and origin) exclusively from the validated sender tab, never from the payload, and coordinates are finite-checked and clamped. Malformed or unexpected messages are rejected without side effects.

## State Caching

The service worker caches the normalized state in memory between mutations to reduce `chrome.storage.local` round-trips. The cache is invalidated on mutation failures to prevent unpersisted changes from leaking into subsequent reads.

## State Canonicalization

Node tab associations are stored as `tabIds` arrays only. Legacy `tabId` fields are migrated to `tabIds` during state normalization. Node lookups always search the canonical `tabIds` array.

## Content Script Isolation

The companion chip renders inside a closed shadow root. Its styles are scoped to the shadow boundary and never leak into the host page. No external stylesheet or web-accessible resource is used for the companion. Static and dynamic companion content use DOM-safe construction with element creation, attributes, `textContent`, and `append`; the content script contains no `innerHTML` sink.

## Data Storage

All browsing signals, garden history, compost items, and optional mission notes stay in `chrome.storage.local`, bounded (12 gardens · 96 pages per garden · 80 compost items · 30 days of reward history). No remote servers, accounts, analytics, or external dependencies are used. The dashboard's delete-all-data action wipes the stored state and the theme preference together. Mission notes are never sent to page contexts: the companion learns only that a note exists.

## Companion Position Storage

The draggable chip's remembered position is held in extension-private session storage (`chrome.storage.session`) managed by the service worker — keyed by validated sender tab and origin, serialized, bounded, and cleared on tab close and browser exit. Host pages can never read it. On engines without `storage.session` it degrades to worker memory, never to page-readable storage.

## System Memory Permission

The `system.memory` permission is used solely by the optional Performance guardian: `chrome.system.memory.getInfo()` is read locally to calibrate when decorations should calm down. The value is never stored, never transmitted, and never combined with browsing data; where the API is absent the guardian falls back to device-memory class and the extension's own heap signals, and it can be turned off entirely in Settings.
