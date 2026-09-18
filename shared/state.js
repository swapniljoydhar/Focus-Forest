import './chromium-api.js';
import { logError, logWarning, logCritical, ERROR_CATEGORIES } from './error-tracing.js';

export const STORAGE_KEY = 'focusForestState';
export const SCHEMA_VERSION = 4; // Incremented for reward system
export const LIMITS = { SESSIONS: 12, NODES_PER_SESSION: 96, EVENTS_PER_SESSION: 72, COMPOST: 80, TITLE: 120, MISSION_NOTE: 280, URL: 1024 };
export const DEFAULT_SETTINGS = { gentleDepth: 4, choiceDepth: 5, ambientMotion: true, growthAnimationTrigger: 'mission-origin', excludedSites: [], searchEngine: 'default', enableRewards: false };
export const STORAGE_QUOTA_WARNING_THRESHOLD = 4 * 1024 * 1024; // 4MB warning threshold
export const STORAGE_QUOTA_CRITICAL_THRESHOLD = 7 * 1024 * 1024; // 7MB critical threshold (Chrome's limit is ~8MB)

/**
 * Curated offline reward catalog - deterministic, bounded, meaningful
 * Rewards reinforce reflection and intentional choice, not browsing duration
 */
export const REWARD_CATALOG = {
  // Seed tier: Returning to mission root
  seeds: [
    { id: 'seed_1', text: 'The root is still here.', icon: '🌱' },
    { id: 'seed_2', text: 'You remembered your intention.', icon: '🌰' },
    { id: 'seed_3', text: 'A clear beginning awaits.', icon: '🍃' },
    { id: 'seed_4', text: 'Return is a form of progress.', icon: '🌿' }
  ],
  // Leaf tier: Making intentional choices at intervention points
  leaves: [
    { id: 'leaf_1', text: 'You noticed the branch.', icon: '🍁' },
    { id: 'leaf_2', text: 'A clear choice is a form of progress.', icon: '🌾' },
    { id: 'leaf_3', text: 'Curiosity preserved with care.', icon: '🌻' },
    { id: 'leaf_4', text: 'You chose deliberately.', icon: '🌷' },
    { id: 'leaf_5', text: 'Awareness blooms here.', icon: '🌸' },
    { id: 'leaf_6', text: 'This branch taught you something.', icon: '🍂' }
  ],
  // Bloom tier: Completing or resting a mission
  blooms: [
    { id: 'bloom_1', text: 'Your garden grows with intention.', icon: '🌺' },
    { id: 'bloom_2', text: 'A session tended with care.', icon: '🌹' },
    { id: 'bloom_3', text: 'The forest remembers this path.', icon: '🌳' },
    { id: 'bloom_4', text: 'Seasons change, wisdom remains.', icon: '🍄' },
    { id: 'bloom_5', text: 'A new pattern takes root.', icon: '🪴' }
  ],
  // Special discoveries: Rare seasonal details
  discoveries: [
    { id: 'disc_1', text: 'A visiting bird left a feather.', icon: '🐦' },
    { id: 'disc_2', text: 'Morning dew catches the light.', icon: '💧' },
    { id: 'disc_3', text: 'A mushroom appears after rain.', icon: '🍄' },
    { id: 'disc_4', text: 'Seasonal berries ripen quietly.', icon: '🫐' }
  ]
};

// Reward cooldowns and limits
export const REWARD_LIMITS = {
  COOLDOWN_MS: 5 * 60 * 1000, // 5 minutes between rewards
  MAX_PER_SESSION: 3, // Maximum rewards per session
  REWARD_HISTORY_DAYS: 30 // Keep reward history for 30 days
};

/**
 * Explains why a reward appeared. Rewards stay informational rather than
 * controlling: each note names the choice the user made, never a score,
 * a duration or a deadline.
 */
export const REWARD_TRIGGER_NOTES = {
  return_to_root: 'You came back to the intention you set.',
  compost_choice: 'You chose to keep this for later instead of following it now.',
  session_end: 'You set the garden down deliberately.',
  mission_changed: 'You noticed a new direction and let this garden rest.'
};

/**
 * Resolves the explanation for a reward trigger.
 * @param {string} trigger - Trigger recorded when the reward was earned.
 * @returns {string} Explanation, or an empty string when unknown.
 */
export function rewardNote(trigger) {
  if (typeof trigger !== 'string' || !trigger) return '';
  if (REWARD_TRIGGER_NOTES[trigger]) return REWARD_TRIGGER_NOTES[trigger];
  // Session endings are recorded as session_end_<reason>.
  if (trigger.startsWith('session_end')) return REWARD_TRIGGER_NOTES.session_end;
  return '';
}

/**
 * Chooses the tier for a reward earned by returning to the mission root.
 * A return from at or beyond the choice threshold earns a rare discovery;
 * any other return earns a seed. This is contextual and deterministic on
 * purpose: rewards stay explainable, and randomness is never amplified to
 * drive engagement.
 * @param {object} state - Current application state.
 * @returns {string} Tier name present in REWARD_CATALOG.
 */
export function returnRewardTier(state) {
  const session = activeSession(state);
  if (!session) return 'seeds';
  // Depth is structural distance from the root, not a judgement about a page.
  const deepest = Math.max(0, ...(session.nodes || []).map((node) => Number(node?.depth) || 0));
  const { choiceDepth } = normalizeSettings(state.settings);
  return deepest >= choiceDepth ? 'discoveries' : 'seeds';
}

/**
 * Resolves stored reward records into displayable finds. History keeps only
 * ids and timestamps, so catalog text is looked up rather than persisted.
 * @param {Array<{rewardId: string, timestamp: number}>} history - Stored records.
 * @param {number} [limit=12] - Maximum finds to return, newest first.
 * @returns {Array<{id: string, text: string, icon: string, tier: string, at: number}>} Finds.
 */
export function rewardHistoryView(history, limit = 12) {
  if (!Array.isArray(history)) return [];
  const catalogById = new Map();
  for (const tier of Object.keys(REWARD_CATALOG)) {
    for (const item of REWARD_CATALOG[tier]) catalogById.set(item.id, { ...item, tier });
  }
  return history
    .filter((record) => record && typeof record.rewardId === 'string' && Number.isFinite(record.timestamp))
    .slice(-limit)
    .reverse()
    .map((record) => {
      const found = catalogById.get(record.rewardId);
      // Unknown ids (for example from an older catalog) are skipped, not shown blank.
      return found ? { id: found.id, text: found.text, icon: found.icon, tier: found.tier, at: record.timestamp } : null;
    })
    .filter(Boolean);
}

/**
 * Returns a fresh empty state object with default settings.
 * @returns {object} Empty state matching the current schema version.
 */
export function emptyState() {
  return { 
    schemaVersion: SCHEMA_VERSION, 
    activeSessionId: null, 
    sessions: [], 
    compostItems: [], 
    settings: { interventionsPaused: false, ...DEFAULT_SETTINGS }, 
    onboardingCompleted: false,
    rewardHistory: [] // Track earned rewards with timestamps
  };
}

/**
 * Generates a unique ID with an optional prefix.
 * @param {string} [prefix='id'] - Prefix for the generated ID.
 * @returns {string} Unique identifier string.
 */
export function makeId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Truncates and normalizes whitespace in a text value.
 * @param {string} value - Raw text value.
 * @param {number} [max=LIMITS.TITLE] - Maximum allowed length.
 * @returns {string} Compacted text.
 */
export function compactText(value, max = LIMITS.TITLE) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const TRACKING_PARAMETERS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'msclkid']);
const SEARCH_DOMAINS = new Set(['google', 'bing', 'duckduckgo', 'yahoo', 'startpage', 'brave', 'baidu', 'yandex', 'ecosia', 'qwant']);
const SEARCH_PARAMS = new Set(['q', 'search', 'query', 'p']);

/**
 * Determines whether a URL is a search engine result page.
 * Excludes non-search Google subdomains (Gmail, Drive, Docs, etc.).
 * @param {string} value - URL to test.
 * @returns {boolean} True if the URL is a search result page.
 */
export function isSearchUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    // Google: only match actual search pages, not Gmail/Drive/Docs/Calendar etc.
    if (/^(www\.)?google\.[a-z.]+$/i.test(host)) {
      return /^\/(search|webhp)(\/|$|\?)/.test(url.pathname) || url.searchParams.has('q');
    }
    const baseDomain = host.split('.').slice(-2, -1)[0];
    if (SEARCH_DOMAINS.has(baseDomain) && baseDomain !== 'google') {
      if (baseDomain === 'brave' && url.pathname === '/') return true;
      const isSearchPath = /^\/(search|web|results?)(\/|$)/i.test(url.pathname);
      const hasSearchParam = [...url.searchParams.keys()].some((key) => SEARCH_PARAMS.has(key.toLowerCase()));
      return isSearchPath || hasSearchParam;
    }
    return false;
  } catch { return false; }
}

/**
 * Strips tracking parameters and returns a clean canonical URL.
 * @param {string} value - Raw URL string.
 * @returns {string|null} Sanitized URL or null if invalid.
 */
export function canonicalUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    url.hash = '';
    [...url.searchParams.keys()].forEach((key) => { if (TRACKING_PARAMETERS.has(key.toLowerCase())) url.searchParams.delete(key); });
    return url.href.length <= LIMITS.URL ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Validates and sanitizes an HTTP/HTTPS URL.
 * @param {string} value - Raw URL string.
 * @returns {string|null} Safe URL or null if invalid.
 */
export function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return canonicalUrl(url.href);
  } catch {
    return null;
  }
}

/**
 * Maps a depth value to a visual/behavioral state label.
 * @param {number} depth - Current branch depth.
 * @param {boolean} [paused=false] - Whether interventions are paused.
 * @param {object} [thresholds=DEFAULT_SETTINGS] - Depth thresholds.
 * @returns {string} One of 'paused', 'interrupted', 'desaturated', or 'normal'.
 */
export function getDepthState(depth, paused = false, thresholds = DEFAULT_SETTINGS) {
  if (paused) return 'paused';
  if (depth >= thresholds.choiceDepth) return 'interrupted';
  if (depth >= thresholds.gentleDepth) return 'desaturated';
  return 'normal';
}

/**
 * Finds the currently active session in a state object.
 * @param {object} state - Focus Forest state.
 * @returns {object|null} Active session or null.
 */
export function activeSession(state) {
  return state.sessions.find((session) => session.id === state.activeSessionId) || null;
}

const SAFE_STATES = new Set(['normal', 'desaturated', 'interrupted', 'paused', 'pruned', 'composted']);
const SAFE_CONFIDENCE = new Set(['direct', 'tab-inferred', 'external']);
const SAFE_NAVIGATION_KINDS = new Set(['mission-origin', 'link', 'new-tab-link', 'spa', 'search', 'known-page', 'manual', 'reload', 'back-forward', 'redirect', 'external']);
const SAFE_REASONS = new Set(['user_ended', 'mission_changed', 'browse_without_mission']);
/** Canonical fallback when a session origin is missing or unsafe. Chromium NTP aliases are accepted separately. */
export const DEFAULT_NEW_TAB_URL = 'chrome://newtab';
const NEW_TAB_HOSTS_BY_PROTOCOL = {
  'chrome:': new Set(['newtab', 'new-tab-page', 'new-tab-page-third-party']),
  'brave:': new Set(['newtab']),
  'edge:': new Set(['newtab']),
  'opera:': new Set(['newtab', 'startpage']),
  'vivaldi:': new Set(['newtab', 'startpage']),
  'chromium:': new Set(['newtab'])
};

function extensionRuntimeId() {
  return typeof chrome !== 'undefined' && typeof chrome.runtime?.id === 'string' ? chrome.runtime.id : null;
}

/**
 * Accept only Chromium new-tab placeholders, never settings/history/other privileged pages.
 * Covers Chrome, Brave, Edge, Opera, Vivaldi, and generic Chromium.
 */
export function isBrowserNewTabUrl(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port) return false;
    const protocol = url.protocol.toLowerCase();
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, '') || '';
    if (protocol === 'chrome:' && host === 'vivaldi-webui' && path === '/startpage') return true;
    const hosts = NEW_TAB_HOSTS_BY_PROTOCOL[protocol];
    if (!hosts || !hosts.has(host)) return false;
    return path === '';
  } catch {
    return false;
  }
}

/** True when the URL is this extension's New Tab override page. */
export function isExtensionNewTabUrl(value, extensionId = extensionRuntimeId()) {
  if (typeof value !== 'string' || !extensionId) return false;
  const match = /^chrome-extension:\/\/([a-z0-9-]+)\/newtab(?:\/|$)/i.exec(value);
  return Boolean(match && match[1].toLowerCase() === String(extensionId).toLowerCase());
}

/** True when a stored origin is still a placeholder waiting for the first ordinary webpage. */
export function isPlaceholderOriginUrl(value, extensionId = extensionRuntimeId()) {
  return isBrowserNewTabUrl(value) || isExtensionNewTabUrl(value, extensionId);
}

/**
 * Validates a URL for safe session storage.
 * Accepts HTTP(S), Chromium new-tab placeholders, and the current extension origin.
 * @param {string} value - Raw URL string.
 * @returns {string|null} Safe URL or null if invalid.
 */
export function safeSessionUrl(value) {
  const raw = String(value || ''); const http = safeHttpUrl(raw); if (http) return http;
  if (isBrowserNewTabUrl(raw)) return raw;
  const extensionMatch = /^chrome-extension:\/\/([a-z0-9-]+)\/(.*)$/i.exec(raw);
  const extensionId = extensionRuntimeId();
  if (extensionMatch && extensionId && extensionMatch[1].toLowerCase() === String(extensionId).toLowerCase()) return raw.length <= LIMITS.URL ? raw : null;
  return null;
}
function compactNode(node) {
  if (!node || typeof node !== 'object') return null;
  const id = compactText(node.id, 120); const url = safeSessionUrl(node.url); if (!id || !url) return null;
  const parentId = typeof node.parentId === 'string' && node.parentId !== id ? compactText(node.parentId, 120) : null;
  return { id, tabIds: Array.isArray(node.tabIds) ? node.tabIds.filter(Number.isInteger).slice(-8) : Number.isInteger(node.tabId) ? [node.tabId] : [], url, title: compactText(node.title || url, LIMITS.TITLE), parentId, depth: Math.max(0, Math.min(LIMITS.NODES_PER_SESSION, Number(node.depth) || 0)), firstSeenAt: Number.isFinite(node.firstSeenAt) ? node.firstSeenAt : Date.now(), relationshipConfidence: SAFE_CONFIDENCE.has(node.relationshipConfidence) ? node.relationshipConfidence : 'external', confidence: ['high', 'medium', 'low'].includes(node.confidence) ? node.confidence : (node.relationshipConfidence === 'direct' ? 'high' : node.relationshipConfidence === 'tab-inferred' ? 'medium' : 'low'), navigationKind: SAFE_NAVIGATION_KINDS.has(node.navigationKind) ? node.navigationKind : 'external', state: SAFE_STATES.has(node.state) ? node.state : 'normal', ...(Number.isFinite(node.closedAt) ? { closedAt: node.closedAt } : {}), ...(Number.isFinite(node.prunedAt) ? { prunedAt: node.prunedAt } : {}) };
}
function compactEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const type = compactText(event.type, 64); if (!type) return null;
  const result = { id: compactText(event.id, 120), type, at: Number.isFinite(event.at) ? event.at : Date.now() };
  if (typeof event.nodeId === 'string') result.nodeId = compactText(event.nodeId, 120);
  if (typeof event.mission === 'string') result.mission = compactText(event.mission, 140);
  if (typeof event.url === 'string' && safeHttpUrl(event.url)) result.url = safeHttpUrl(event.url);
  if (Number.isFinite(event.depth)) result.depth = Math.max(0, Math.min(LIMITS.NODES_PER_SESSION, Number(event.depth) || 0));
  if (SAFE_REASONS.has(event.reason)) result.reason = event.reason;
  return result;
}
function compactSession(session) {
  if (!session || typeof session !== 'object') return null;
  const id = compactText(session.id, 120); if (!id) return null;
  const status = session.status === 'completed' ? 'completed' : 'active';
  return { id, mission: compactText(session.mission, 140), note: compactText(session.note, LIMITS.MISSION_NOTE), status, startedAt: Number.isFinite(session.startedAt) ? session.startedAt : Date.now(), endedAt: Number.isFinite(session.endedAt) ? session.endedAt : null, endReason: SAFE_REASONS.has(session.endReason) ? session.endReason : null, origin: { tabId: Number.isInteger(session.origin?.tabId) ? session.origin.tabId : null, windowId: Number.isInteger(session.origin?.windowId) ? session.origin.windowId : null, url: safeSessionUrl(session.origin?.url) || DEFAULT_NEW_TAB_URL, title: compactText(session.origin?.title || 'New Tab', LIMITS.TITLE) }, nodes: Array.isArray(session.nodes) ? session.nodes.slice(-LIMITS.NODES_PER_SESSION).map(compactNode).filter(Boolean) : [], events: Array.isArray(session.events) ? session.events.slice(-LIMITS.EVENTS_PER_SESSION).map(compactEvent).filter(Boolean) : [], activeIntervals: Array.isArray(session.activeIntervals) ? session.activeIntervals.filter((entry) => Number.isInteger(entry?.tabId) && Number.isFinite(entry?.startedAt)).slice(-128).map((entry) => ({ tabId: entry.tabId, windowId: Number.isInteger(entry.windowId) ? entry.windowId : null, startedAt: entry.startedAt, endedAt: Number.isFinite(entry.endedAt) ? entry.endedAt : null })) : [], pendingRedirects: Array.isArray(session.pendingRedirects) ? session.pendingRedirects.filter((entry) => Number.isInteger(entry?.tabId) && typeof entry?.parentId === 'string').slice(-4).map((entry) => ({ tabId: entry.tabId, parentId: compactText(entry.parentId, 120), createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now() })) : [], interventionPaused: Boolean(session.interventionPaused) };
}

/**
 * Normalizes raw persisted state into the current schema shape.
 * Trims arrays to LIMITS, sanitizes URLs, and coerces types.
 * @param {object} value - Raw state from storage.
 * @returns {object} Normalized state object.
 */
export function normalizeState(value) {
  const fallback = emptyState();
  if (!value || typeof value !== 'object') return fallback;
  const sessions = Array.isArray(value.sessions) ? value.sessions.map(compactSession).filter(Boolean).slice(-LIMITS.SESSIONS) : [];
  const activeSessionId = sessions.some((session) => session.id === value.activeSessionId) ? value.activeSessionId : null;
  return {
    schemaVersion: SCHEMA_VERSION,
    activeSessionId,
    sessions,
    compostItems: Array.isArray(value.compostItems) ? value.compostItems.slice(0, LIMITS.COMPOST).map((item) => { const url = safeHttpUrl(item?.url); if (!url) return null; return { id: compactText(item?.id, 120), url, title: compactText(item?.title || url, LIMITS.TITLE), mission: compactText(item?.mission, 140), depth: Math.max(0, Math.min(LIMITS.NODES_PER_SESSION, Number(item?.depth) || 0)), savedAt: Number.isFinite(item?.savedAt) ? item.savedAt : Date.now() }; }).filter((item) => item?.id && item.url) : [],
    rewardHistory: Array.isArray(value.rewardHistory) ? value.rewardHistory.filter((reward) => typeof reward?.rewardId === 'string' && Number.isFinite(reward.timestamp)).slice(-24).map((reward) => ({ rewardId: compactText(reward.rewardId, 40), timestamp: reward.timestamp })) : [],
    settings: normalizeSettings(value.settings, fallback.settings),
    onboardingCompleted: Boolean(value.onboardingCompleted)
  };
}

/**
 * Calculates how long a node was active in seconds.
 * @param {object} node - Session node object.
 * @returns {number} Duration in seconds (0 if node is null).
 */
export function getNodeDuration(node) {
  if (!node || typeof node !== 'object') return 0;
  const start = Number.isFinite(node.firstSeenAt) ? node.firstSeenAt : Date.now();
  const end = Number.isFinite(node.closedAt) ? node.closedAt : Date.now();
  return Math.max(0, Math.floor((end - start) / 1000));
}

/**
 * Normalizes user-provided settings against defaults and clamps values.
 * @param {object} value - Raw settings object.
 * @param {object} [fallback=emptyState().settings] - Default settings.
 * @returns {object} Sanitized settings object.
 */
export function normalizeSettings(value, fallback = emptyState().settings) {
  const source = value && typeof value === 'object' ? value : {};
  const gentleDepth = Math.max(2, Math.min(8, Number(source.gentleDepth) || fallback.gentleDepth));
  const choiceDepth = Math.max(gentleDepth + 1, Math.min(10, Number(source.choiceDepth) || fallback.choiceDepth));
  const growthAnimationTrigger = ['mission-origin', 'every-branch', 'none'].includes(source.growthAnimationTrigger) ? source.growthAnimationTrigger : fallback.growthAnimationTrigger;
  const excludedSites = Array.isArray(source.excludedSites) ? source.excludedSites.map((site) => compactText(site, 120).toLowerCase().replace(/^www\./, '')).filter((site, index, list) => site && list.indexOf(site) === index).slice(0, 40) : (Array.isArray(fallback.excludedSites) ? fallback.excludedSites : []);
  const searchEngine = ['default', 'google', 'bing', 'duckduckgo', 'brave', 'startpage'].includes(source.searchEngine) ? source.searchEngine : fallback.searchEngine;
  const enableRewards = source.enableRewards === true;
  return { interventionsPaused: Boolean(source.interventionsPaused), gentleDepth, choiceDepth, ambientMotion: source.ambientMotion !== false, growthAnimationTrigger, excludedSites, searchEngine, enableRewards };
}

let stateCache = null;
let ownWritesInFlight = 0;

/**
 * Check storage quota usage and return status with warning flag
 * @returns {Promise<{bytesInUse: number, warning: boolean, critical: boolean} | null>}
 */
export async function checkStorageQuota() {
  try {
    // getBytesInUse is only available in actual Chrome browser, not in test environments
    if (!chrome.storage?.local?.getBytesInUse) {
      return null;
    }
    const bytesInUse = await chrome.storage.local.getBytesInUse();
    const warning = bytesInUse > STORAGE_QUOTA_WARNING_THRESHOLD;
    const critical = bytesInUse > STORAGE_QUOTA_CRITICAL_THRESHOLD;
    if (critical) {
      logCritical(new Error('Storage quota critically exceeded'), { 
        category: ERROR_CATEGORIES.STORAGE, 
        bytesInUse,
        threshold: STORAGE_QUOTA_CRITICAL_THRESHOLD 
      });
    } else if (warning) {
      logWarning(new Error('Storage approaching quota'), { 
        category: ERROR_CATEGORIES.STORAGE, 
        bytesInUse,
        threshold: STORAGE_QUOTA_WARNING_THRESHOLD 
      });
    }
    return { bytesInUse, warning, critical };
  } catch (error) {
    // Silently handle missing API in test environments
    if (error.message?.includes('getBytesInUse')) {
      return null;
    }
    logError(error, { category: ERROR_CATEGORIES.STORAGE, operation: 'getBytesInUse' });
    return null;
  }
}

/**
 * Automatically compact state when storage approaches quota
 * Removes oldest completed sessions first to free up space
 * @returns {Promise<boolean>} True if compaction was performed
 */
export async function compactStateIfNeeded() {
  const quota = await checkStorageQuota();
  // If quota check failed (e.g., in test environment), skip compaction
  if (!quota) return false;
  if (!quota.warning && !quota.critical) return false;
  
  let compactionAttempts = 0;
  const MAX_COMPACTION_ATTEMPTS = 5;
  
  // Work on a copy: loadState() returns the shared cache, and compaction must
  // never mutate it before (or without) a successful durable write.
  const state = structuredClone(await loadState());
  let changed = false;
  // Remove oldest completed sessions first (keep at least 3 recent ones).
  while (state.sessions.length > 3 && compactionAttempts < MAX_COMPACTION_ATTEMPTS) {
    const sessionIndex = state.sessions.findIndex((session) => session.status === 'completed' && session.id !== state.activeSessionId);
    if (sessionIndex === -1) break;
    state.sessions.splice(sessionIndex, 1);
    changed = true;
    compactionAttempts++;
  }
  if (quota.critical && state.compostItems.length > 20) {
    // Saves are inserted newest-first, matching normalizeState's retention order.
    state.compostItems = state.compostItems.slice(0, 20);
    changed = true;
  }
  if (changed) {
    const compacted = normalizeState(state);
    // Persist first: the shared cache must only adopt compacted data after the
    // storage write succeeds, matching saveState's failure semantics. A failed
    // write propagates so callers (and tests) can observe the loss of no data.
    ownWritesInFlight += 1;
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: compacted });
    } finally {
      ownWritesInFlight = Math.max(0, ownWritesInFlight - 1);
    }
    stateCache = compacted;
  }
  
  return changed;
}

/**
 * Loads the persisted Focus Forest state from chrome.storage.local.
 * Returns a cached copy if available and not invalidated.
 * @returns {Promise<object>} Normalized state object.
 */
export async function loadState() {
  if (stateCache !== null) return stateCache;
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    stateCache = normalizeState(result[STORAGE_KEY]);
    return stateCache;
  } catch {
    return emptyState();
  }
}

/**
 * Persists a state object to chrome.storage.local and updates the cache.
 * Automatically compacts state if storage quota is approaching limits.
 * @param {object} state - State object to persist.
 * @returns {Promise<object>} The saved state.
 */
export async function saveState(state) {
  const normalized = normalizeState(state);
  
  ownWritesInFlight += 1;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
    stateCache = normalized;
  } finally {
    ownWritesInFlight = Math.max(0, ownWritesInFlight - 1);
  }
  return normalized;
}

/**
 * Clears the in-memory state cache, forcing the next loadState() to read from storage.
 */
export function clearStateCache() {
  stateCache = null;
}

// Invalidate the in-memory cache when storage is written from any external
// context (onInstalled seeding, a second extension page, a service-worker
// restart) so loadState() never serves a stale snapshot. Self-writes made
// through saveState() are excluded so the cache stays useful within the
// serialized mutation queue.
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged?.addListener) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY] && ownWritesInFlight === 0) stateCache = null;
  });
}


/**
 * Reward system functions - offline, deterministic, bounded
 */

/**
 * Check if a reward can be earned based on cooldowns and limits
 * @param {object} state - Current application state
 * @returns {boolean} True if reward can be earned
 */
export function canEarnReward(state) {
  if (!state.settings.enableRewards) return false;
  
  const now = Date.now();
  const rewardHistory = Array.isArray(state.rewardHistory) ? state.rewardHistory : [];
  const recentRewards = rewardHistory.filter(
    r => now - r.timestamp < REWARD_LIMITS.COOLDOWN_MS
  );
  
  if (recentRewards.length >= 1) return false; // Cooldown active
  
  // Count rewards in current session
  const currentSessionId = state.activeSessionId;
  if (currentSessionId) {
    const sessionStartedAt = state.sessions.find((session) => session.id === currentSessionId)?.startedAt || now;
    const sessionRewards = rewardHistory.filter(
      r => r.timestamp >= sessionStartedAt
    );
    if (sessionRewards.length >= REWARD_LIMITS.MAX_PER_SESSION) return false;
  }
  
  return true;
}

/**
 * Select a random reward from the appropriate tier
 * Uses crypto.getRandomValues for true randomness when available
 * @param {string} tier - Reward tier ('seeds', 'leaves', 'blooms', 'discoveries')
 * @param {number} seed - Optional seed for deterministic selection
 * @returns {object|null} Selected reward or null if tier empty
 */
export function selectRandomReward(tier, seed = null) {
  const catalog = REWARD_CATALOG[tier];
  if (!catalog || catalog.length === 0) return null;
  
  let index;
  if (seed !== null) {
    // Deterministic selection for testing
    index = seed % catalog.length;
  } else if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    // True random using Web Crypto API
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    index = array[0] % catalog.length;
  } else {
    // Fallback to Math.random (less ideal but works)
    index = Math.floor(Math.random() * catalog.length);
  }
  
  return catalog[index];
}

/**
 * Record an earned reward in state
 * @param {object} state - Current application state
 * @param {string} tier - Reward tier
 * @param {string} trigger - What triggered this reward
 * @returns {object|null} The earned reward or null if cannot earn
 */
export function earnReward(state, tier, trigger) {
  if (!canEarnReward(state)) return null;
  
  const reward = selectRandomReward(tier);
  if (!reward) return null;
  
  const rewardRecord = { rewardId: reward.id, timestamp: Date.now() };
  
  state.rewardHistory.push(rewardRecord);
  
  // Trim old rewards beyond history limit
  const cutoff = Date.now() - (REWARD_LIMITS.REWARD_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  state.rewardHistory = state.rewardHistory.filter(r => r.timestamp > cutoff);
  
  return { ...reward, tier, trigger, note: rewardNote(trigger) };
}
