/**
 * Focus Forest - Centralized Constants
 * Extracts magic numbers and configuration values for maintainability.
 *
 * Only values actually referenced by runtime code live here. Previous
 * revisions kept several mirrors (a second storage-quota threshold pair,
 * debounce/pool sizes, id-pattern duplicates) that were never read and had
 * drifted from the values the code enforces; they were removed.
 *
 * - Storage quota thresholds live in shared/state.js
 *   (STORAGE_QUOTA_WARNING_THRESHOLD / STORAGE_QUOTA_CRITICAL_THRESHOLD).
 * - ID and text length rules live in shared/state.js (LIMITS) and are applied
 *   at validation time (compactText/safeId/safeHttpUrl).
 */

// Calendar duration, independent of maintenance and rate-limit intervals.
export const DAY_MS = 86400000;

// Service Worker & Background Limits
export const SERVICE_WORKER = {
  SESSION_TIMEOUT_MS: 15000, // 15 seconds
  RATE_LIMIT_WINDOW_MS: 60000, // 1 minute
  RATE_LIMIT_MAX_REQUESTS: 100,
  MAX_ACTIVE_TABS: 1000,
};

// Tree Layout & Visualization
export const TREE_LAYOUT = {
  GOLDEN_ANGLE: 137.508, // Degrees
  NODE_RADIUS_BASE: 12,
  NODE_RADIUS_MIN: 6,
  BRANCH_WIDTH_BASE: 5,
  BRANCH_WIDTH_MIN: 2,
  // Nodes first seen within this window render as fresh buds instead of
  // full leaves. Own constant on purpose: this previously borrowed
  // SERVICE_WORKER.RATE_LIMIT_WINDOW_MS, silently coupling a visual choice to
  // an unrelated messaging limit.
  RECENT_NODE_WINDOW_MS: 60000,
};

// Memory & Performance Limits
export const MEMORY_LIMITS = {
  LRU_CACHE_SIZE: 200,
  THROTTLE_DELAY_MS: 1000,
};

// Data Validation Limits
export const VALIDATION = {
  MAX_TIMESTAMP_AGE_YEARS: 5,
  // Imported timestamps may sit slightly in the future (clock skew on the
  // exporting machine). Tolerated skew for import validation, in milliseconds.
  MAX_TIMESTAMP_FUTURE_MS: 60000,
};

// Storage Keys and error codes live in shared/state.js (STORAGE_KEY) and
// shared/error-tracing.js (ERROR_CATEGORIES); keeping duplicates here invited
// drift, so the unused mirrors were removed.
