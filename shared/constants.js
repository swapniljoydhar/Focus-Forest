/**
 * Focus Forest - Centralized Constants
 * Extracts magic numbers and configuration values for maintainability
 */

// Calendar duration, independent of maintenance and rate-limit intervals.
export const DAY_MS = 86400000;

// Service Worker & Background Limits
export const SERVICE_WORKER = {
  NAVIGATION_HISTORY_SIZE: 64,
  NAVIGATION_HINTS_SIZE: 128,
  SESSION_TIMEOUT_MS: 15000, // 15 seconds
  RATE_LIMIT_WINDOW_MS: 60000, // 1 minute
  RATE_LIMIT_MAX_REQUESTS: 100,
  CLEANUP_INTERVAL_MS: 60000, // 1 minute
  MAX_ACTIVE_TABS: 1000,
  STORAGE_QUOTA_WARNING_MB: 4.5,
  STORAGE_QUOTA_MAX_MB: 5,
};

// Tree Layout & Visualization
export const TREE_LAYOUT = {
  GOLDEN_ANGLE: 137.508, // Degrees
  MAX_NODES_BEFORE_OPTIMIZE: 100,
  NODE_RADIUS_BASE: 12,
  NODE_RADIUS_MIN: 6,
  NODE_RADIUS_MAX: 20,
  BRANCH_WIDTH_BASE: 5,
  BRANCH_WIDTH_MIN: 2,
  BRANCH_WIDTH_MAX: 8,
  CANVAS_PADDING: 50,
  ELLIPSE_RATIO_X: 1.0,
  ELLIPSE_RATIO_Y: 0.8,
  SUNFLOWER_SCALE_FACTOR: 15,
  MAX_DEPTH_FOR_WIDTH: 5,
};

// Memory & Performance Limits
export const MEMORY_LIMITS = {
  LRU_CACHE_SIZE: 200,
  DOM_POOL_SIZE: 50,
  DEBOUNCE_DELAY_MS: 300,
  THROTTLE_DELAY_MS: 1000,
  MAX_RENDER_TIME_MS: 16, // 60fps target
  PROGRESSIVE_RENDER_BATCH: 50,
};

// Data Validation Limits
export const VALIDATION = {
  SESSION_ID_MAX_LENGTH: 160,
  SESSION_ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  URL_MAX_LENGTH: 2048,
  TITLE_MAX_LENGTH: 500,
  MAX_TIMESTAMP_AGE_YEARS: 5,
  MAX_NODE_DEPTH: 100,
  MAX_CHILDREN_PER_NODE: 500,
};

// Storage Keys
export const STORAGE_KEYS = {
  SESSIONS: 'focusforest_sessions',
  SETTINGS: 'focusforest_settings',
  META: 'focusforest_meta',
};

// Error Codes
export const ERROR_CODES = {
  STORAGE_QUOTA_EXCEEDED: 'STORAGE_QUOTA_EXCEEDED',
  INVALID_DATA_FORMAT: 'INVALID_DATA_FORMAT',
  RENDER_TIMEOUT: 'RENDER_TIMEOUT',
  CYCLIC_GRAPH_DETECTED: 'CYCLIC_GRAPH_DETECTED',
};
