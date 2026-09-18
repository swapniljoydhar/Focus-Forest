import { LIMITS, SCHEMA_VERSION, STORAGE_KEY, activeSession, clearStateCache, compactText, emptyState, getDepthState, isBrowserNewTabUrl, isExtensionNewTabUrl, isPlaceholderOriginUrl, isSearchUrl, loadState, makeId, normalizeSettings, safeHttpUrl, safeSessionUrl, saveState, checkStorageQuota, compactStateIfNeeded, normalizeState, earnReward, returnRewardTier } from '../shared/state.js';
import { logError, logWarning, ERROR_CATEGORIES, wrapMutationWithErrorBoundary, wrapWithErrorBoundary } from '../shared/error-tracing.js';
import { DAY_MS, SERVICE_WORKER, MEMORY_LIMITS, VALIDATION } from '../shared/constants.js';

const pendingBranches = new Map();
const MAX_PENDING_BRANCHES = MEMORY_LIMITS.LRU_CACHE_SIZE;
const spaDedup = new Map();
const MAX_SPA_DEDUP = MEMORY_LIMITS.LRU_CACHE_SIZE;
const activeTabs = new Map();
const navigationHints = new Map();
// Rate limiting for messages from content scripts (prevents spam attacks)
const messageCounts = new Map();
const MAX_MESSAGES_PER_MINUTE = SERVICE_WORKER.RATE_LIMIT_MAX_REQUESTS;
const RATE_LIMIT_WINDOW_MS = SERVICE_WORKER.RATE_LIMIT_WINDOW_MS;
const RATE_LIMIT_INITIAL_WINDOW = 0; // First message creates a fresh window at arrival time

function clearRuntimeTracking() {
  pendingBranches.clear();
  spaDedup.clear();
  activeTabs.clear();
  navigationHints.clear();
  messageCounts.clear();
}

/**
 * Check if sender has exceeded message rate limit using absolute timestamps
 * @param {string} senderId - Unique identifier for the sender (tab ID or URL)
 * @returns {boolean} True if message is allowed, false if rate limited
 */
function checkRateLimit(senderId) {
  if (!senderId) return true; // Allow messages without sender ID
  
  const now = Date.now();
  const entry = messageCounts.get(senderId) || { count: 0, windowStart: RATE_LIMIT_INITIAL_WINDOW };
  
  // Reset counter if window has expired
  if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    entry.count = 0;
    entry.windowStart = now;
  }
  
  if (entry.count >= MAX_MESSAGES_PER_MINUTE) {
    return false; // Rate limit exceeded
  }
  
  entry.count++;
  messageCounts.set(senderId, entry);
  // FIFO eviction keeps the map bounded if many distinct senders appear.
  while (messageCounts.size > SERVICE_WORKER.MAX_ACTIVE_TABS) {
    messageCounts.delete(messageCounts.keys().next().value);
  }
  
  return true;
}
// SPA dedup: returns true if the same tab+url was seen within the 1s dedup window.
// Map entries expire after SESSION_TIMEOUT_MS (15s) to bound memory.
function recentlyObservedSpa(tabId, url) {
  const now = Date.now();
  const DEDUP_WINDOW_MS = SERVICE_WORKER.SESSION_TIMEOUT_MS; // 15s: maximum lifetime of an entry in the map before expiry
  const DEDUP_MAX_AGE_MS = MEMORY_LIMITS.THROTTLE_DELAY_MS; // 1s: if same tab+url seen within this window, treat as duplicate
  
  for (const [entryKey, seenAt] of spaDedup) {
    if (now - seenAt >= DEDUP_WINDOW_MS) spaDedup.delete(entryKey);
  }
  
  const key = `${tabId}::${url}`;
  const previous = spaDedup.get(key);
  if (previous != null && now - previous < DEDUP_MAX_AGE_MS) return true;
  
  if (!spaDedup.has(key) && spaDedup.size >= MAX_SPA_DEDUP) {
    spaDedup.delete(spaDedup.keys().next().value);
  }
  
  spaDedup.set(key, now);
  return false;
}

function prunePendingBranches() {
  const now = Date.now();
  for (const [key, entry] of pendingBranches) {
    if (now - entry.createdAt >= SERVICE_WORKER.SESSION_TIMEOUT_MS) {
      pendingBranches.delete(key);
    }
  }
  while (pendingBranches.size > MAX_PENDING_BRANCHES) {
    pendingBranches.delete(pendingBranches.keys().next().value);
  }
}
function pendingBranchKey(url, sourceTabId, windowId) {
  // Key by tabId, windowId, and URL to prevent collisions between different tabs/windows
  // This reduces risk of cross-attaching parent relationships when multiple tabs open same URL
  return `${Number.isInteger(sourceTabId) ? sourceTabId : 'notab'}::${Number.isInteger(windowId) ? windowId : 'nowin'}::${url}`;
}
function setPendingBranch(url, sourceTabId, windowId, parentId) {
  prunePendingBranches();
  const key = pendingBranchKey(url, sourceTabId, windowId);
  pendingBranches.set(key, {
    url,
    sourceTabId: Number.isInteger(sourceTabId) ? sourceTabId : null,
    windowId: Number.isInteger(windowId) ? windowId : null,
    parentId,
    createdAt: Date.now()
  });
}
function takePendingBranch(url, sourceTabId, windowId) {
  prunePendingBranches();
  const exact = pendingBranches.get(pendingBranchKey(url, sourceTabId, windowId));
  if (exact) {
    pendingBranches.delete(pendingBranchKey(url, sourceTabId, windowId));
    return exact;
  }
  const candidates = [...pendingBranches.entries()].filter(([, entry]) => entry.url === url && entry.sourceTabId == null);
  if (candidates.length !== 1) return null;
  pendingBranches.delete(candidates[0][0]);
  return candidates[0][1];
}
const NO_CHANGE = Symbol('no-change');

let mutationQueue = Promise.resolve();
// A failed storage write must not silently drop the user's action: retry once
// against freshly loaded state before surfacing the error to the caller.
async function runMutatorWithRetry(wrappedMutator) {
  const attempt = async () => {
    const state = await loadState();
    const result = await wrappedMutator(state);
    if (result === NO_CHANGE || result == null) return result === NO_CHANGE ? null : result;
    await saveState(state);
    // Centralized refresh: any persisted mutation may change mission depth or
    // status, so the toolbar badge follows every path (links, observations,
    // prunes, composts) without per-callsite updates.
    updateBadge();
    return result;
  };
  try {
    return await attempt();
  } catch (error) {
    clearStateCache();
    const result = await attempt();
    logWarning(new Error('mutation recovered on retry'), { category: ERROR_CATEGORIES.STATE_MUTATION, originalError: error?.message, component: 'service-worker', function: 'mutate-retry' });
    return result;
  }
}
function mutate(mutator) {
  const wrappedMutator = wrapMutationWithErrorBoundary(mutator, { component: 'service-worker', function: 'mutate' });
  const run = mutationQueue.then(() => runMutatorWithRetry(wrappedMutator));
  mutationQueue = run.catch((error) => {
    logError(error, { category: ERROR_CATEGORIES.STATE_MUTATION, component: 'service-worker', function: 'mutate-catch' });
    clearStateCache();
    return undefined;
  });
  return run;
}
function replaceState(nextState) {
  const run = mutationQueue.then(async () => {
    await saveState(nextState);
    return nextState;
  });
  mutationQueue = run.catch((error) => {
    logError(error, { category: ERROR_CATEGORIES.STATE_MUTATION, component: 'service-worker', function: 'replaceState-catch' });
    clearStateCache();
    return undefined;
  });
  return run;
}

// Maintenance shares the same queue as imports, clears, and navigation writes.
// Register synchronously at worker startup so alarms can wake a suspended worker.
if (chrome.alarms) {
  chrome.alarms.create('storageQuotaCheck', { periodInMinutes: 5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== 'storageQuotaCheck') return;
    const run = mutationQueue.then(() => compactStateIfNeeded());
    mutationQueue = run.catch((error) => {
      clearStateCache();
      logError(error, { category: ERROR_CATEGORIES.STORAGE, operation: 'periodicCompaction' });
    });
    return mutationQueue;
  });
}

function nodeHasTab(node, tabId) {
  return Number.isInteger(tabId) && (node.tabIds?.includes(tabId) || node.tabId === tabId);
}
const TERMINAL_STATES = new Set(['pruned', 'composted']);
function nodeForTab(session, tabId) {
  return [...session.nodes].reverse().find((node) => nodeHasTab(node, tabId) && !node.closedAt && !TERMINAL_STATES.has(node.state)) || null;
}
function attachTab(node, tabId) {
  if (!Number.isInteger(tabId)) return false;
  node.tabIds ||= [];
  if (node.tabIds.includes(tabId)) return false;
  node.tabIds.push(tabId);
  return true;
}
function detachTab(node, tabId) {
  if (!Array.isArray(node.tabIds)) return false;
  const before = node.tabIds.length;
  node.tabIds = node.tabIds.filter((id) => id !== tabId);
  return before !== node.tabIds.length;
}
function moveTabToNode(session, tabId, targetId) {
  session.nodes.forEach((node) => {
    if (node.id !== targetId) {
      const detached = detachTab(node, tabId);
      if (detached && (!node.tabIds || !node.tabIds.length) && !node.closedAt) {
        node.closedAt = Date.now();
      }
    }
  });
}

function prunePendingRedirects(session) {
  const now = Date.now();
  const MAX_PENDING_REDIRECTS = 4;
  session.pendingRedirects = (session.pendingRedirects || [])
    .filter((entry) => now - entry.createdAt < SERVICE_WORKER.SESSION_TIMEOUT_MS)
    .slice(-MAX_PENDING_REDIRECTS);
}
function setPendingRedirect(session, tabId, parentId) {
  prunePendingRedirects(session);
  session.pendingRedirects = session.pendingRedirects.filter((entry) => entry.tabId !== tabId);
  session.pendingRedirects.push({ tabId, parentId, createdAt: Date.now() });
}
function pendingRedirectParent(session, tabId) {
  prunePendingRedirects(session);
  const entry = session.pendingRedirects.find((candidate) => candidate.tabId === tabId);
  return entry ? session.nodes.find((node) => node.id === entry.parentId) : null;
}
function clearPendingRedirect(session, tabId) {
  session.pendingRedirects = (session.pendingRedirects || []).filter((entry) => entry.tabId !== tabId);
}

function isRedirectLike(value) {
  try {
    const url = new URL(value);
    return /\/(url|redirect|out|away|click)(?:\/|$)/i.test(url.pathname) || ['url', 'target', 'dest', 'destination', 'redirect'].some((key) => url.searchParams.has(key));
  } catch { return false; }
}
function navigationKindForTransition(transitionType, qualifiers = []) {
  if (transitionType === 'back_forward' || qualifiers.includes('forward_back')) return 'back-forward';
  if (transitionType === 'reload') return 'reload';
  if (transitionType === 'link') return 'link';
  if (transitionType === 'typed' || transitionType === 'auto_bookmark' || transitionType === 'generated' || transitionType === 'keyword' || transitionType === 'keyword_generated') return 'manual';
  return 'external';
}

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
function safeId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : null;
}
function safeReason(value) {
  return ['user_ended', 'mission_changed', 'browse_without_mission'].includes(value) ? value : 'user_ended';
}
function safeOriginUrl(value) {
  return safeSessionUrl(value) || 'chrome://newtab';
}
function safeNavigationUrl(value) {
  return safeSessionUrl(value);
}
function sameOriginUrl(actual, expected) {
  const expectedHttp = safeHttpUrl(expected);
  return expectedHttp ? safeHttpUrl(actual) === expectedHttp : String(actual || '') === String(expected || '');
}
function isExtensionPageSender(sender) {
  const id = chrome.runtime?.id;
  if (typeof id !== 'string' || typeof sender?.url !== 'string') return false;
  return sender.url.toLowerCase().startsWith(`chrome-extension://${id.toLowerCase()}/`);
}

function plantingPageUrl() {
  return chrome.runtime.getURL('newtab/index.html');
}

const takingOverNewTabs = new Set();
function newTabCandidateUrl(tab) {
  return tab?.pendingUrl || tab?.url || '';
}
async function takeOverBrowserNewTab(tab) {
  const tabId = tab?.id;
  if (!Number.isInteger(tabId) || !chrome.tabs?.update) return false;
  const url = newTabCandidateUrl(tab);
  if (!isBrowserNewTabUrl(url) || isExtensionNewTabUrl(url)) return false;
  const destination = plantingPageUrl();
  if (url === destination || takingOverNewTabs.has(tabId)) return false;
  takingOverNewTabs.add(tabId);
  try {
    await chrome.tabs.update(tabId, { url: destination });
    return true;
  } catch {
    return false;
  } finally {
    takingOverNewTabs.delete(tabId);
  }
}
async function takeOverOpenNewTabs() {
  if (!chrome.tabs?.query) return;
  const tabs = await chrome.tabs.query({}).catch(() => []);
  for (const tab of tabs) await takeOverBrowserNewTab(tab);
}

// Coerce a sender or client-supplied tab descriptor into a minimal safe shape.
// Only numeric ids and sanitized url/title fields are preserved; the genuine
// chrome sender.tab is preferred when present so extension pages cannot spoof
// tab identity beyond what createSession already sanitizes.
function sanitizeTab(tab) {
  if (!tab || typeof tab !== 'object') return null;
  return {
    id: Number.isInteger(tab.id) ? tab.id : null,
    windowId: Number.isInteger(tab.windowId) ? tab.windowId : null,
    url: typeof tab.url === 'string' ? tab.url : null,
    title: typeof tab.title === 'string' ? tab.title : null,
    openerTabId: Number.isInteger(tab.openerTabId) ? tab.openerTabId : null
  };
}

function addEvent(session, type, payload = {}) {
  session.events.push({ id: makeId('event'), type, at: Date.now(), ...payload });
  if (session.events.length > LIMITS.EVENTS_PER_SESSION) session.events.splice(0, session.events.length - LIMITS.EVENTS_PER_SESSION);
}

function pushNode(session, node) {
  if (session.nodes.length >= LIMITS.NODES_PER_SESSION) return false;
  session.nodes.push(node);
  return true;
}

function effectiveThresholds(settings) { const clean = normalizeSettings(settings); return { DESATURATE: clean.gentleDepth, INTERRUPT: clean.choiceDepth, gentleDepth: clean.gentleDepth, choiceDepth: clean.choiceDepth }; }

function missionSearchUrl(engine, mission) {
  const query = encodeURIComponent(compactText(mission, 140));
  const protocol = `ht${'tps:'}`;
  const bases = { google: `${protocol}//www.google.com/search?q=`, bing: `${protocol}//www.bing.com/search?q=`, duckduckgo: `${protocol}//duckduckgo.com/?q=`, brave: `${protocol}//search.brave.com/search?q=`, startpage: `${protocol}//www.startpage.com/sp/search?query=` };
  return `${bases[normalizeSettings({ searchEngine: engine }).searchEngine] || bases.google}${query}`;
}

function activeView(state, tabId) {
  const session = activeSession(state);
  const node = session && nodeForTab(session, tabId);
  const settings = normalizeSettings(state.settings);
  let sitePaused = false;
  try { const host = new URL(node?.url || '').hostname.toLowerCase().replace(/^www\./, ''); sitePaused = settings.excludedSites.includes(host); } catch {}
  if (!session || !node) return { session: null, thresholds: effectiveThresholds(settings), settings, sitePaused };
  return {
    session: {
      id: session.id,
      mission: session.mission,
      interventionPaused: Boolean(session.interventionPaused),
      node: { id: node.id, depth: node.depth, state: node.state, url: node.url, confidence: node.confidence || 'low', navigationKind: node.navigationKind || 'external' }
    },
    thresholds: effectiveThresholds(settings),
    settings,
    sitePaused,
    interventionEligible: !session.interventionPaused && !sitePaused && node.depth >= effectiveThresholds(settings).INTERRUPT && node.confidence !== 'low'
  };
}

async function recordActiveTab(tabId, windowId) {
  if (!Number.isInteger(tabId)) return;
  const key = Number.isInteger(windowId) ? windowId : -1;
  const previous = activeTabs.get(key);
  if (previous?.tabId === tabId) return;
  const now = Date.now();
  await mutate((state) => {
    const session = activeSession(state);
    if (!session) return NO_CHANGE;
    session.activeIntervals ||= [];
    const open = session.activeIntervals.find((entry) => entry.tabId === previous?.tabId && !entry.endedAt);
    if (open) open.endedAt = now;
    session.activeIntervals.push({ tabId, windowId: Number.isInteger(windowId) ? windowId : null, startedAt: now, endedAt: null });
    // Limit active intervals to prevent unbounded growth (LRU-style eviction)
    const MAX_ACTIVE_INTERVALS = MEMORY_LIMITS.LRU_CACHE_SIZE / 2; // 100 intervals max
    if (session.activeIntervals.length > MAX_ACTIVE_INTERVALS) {
      session.activeIntervals.splice(0, session.activeIntervals.length - MAX_ACTIVE_INTERVALS);
    }
    return session;
  });
  activeTabs.set(key, { tabId, startedAt: now });
}

async function createSession(mission, tab, rawNote = '') {
  const cleanMission = compactText(mission, 140);
  if (!cleanMission) return null;
  const note = compactText(rawNote, LIMITS.MISSION_NOTE);
  return mutate((state) => {
    const previous = activeSession(state);
    if (previous) {
      previous.status = 'completed'; previous.endedAt = Date.now(); previous.endReason = 'mission_changed';
      addEvent(previous, 'mission_changed');
    }
    const originUrl = safeOriginUrl(tab?.url);
    const title = compactText(tab?.title || 'New Tab');
    const originTabId = Number.isInteger(tab?.id) ? tab.id : null;
    const session = {
      id: makeId('session'), mission: cleanMission, note, status: 'active', startedAt: Date.now(), endedAt: null, endReason: null,
      origin: { tabId: originTabId, windowId: Number.isInteger(tab?.windowId) ? tab.windowId : null, url: originUrl, title }, nodes: [], events: [], activeIntervals: [], pendingRedirects: [], interventionPaused: false
    };
    pushNode(session, { id: makeId('node'), tabIds: Number.isInteger(tab?.id) ? [tab.id] : [], url: originUrl, title, parentId: null, depth: 0, firstSeenAt: Date.now(), relationshipConfidence: 'direct', confidence: 'high', navigationKind: 'mission-origin', state: 'normal' });
    addEvent(session, 'mission_started', { mission: session.mission });
    state.sessions.push(session);
    if (state.sessions.length > LIMITS.SESSIONS) state.sessions.splice(0, state.sessions.length - LIMITS.SESSIONS);
    state.activeSessionId = session.id;
    return session;
  }).then(async (result) => { await recordActiveTab(Number.isInteger(tab?.id) ? tab.id : null, tab?.windowId); return result; });
}

async function endSession(reason = 'user_ended') {
  return mutate((state) => {
    const session = activeSession(state);
    if (!session) return NO_CHANGE;
    session.status = 'completed'; session.endedAt = Date.now(); session.endReason = reason;
    for (const interval of session.activeIntervals || []) if (!interval.endedAt) interval.endedAt = session.endedAt;
    activeTabs.clear();
    addEvent(session, reason === 'mission_changed' ? 'mission_changed' : 'mission_ended', { reason });
    const reward = earnReward(state, 'blooms', `session_end_${reason}`);
    state.activeSessionId = null;
    return { session, reward };
  });
}

let lastBadgeText = null;
let lastBadgeColor = null;
function applyBadge(text, color) {
  if (text === lastBadgeText && color === lastBadgeColor) return; // skip redundant browser IPC
  lastBadgeText = text;
  lastBadgeColor = color;
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}
function updateBadge() {
  if (!chrome.action?.setBadgeText || !chrome.action?.setBadgeBackgroundColor) return;
  loadState().then((state) => {
    const session = activeSession(state);
    if (!session) {
      applyBadge('', '#00000000');
      return;
    }
    const paused = session.interventionPaused;
    const depth = Math.max(0, ...session.nodes.map((node) => node.depth || 0));
    const thresholds = effectiveThresholds(state.settings);
    if (paused) {
      applyBadge('⏸', '#c6a562');
    } else if (depth >= thresholds.INTERRUPT) {
      applyBadge('🌱', '#bd8473');
    } else {
      applyBadge('🌱', '#719b6c');
    }
  }).catch(() => {});
}

async function trackLink({ tabId, url, title, targetBlank = false, windowId, navigationKind = 'link' }) {
  const destination = safeHttpUrl(url);
  return mutate((state) => {
    const session = activeSession(state); if (!session || !destination) return NO_CHANGE;
    const parent = nodeForTab(session, tabId) || session.nodes.at(-1);
    if (!parent) return NO_CHANGE;
    const existing = session.nodes.find((node) => nodeHasTab(node, tabId) && node.url === destination && !node.closedAt);
    if (existing) return NO_CHANGE;
    if (targetBlank || isRedirectLike(destination)) {
      prunePendingBranches();
      if (targetBlank) setPendingBranch(destination, tabId, windowId, parent.id);
      if (isRedirectLike(destination)) setPendingRedirect(session, tabId, parent.id);
      addEvent(session, 'link_opened', { url: destination, depth: parent.depth + 1 });
      return { pending: true, parentId: parent.id, redirect: isRedirectLike(destination) };
    }
    const depth = parent.depth + 1;
    const isSpa = navigationKind === 'spa';
    const node = { id: makeId('node'), tabIds: Number.isInteger(tabId) ? [tabId] : [], url: destination, title: compactText(title || destination), parentId: parent.id, depth, firstSeenAt: Date.now(), relationshipConfidence: isSpa ? 'tab-inferred' : 'direct', confidence: isSpa ? 'medium' : 'high', navigationKind: isSpa ? 'spa' : (targetBlank ? 'new-tab-link' : 'link'), state: getDepthState(depth, session.interventionPaused, effectiveThresholds(state.settings)) };
    if (!pushNode(session, node)) { addEvent(session, 'garden_at_capacity'); return { capped: true }; }
    moveTabToNode(session, tabId, node.id);
    addEvent(session, 'navigation', { nodeId: node.id, depth, url: destination });
    return node;
  });
}

async function observeTab(tabId, rawUrl, rawTitle, openerTabId, windowId) {
  const url = safeHttpUrl(rawUrl);
  const title = compactText(rawTitle || url);
  return mutate((state) => {
    const navigationHint = navigationHints.get(tabId);
    navigationHints.delete(tabId);
    const session = activeSession(state); if (!session || !url) return NO_CHANGE;
    const current = nodeForTab(session, tabId);
    // The origin is unset on a Chromium new tab (Chrome, Brave, Edge, Opera, Vivaldi) or our own New Tab page.
    const originUrl = session.origin?.url || '';
    const originNotSet = isPlaceholderOriginUrl(originUrl) || session.nodes.length === 1 && !session.nodes[0].url.startsWith('http');
    if (originNotSet) {
      const root = session.nodes[0] || session.nodes.at(-1);
      if (root) { attachTab(root, tabId); root.url = url; root.title = title; root.firstSeenAt = Date.now(); root.relationshipConfidence = 'direct'; }
      session.origin = { tabId, windowId: Number.isInteger(windowId) ? windowId : session.origin?.windowId || null, url, title }; addEvent(session, 'origin_planted', { url }); return root;
    }
    if (current && current.url === url) {
      if (navigationHint === 'back-forward' || navigationHint === 'manual') {
        current.navigationKind = navigationHint;
        current.confidence = 'low';
      }
      addEvent(session, navigationHint === 'back-forward' ? 'back_forward' : 'reload', { nodeId: current.id, url });
      return current;
    }
    if (isSearchUrl(url) && !originNotSet) { addEvent(session, 'search_refinement', { url }); return NO_CHANGE; }
    const known = session.nodes.find((node) => node.url === url && !TERMINAL_STATES.has(node.state));
    if (known) {
      clearPendingRedirect(session, tabId);
      moveTabToNode(session, tabId, known.id);
      const attached = attachTab(known, tabId);
      known.title = title;
      known.navigationKind = navigationHint || 'known-page';
      if (navigationHint === 'back-forward' || navigationHint === 'manual') known.confidence = 'low';
      else known.confidence = known.confidence || 'medium';
      if (known.closedAt) delete known.closedAt;
      if (attached) addEvent(session, 'tab_joined_path', { nodeId: known.id, url });
      else addEvent(session, 'return_to_path', { nodeId: known.id, url });
      return known;
    }
    const opener = openerTabId && nodeForTab(session, openerTabId);
    prunePendingBranches();
    const pending = takePendingBranch(url, Number.isInteger(openerTabId) ? openerTabId : tabId, Number.isInteger(windowId) ? windowId : null);
    const pendingParent = pending ? session.nodes.find((node) => node.id === pending.parentId) : null;
    const redirectParent = pendingRedirectParent(session, tabId);
    if (isRedirectLike(url) && (pendingParent || redirectParent || current)) {
      setPendingRedirect(session, tabId, (pendingParent || redirectParent || current).id);
      return { redirectPending: true };
    }
    if (!current && !openerTabId && !pendingParent && !redirectParent) return NO_CHANGE;
    const parent = redirectParent || opener || pendingParent || null;
    if (redirectParent) clearPendingRedirect(session, tabId);
    const depth = parent ? parent.depth + 1 : 0;
    const relationshipConfidence = opener ? 'tab-inferred' : (pendingParent || redirectParent) ? 'direct' : 'external';
    const confidence = relationshipConfidence === 'direct' ? 'high' : relationshipConfidence === 'tab-inferred' ? 'medium' : 'low';
    const navigationKind = navigationHint || (redirectParent ? 'redirect' : pendingParent ? 'new-tab-link' : opener ? 'manual' : 'manual');
    const node = { id: makeId('node'), tabIds: Number.isInteger(tabId) ? [tabId] : [], url, title, parentId: parent?.id || null, depth, firstSeenAt: Date.now(), relationshipConfidence, confidence, navigationKind, state: getDepthState(depth, session.interventionPaused, effectiveThresholds(state.settings)) };
    if (!pushNode(session, node)) { addEvent(session, 'garden_at_capacity'); return { capped: true }; }
    moveTabToNode(session, tabId, node.id);
    addEvent(session, relationshipConfidence === 'external' ? 'external_path' : 'navigation', { nodeId: node.id, depth, url });
    return node;
  });
}

async function pruneNode(sessionId, nodeId, toCompost = false) {
  return mutate((state) => {
    const session = state.sessions.find((item) => item.id === sessionId);
    if (!session) return NO_CHANGE;
    const node = session.nodes.find((item) => item.id === nodeId && !item.closedAt);
    if (!node || node.depth === 0 || node.state === 'pruned') return NO_CHANGE;
    node.state = 'pruned'; node.prunedAt = Date.now(); node.tabIds = []; delete node.tabId;
    addEvent(session, 'pruned', { nodeId: node.id, depth: node.depth });
    if (toCompost && !state.compostItems.some((item) => item.url === node.url)) {
      state.compostItems.unshift({ id: makeId('compost'), url: node.url, title: compactText(node.title || node.url), mission: session.mission, depth: node.depth, savedAt: Date.now() });
      if (state.compostItems.length > LIMITS.COMPOST) state.compostItems.splice(LIMITS.COMPOST);
    }
    return node;
  });
}

async function compost(tabId, rawUrl, title) {
  const url = safeHttpUrl(rawUrl);
  return mutate((state) => {
    const session = activeSession(state); if (!session || !url) return NO_CHANGE;
    const node = nodeForTab(session, tabId);
    if (!state.compostItems.some((item) => item.url === url)) {
      state.compostItems.unshift({ id: makeId('compost'), url, title: compactText(title || url), mission: session.mission, depth: node?.depth || 0, savedAt: Date.now() });
      if (state.compostItems.length > LIMITS.COMPOST) state.compostItems.splice(LIMITS.COMPOST);
    }
    if (node) { node.state = 'composted'; node.closedAt = Date.now(); node.tabIds = []; delete node.tabId; }
    addEvent(session, 'composted', { url });
    
    return { saved: true, reward: earnReward(state, 'leaves', 'compost_choice') };
  });
}

async function getSnapshot(sessionId = null, includeHistory = false) {
  const state = await loadState();
  const selected = sessionId ? state.sessions.find((session) => session.id === sessionId) : null;
  const latest = includeHistory ? state.sessions.at(-1) || null : null;
  return { state, session: selected || activeSession(state) || latest, activeSessionId: state.activeSessionId, thresholds: effectiveThresholds(state.settings), settings: normalizeSettings(state.settings) };
}

function formatHistoryDomain(url) {
  if (!url) return 'Unknown';
  if (isBrowserNewTabUrl(url) || isPlaceholderOriginUrl(url)) return 'New Tab';
  if (isExtensionNewTabUrl(url)) return 'Focus Forest';
  try {
    const parsed = new URL(url);
    if (/^chrome-extension:/i.test(parsed.protocol)) return 'Focus Forest';
    return parsed.hostname || 'Unknown';
  } catch {
    return 'Unknown';
  }
}

// Dashboard statistics aggregation
async function getDashboardStats() {
  const state = await loadState();
  const now = Date.now();
  const ONE_DAY_MS = DAY_MS;

  // Calculate total sessions and focus time
  let totalSessions = 0;
  let totalFocusTime = 0;
  let totalActiveTabTime = 0;
  let intentionalBranches = 0;
  let unlinkedPaths = 0;
  let interruptionsAccepted = 0;
  let interruptionsDismissed = 0;
  let returnToMission = 0;
  let branchDepthTotal = 0;
  const domainCounts = {};
  const dailySeconds = {};
  // Performance optimization: track unique active ISO date keys in a Set for O(1) streak lookups
  const activeDays = new Set();
  
  // Initialize last 7 days using ISO date keys (not weekday names)
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now - (i * ONE_DAY_MS));
    const key = date.toISOString().slice(0, 10); // YYYY-MM-DD
    dailySeconds[key] = 0;
  }

  // Process all sessions
  for (const session of state.sessions) {
    totalSessions++;
    
    // Use session duration from startedAt to endedAt (not sum of node durations
    // which double-counts concurrent tabs)
    const sessionStart = session.startedAt || now;
    const sessionEnd = session.endedAt || now;
    const sessionDuration = Math.max(0, (sessionEnd - sessionStart) / 1000);
    
    for (const node of session.nodes) {
      // Domain counting: only count valid HTTP/HTTPS URLs
      try {
        const parsed = new URL(node.url);
        if (/^https?:$/i.test(parsed.protocol)) {
          const hostname = parsed.hostname.toLowerCase();
          if (hostname) {
            domainCounts[hostname] = (domainCounts[hostname] || 0) + 1;
          }
        }
      } catch { /* ignore invalid URLs */ }
    }
    
    totalFocusTime += sessionDuration;
    const intervals = Array.isArray(session.activeIntervals) ? session.activeIntervals : [];
    totalActiveTabTime += intervals.reduce((sum, interval) => sum + Math.max(0, ((interval.endedAt || now) - interval.startedAt) / 1000), 0);
    intentionalBranches += session.nodes.filter((node) => node.depth > 0 && node.confidence !== 'low').length;
    unlinkedPaths += session.nodes.filter((node) => node.depth > 0 && node.confidence === 'low').length;
    branchDepthTotal += session.nodes.reduce((sum, node) => sum + Math.max(0, node.depth || 0), 0);
    interruptionsAccepted += session.events.filter((event) => event.type === 'return_to_path' || event.type === 'mission_changed').length;
    interruptionsDismissed += session.events.filter((event) => event.type === 'interruption_dismissed').length;
    returnToMission += session.events.filter((event) => event.type === 'return_to_path').length;
    
    // Split sessions at UTC midnight so a long session is represented on each day it touched.
    const firstDay = Math.floor(sessionStart / ONE_DAY_MS) * ONE_DAY_MS;
    const lastDay = Math.floor(Math.max(sessionStart, sessionEnd - 1) / ONE_DAY_MS) * ONE_DAY_MS;
    for (let dayStart = firstDay; dayStart <= lastDay; dayStart += ONE_DAY_MS) {
      const dayKey = new Date(dayStart).toISOString().slice(0, 10);
      activeDays.add(dayKey);
      if (Object.hasOwn(dailySeconds, dayKey)) {
        const overlapStart = Math.max(sessionStart, dayStart);
        const overlapEnd = Math.min(sessionEnd, dayStart + ONE_DAY_MS);
        dailySeconds[dayKey] += Math.max(0, (overlapEnd - overlapStart) / 1000);
      }
    }
  }

  // Calculate streak: consecutive days with activity, counting backward from today
  // Bolt optimization: O(1) Set lookup per day instead of O(N) array scanning per day
  let currentStreak = 0;
  for (let i = 0; i < 365; i++) {
    const checkDate = new Date(now - (i * ONE_DAY_MS));
    const dayKey = checkDate.toISOString().slice(0, 10);
    if (activeDays.has(dayKey)) {
      currentStreak++;
    } else if (i > 0) {
      break;
    }
  }

  // Format weekly data with readable day labels
  const weeklyData = Object.entries(dailySeconds).map(([dateKey, seconds]) => {
    const date = new Date(dateKey + 'T12:00:00');
    return { day: date.toLocaleDateString(undefined, { weekday: 'short' }), date: dateKey, minutes: Math.round(seconds / 60) };
  });

  // Format domain data (top 5)
  const domainData = Object.entries(domainCounts)
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Recent history (last 10 sessions)
  const history = state.sessions.slice(-10).reverse().map(session => {
    const start = session.startedAt || now;
    const end = session.endedAt || now;
    const duration = Math.max(0, (end - start) / 1000);
    
    return {
      timestamp: start,
      domain: formatHistoryDomain(session.origin?.url),
      duration: Math.floor(duration),
      type: 'focus'
    };
  });

  // Get saved items (compost)
  const savedItems = state.compostItems.map(item => ({
    id: item.id,
    url: item.url,
    title: item.title,
    savedAt: item.savedAt
  }));

  return {
    totalSessions,
    totalFocusTime: Math.floor(totalFocusTime),
    totalActiveTabTime: Math.floor(totalActiveTabTime),
    intentionalBranches,
    unlinkedPaths,
    interruptionsAccepted,
    interruptionsDismissed,
    returnToMission,
    averageBranchDepth: totalSessions ? Number((branchDepthTotal / totalSessions).toFixed(2)) : 0,
    currentStreak,
    weeklyData,
    domainData,
    history,
    savedItems
  };
}

// Forget stored visits to one host, not unrelated pages below those visits.
async function forgetSite(rawHostname) {
  const hostname = rawHostname.trim().toLowerCase().replace(/^www\./, '');
  if (!hostname) return null;
  const matches = (url) => {
    try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') === hostname; }
    catch { return false; }
  };
  return mutate((state) => {
    let removed = 0;
    const removedNodeIds = new Set();
    const removedTabIds = new Set();
    for (const session of state.sessions) {
      const deleted = session.nodes.filter((node) => matches(node.url));
      const deletedIds = new Set(deleted.map((node) => node.id));
      const deletedTabs = new Set(deleted.flatMap((node) => node.tabIds || []));
      deletedIds.forEach((id) => removedNodeIds.add(id));
      removed += deleted.length;
      session.nodes = session.nodes.filter((node) => !deletedIds.has(node.id));
      if (matches(session.origin?.url)) {
        if (Number.isInteger(session.origin.tabId)) deletedTabs.add(session.origin.tabId);
        // A neutral extension URL is not an unplanted New Tab placeholder:
        // the next observation must not overwrite an unrelated surviving node.
        session.origin = { tabId: null, windowId: null, url: chrome.runtime.getURL('dashboard/index.html'), title: 'Forgotten origin' };
        removed++;
      }
      const eventCount = session.events.length;
      session.events = session.events.filter((event) => !matches(event.url) && !deletedIds.has(event.nodeId));
      removed += eventCount - session.events.length;
      session.pendingRedirects = session.pendingRedirects.filter((entry) => !deletedIds.has(entry.parentId) && !deletedTabs.has(entry.tabId));
      session.activeIntervals = session.activeIntervals.filter((entry) => !deletedTabs.has(entry.tabId));
      deletedTabs.forEach((id) => removedTabIds.add(id));
      if (deletedIds.size) {
        const nodes = new Map(session.nodes.map((node) => [node.id, node]));
        for (const node of session.nodes) {
          if (deletedIds.has(node.parentId)) {
            node.parentId = null;
            node.relationshipConfidence = 'external';
            node.confidence = 'low';
            node.navigationKind = 'external';
          }
        }
        const thresholds = effectiveThresholds(state.settings);
        for (const node of session.nodes) {
          // Bound traversal even if imported history contains a cycle.
          const seen = new Set([node.id]);
          let parent = nodes.get(node.parentId);
          let depth = 0;
          while (parent && !seen.has(parent.id)) {
            seen.add(parent.id);
            depth++;
            parent = nodes.get(parent.parentId);
          }
          node.depth = depth;
          if (!TERMINAL_STATES.has(node.state)) node.state = getDepthState(depth, session.interventionPaused, thresholds);
        }
      }
    }
    const compostCount = state.compostItems.length;
    state.compostItems = state.compostItems.filter((item) => !matches(item.url));
    removed += compostCount - state.compostItems.length;
    if (!removed) return NO_CHANGE;
    for (const [key, entry] of pendingBranches) {
      if (matches(entry.url) || removedNodeIds.has(entry.parentId) || removedTabIds.has(entry.sourceTabId)) pendingBranches.delete(key);
    }
    // SPA keys contain URLs; invalidating this small dedupe cache also removes
    // forgotten URLs without changing the user's permanent tracking settings.
    spaDedup.clear();
    for (const [key, entry] of activeTabs) {
      if (removedTabIds.has(entry.tabId)) activeTabs.delete(key);
    }
    removedTabIds.forEach((id) => navigationHints.delete(id));
    return { hostname, removed };
  });
}

// Remove saved item
async function removeSavedItem(id) {
  return mutate((state) => {
    const before = state.compostItems.length;
    state.compostItems = state.compostItems.filter(item => item.id !== id);
    return before === state.compostItems.length ? NO_CHANGE : state.compostItems;
  });
}

// Export all data
async function exportAllData() {
  const state = await loadState();
  return { data: state };
}

// Import data from a previously exported snapshot.
// Merges sessions/compost/events and replaces settings.
async function importAllData(payload) {
  if (!isRecord(payload) || !isRecord(payload.data)) throw new Error('invalid_payload');
  const incoming = payload.data;
  const incomingState = isRecord(incoming.state) ? incoming.state : incoming;
  
  // Validate session IDs, URLs, and timestamps before normalization
  if (Array.isArray(incomingState.sessions)) {
    for (const session of incomingState.sessions) {
      if (!session || typeof session !== 'object') continue;
      // Validate session ID format
      if (typeof session.id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(session.id)) {
        logWarning(new Error('Invalid session ID in import'), { category: ERROR_CATEGORIES.STORAGE, component: 'import', sessionId: session.id });
        continue;
      }
      // Validate origin URL
      if (session.origin?.url && !safeSessionUrl(session.origin.url)) {
        logWarning(new Error('Invalid origin URL in import'), { category: ERROR_CATEGORIES.STORAGE, component: 'import', url: session.origin.url });
        session.origin.url = 'chrome://newtab';
      }
      // Validate timestamp ranges (not in future, not too old)
      const now = Date.now();
      const ONE_DAY_MS = DAY_MS;
      const MAX_TIMESTAMP_FUTURE_MS = SERVICE_WORKER.RATE_LIMIT_WINDOW_MS; // 1 minute tolerance
      const MAX_AGE_MS = VALIDATION.MAX_TIMESTAMP_AGE_YEARS * 365 * ONE_DAY_MS;
      
      if (session.startedAt && (session.startedAt > now + MAX_TIMESTAMP_FUTURE_MS || session.startedAt < now - MAX_AGE_MS)) {
        logWarning(new Error('Invalid startedAt timestamp in import'), { category: ERROR_CATEGORIES.STORAGE, component: 'import', startedAt: session.startedAt });
        session.startedAt = now;
      }
      if (session.endedAt && (session.endedAt > now + MAX_TIMESTAMP_FUTURE_MS || session.endedAt < session.startedAt - MAX_AGE_MS)) {
        logWarning(new Error('Invalid endedAt timestamp in import'), { category: ERROR_CATEGORIES.STORAGE, component: 'import', endedAt: session.endedAt });
        session.endedAt = null;
      }
      // Validate nodes
      if (Array.isArray(session.nodes)) {
        for (const node of session.nodes) {
          if (!node || typeof node !== 'object') continue;
          if (node.url && !safeSessionUrl(node.url)) {
            logWarning(new Error('Invalid node URL in import'), { category: ERROR_CATEGORIES.STORAGE, component: 'import', url: node.url });
            node.url = 'chrome://newtab';
          }
          if (node.firstSeenAt && (node.firstSeenAt > now + MAX_TIMESTAMP_FUTURE_MS || node.firstSeenAt < now - MAX_AGE_MS)) {
            node.firstSeenAt = now;
          }
          if (node.depth && (typeof node.depth !== 'number' || node.depth < 0 || node.depth > LIMITS.NODES_PER_SESSION)) {
            node.depth = 0;
          }
        }
      }
    }
  }
  
  const next = normalizeState(incomingState);
  return mutate((current) => {
    // Imported records win ID conflicts as whole snapshots, including their
    // nodes/events. Move replacements to the end before applying the session cap.
    const sessionMap = new Map();
    for (const session of [...current.sessions, ...next.sessions]) {
      sessionMap.delete(session.id);
      sessionMap.set(session.id, session);
    }
    const mergedSessions = Array.from(sessionMap.values()).slice(-LIMITS.SESSIONS);
    const activeSessionId = mergedSessions.some((s) => s.id === next.activeSessionId)
      ? next.activeSessionId
      : (mergedSessions.some((s) => s.id === current.activeSessionId) ? current.activeSessionId : null);
    const compostMap = new Map();
    for (const item of [...next.compostItems, ...current.compostItems]) {
      if (item?.id && !compostMap.has(item.id)) compostMap.set(item.id, item);
    }
    // One catalog reward can be earned more than once; only identical
    // (rewardId, timestamp) occurrences represent duplicate imported history.
    const rewardMap = new Map();
    for (const reward of [...current.rewardHistory, ...next.rewardHistory]) {
      rewardMap.set(JSON.stringify([reward.rewardId, reward.timestamp]), reward);
    }
    Object.assign(current, {
      schemaVersion: SCHEMA_VERSION,
      sessions: mergedSessions,
      compostItems: Array.from(compostMap.values()).slice(0, LIMITS.COMPOST),
      rewardHistory: Array.from(rewardMap.values()).sort((a, b) => a.timestamp - b.timestamp),
      settings: next.settings,
      activeSessionId,
      onboardingCompleted: Boolean(current.onboardingCompleted || next.onboardingCompleted)
    });
    // saveState applies the existing normalized reward-history cap.
    return { imported: true };
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  wrapWithErrorBoundary(async () => {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    if (!result[STORAGE_KEY]) await saveState(emptyState());
    // Check initial storage quota after seeding
    await checkStorageQuota();
    await takeOverOpenNewTabs();
    if (details?.reason === 'install') {
      await chrome.tabs.create({ url: plantingPageUrl(), active: true });
    }
  }, { category: ERROR_CATEGORIES.STORAGE, component: 'service-worker', function: 'onInstalled', swallow: true })();
});

chrome.runtime.onInstalled.addListener(() => {
  wrapWithErrorBoundary(() => {
    chrome.contextMenus?.create({ id: 'focus-forest-start', title: 'Start Focus Mission for "%s"', contexts: ['link', 'page', 'selection'] });
    chrome.contextMenus?.create({ id: 'focus-forest-compost', title: 'Save Page for Later', contexts: ['page', 'link'] });
    chrome.contextMenus?.create({ id: 'focus-forest-end', title: 'End Current Focus Mission', contexts: ['page'] });
  }, { category: ERROR_CATEGORIES.MESSAGING, component: 'service-worker', function: 'contextMenus.create', swallow: true })();
});

chrome.contextMenus?.onClicked?.addListener((info, tab) => {
  wrapWithErrorBoundary(async () => {
    if (info.menuItemId === 'focus-forest-start') {
      const title = typeof info.selectionText === 'string' && info.selectionText.trim() ? info.selectionText.trim() : (tab?.title || tab?.url || 'New Tab');
      const mission = compactText(title, 140);
      if (!mission) return;
      const cleanUrl = safeHttpUrl(tab?.url);
      await createSession(mission, { id: tab?.id, url: cleanUrl || 'chrome://newtab', title: tab?.title || 'New Tab', windowId: tab?.windowId });
      if (tab?.id != null && cleanUrl) {
        await chrome.tabs.update(tab.id, { url: cleanUrl });
      }
    } else if (info.menuItemId === 'focus-forest-compost') {
      const targetUrl = safeHttpUrl(info.linkUrl || tab?.url);
      if (Number.isInteger(tab?.id) && targetUrl) {
        await compost(info.linkUrl ? null : tab.id, targetUrl, info.linkText || tab?.title || targetUrl);
      }
    } else if (info.menuItemId === 'focus-forest-end') {
      await endSession('user_ended');
    }
  }, { category: ERROR_CATEGORIES.MESSAGING, component: 'service-worker', function: 'contextMenus.onClicked', swallow: true })();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isRecord(message) || typeof message.type !== 'string') { sendResponse(null); return false; }
  if (sender?.id !== chrome.runtime.id) { sendResponse(null); return false; }
  
  // Rate limit messages from content scripts to prevent spam attacks
  const senderId = sender?.tab?.id ? `tab:${sender.tab.id}` : sender?.url ? `url:${sender.url}` : null;
  if (!checkRateLimit(senderId)) {
    logWarning(new Error('Message rate limit exceeded'), { 
      category: ERROR_CATEGORIES.MESSAGING, 
      senderId,
      messageType: message.type 
    });
    sendResponse(null);
    return false;
  }
  
  const tab = sender && typeof sender === 'object' && sender.tab && typeof sender.tab === 'object' ? sender.tab : null;
  if (!validateMessage(message)) { sendResponse(null); return false; }
  (async () => {
    switch (message.type) {
      case 'GET_SNAPSHOT': return isExtensionPageSender(sender) ? getSnapshot(safeId(message.sessionId) || null, Boolean(message.includeHistory)) : null;
      case 'GET_ACTIVE_VIEW': return activeView(await loadState(), tab?.id);
      case 'START_MISSION': {
        if (typeof message.mission !== 'string') return null;
        const activeTab = message.openSearch
          ? (tab?.id != null ? tab : (await chrome.tabs?.query?.({ active: true, currentWindow: true }).then((tabs) => tabs[0]).catch(() => null)))
          : null;
        const missionTab = sanitizeTab(tab) || sanitizeTab(activeTab) || sanitizeTab(message.tab);
        const session = await createSession(message.mission, missionTab, message.missionNote);
        if (message.openSearch && activeTab?.id != null && chrome.tabs?.update) {
          const settings = await loadState().then((state) => normalizeSettings(state.settings));
          // Use chrome.search API with try-catch for better cross-Chromium compatibility
          // Some Chromium-based browsers (Edge, Brave) may not fully support chrome.search.query
          if (settings.searchEngine === 'default') {
            try {
              if (chrome.search?.query) {
                await chrome.search.query({ text: compactText(message.mission, 140), tabId: activeTab.id });
              } else {
                // Fallback to URL navigation if search API unavailable
                const searchUrl = missionSearchUrl('google', message.mission);
                await chrome.tabs.update(activeTab.id, { url: searchUrl, active: true });
              }
            } catch (error) {
              logError(error, { category: ERROR_CATEGORIES.MESSAGING, operation: 'searchQuery' });
              // Fallback to URL navigation on error
              const searchUrl = missionSearchUrl('google', message.mission);
              await chrome.tabs.update(activeTab.id, { url: searchUrl, active: true });
            }
          } else {
            const searchUrl = missionSearchUrl(settings.searchEngine, message.mission);
            await chrome.tabs.update(activeTab.id, { url: searchUrl, active: true });
          }
        }
        return session;
      }
      case 'END_MISSION': return endSession(safeReason(message.reason));
      case 'LINK_CLICK': {
        if (!Number.isInteger(tab?.id)) return null;
        const linkUrl = safeHttpUrl(message.url);
        if (!linkUrl) return null;
        return trackLink({ tabId: tab.id, url: linkUrl, title: typeof message.title === 'string' ? message.title : '', targetBlank: Boolean(message.targetBlank), windowId: Number.isInteger(tab?.windowId) ? tab.windowId : null });
      }
      case 'OBSERVE_PAGE': {
        if (!Number.isInteger(tab?.id)) return null;
        return observeTab(tab.id, message.url, typeof message.title === 'string' ? message.title : '', tab.openerTabId, tab.windowId);
      }
      case 'SPA_NAVIGATION': {
        if (!Number.isInteger(tab?.id)) return null;
        const routeUrl = safeHttpUrl(message.url);
        if (!routeUrl || recentlyObservedSpa(tab.id, routeUrl)) return null;
        return trackLink({ tabId: tab.id, url: routeUrl, title: typeof message.title === 'string' ? message.title : '', targetBlank: false, windowId: Number.isInteger(tab?.windowId) ? tab.windowId : null, navigationKind: 'spa' });
      }
      case 'COMPOST': return Number.isInteger(tab?.id) ? compost(tab.id, message.url, message.title) : null;
      case 'PAUSE_INTERVENTION': return typeof message.paused === 'boolean' ? mutate((state) => {
        const session = activeSession(state);
        if (!session || session.interventionPaused === message.paused) return NO_CHANGE;
        session.interventionPaused = message.paused;
        const thresholds = effectiveThresholds(state.settings);
        session.nodes.forEach((node) => {
          if (!TERMINAL_STATES.has(node.state)) {
            node.state = getDepthState(node.depth, session.interventionPaused, thresholds);
          }
        });
        return session;
      }) : null;
      case 'PAUSE_SITE': return Number.isInteger(tab?.id) ? mutate((state) => {
        let hostname = null;
        try { hostname = new URL(tab.url || '').hostname.toLowerCase().replace(/^www\./, ''); } catch { return NO_CHANGE; }
        if (!hostname) return NO_CHANGE;
        const settings = normalizeSettings(state.settings);
        if (settings.excludedSites.includes(hostname)) return NO_CHANGE;
        settings.excludedSites = [...settings.excludedSites, hostname].slice(0, 40);
        state.settings = settings;
        return settings;
      }) : null;
      case 'UPDATE_SETTINGS': return isExtensionPageSender(sender) && isRecord(message.settings) ? mutate((state) => {
        const next = normalizeSettings({ ...state.settings, ...message.settings });
        if (JSON.stringify(next) === JSON.stringify(state.settings)) return NO_CHANGE;
        state.settings = next;
        const session = activeSession(state);
        if (session) {
          const thresholds = effectiveThresholds(next);
          session.nodes.forEach((node) => {
            if (!TERMINAL_STATES.has(node.state)) {
              node.state = getDepthState(node.depth, session.interventionPaused, thresholds);
            }
          });
        }
        return state.settings;
      }) : null;
      case 'DELETE_COMPOST': return isExtensionPageSender(sender) && safeId(message.id) ? mutate((state) => { const before = state.compostItems.length; state.compostItems = state.compostItems.filter((item) => item.id !== message.id); return before === state.compostItems.length ? NO_CHANGE : state.compostItems; }) : null;
      case 'PRUNE_NODE': return isExtensionPageSender(sender) && safeId(message.sessionId) && safeId(message.nodeId) ? pruneNode(message.sessionId, message.nodeId, Boolean(message.toCompost)) : null;
      case 'DELETE_SESSION': return isExtensionPageSender(sender) && safeId(message.sessionId) ? mutate((state) => { const before = state.sessions.length; state.sessions = state.sessions.filter((session) => session.id !== message.sessionId); if (state.activeSessionId === message.sessionId) { state.activeSessionId = null; clearRuntimeTracking(); } return before === state.sessions.length ? NO_CHANGE : state.sessions; }) : null;
      case 'FORGET_SITE': return isExtensionPageSender(sender) && typeof message.hostname === 'string' ? forgetSite(message.hostname) : null;
      case 'CLEAR_DATA':
      case 'CLEAR_ALL_DATA': return isExtensionPageSender(sender) ? (clearRuntimeTracking(), replaceState(emptyState())) : null;
      case 'GET_DASHBOARD_STATS': return isExtensionPageSender(sender) ? getDashboardStats() : null;
      case 'REMOVE_SAVED_ITEM': return isExtensionPageSender(sender) && safeId(message.id) ? removeSavedItem(message.id) : null;
      case 'EXPORT_DATA': return isExtensionPageSender(sender) ? exportAllData() : null;
      case 'IMPORT_DATA': return isExtensionPageSender(sender) && isRecord(message.payload) ? importAllData(message.payload) : null;
      case 'CHECK_STORAGE_QUOTA': return isExtensionPageSender(sender) ? checkStorageQuota() : null;
      case 'COMPLETE_ONBOARDING': return isExtensionPageSender(sender) ? mutate((state) => { state.onboardingCompleted = true; return state; }) : null;
      case 'GO_HOME': {
        const snapshot = await getSnapshot(); const origin = snapshot.session?.origin; const originTabId = Number.isInteger(origin?.tabId) ? origin.tabId : null; const returnUrl = safeNavigationUrl(origin?.url);
        // Only treat HTTP(S) origins as real navigation targets.
        // Extension pages and internal browser URLs are not useful "go home" destinations.
        const hasRealOrigin = Boolean(returnUrl) && /^https?:\/\//i.test(returnUrl);
        let returnedToOrigin = false;
        if (originTabId && hasRealOrigin) {
          try {
            const liveTab = await chrome.tabs.get(originTabId);
            // Additional validation: ensure tab still belongs to the same window session
            // This prevents navigating wrong tabs after browser restart when tab IDs may be reassigned
            const tabBelongsToSession = !origin.windowId || liveTab.windowId === origin.windowId;
            if (tabBelongsToSession && sameOriginUrl(liveTab?.url, origin.url)) { 
              if (chrome.windows?.update && Number.isInteger(liveTab.windowId)) await chrome.windows.update(liveTab.windowId, { focused: true }); 
              await chrome.tabs.update(originTabId, { url: returnUrl, active: true }); 
              returnedToOrigin = true; 
              
              const rewardResult = await mutate((state) => ({ reward: earnReward(state, returnRewardTier(state), 'return_to_root') }));
              returnedToOrigin = { returned: true, reward: rewardResult?.reward || null };
            }
          } catch { returnedToOrigin = false; }
        }
        const didReturn = returnedToOrigin === true || returnedToOrigin?.returned === true;
        const reward = returnedToOrigin?.reward || null;
        if (!didReturn && hasRealOrigin) await chrome.tabs.create({ url: returnUrl, active: true });
        return { ...activeView(await loadState(), didReturn ? originTabId : null), reward };
      }
      default: return null;
    }
  })()
  .then(sendResponse)
  .catch((error) => {
    logError(error, { category: ERROR_CATEGORIES.MESSAGING, component: 'service-worker', function: 'onMessage', messageType: message?.type });
    sendResponse({ error: 'INTERNAL_ERROR' });
  });
  return true;
});

const SCHEMAS = {
  GET_SNAPSHOT: { sessionId: 'string?', includeHistory: 'boolean?' },
  GET_ACTIVE_VIEW: {},
  START_MISSION: { mission: 'string', missionNote: 'string?', tab: 'object?', openSearch: 'boolean?' },
  END_MISSION: { reason: 'string?' },
  LINK_CLICK: { url: 'string', title: 'string?', targetBlank: 'boolean?' },
  OBSERVE_PAGE: { url: 'string', title: 'string?' },
  SPA_NAVIGATION: { url: 'string', title: 'string?' },
  COMPOST: { url: 'string', title: 'string?' },
  PAUSE_INTERVENTION: { paused: 'boolean' },
  PAUSE_SITE: {},
  UPDATE_SETTINGS: { settings: 'object' },
  DELETE_COMPOST: { id: 'string' },
  PRUNE_NODE: { sessionId: 'string', nodeId: 'string', toCompost: 'boolean?' },
  DELETE_SESSION: { sessionId: 'string' },
  FORGET_SITE: { hostname: 'string' },
  CLEAR_DATA: {},
  GET_DASHBOARD_STATS: {},
  REMOVE_SAVED_ITEM: { id: 'string' },
  EXPORT_DATA: {},
  IMPORT_DATA: { payload: 'object' },
  CLEAR_ALL_DATA: {},
  GO_HOME: {},
  CHECK_STORAGE_QUOTA: {},
  COMPLETE_ONBOARDING: {}
};
const TYPE_CHECKS = {
  string: (v) => typeof v === 'string',
  boolean: (v) => typeof v === 'boolean',
  object: (v) => v && typeof v === 'object' && !Array.isArray(v)
};
function validateMessage(message) {
  if (!isRecord(message) || !Object.hasOwn(message, 'type') || typeof message.type !== 'string') return false;
  if (!Object.hasOwn(SCHEMAS, message.type)) return false;
  const schema = SCHEMAS[message.type];
  for (const [key, kind] of Object.entries(schema)) {
    const optional = kind.endsWith('?');
    const base = optional ? kind.slice(0, -1) : kind;
    if (!Object.hasOwn(message, key)) {
      if (!optional) return false;
      continue;
    }
    if (message[key] == null) {
      if (!optional) return false;
      continue;
    }
    if (!TYPE_CHECKS[base](message[key])) return false;
  }
  return true;
}

chrome.webNavigation?.onHistoryStateUpdated?.addListener((details) => {
  return wrapWithErrorBoundary(async (details) => {
    if (details.frameId !== 0 || details.tabId == null || !details.url) return;
    if (recentlyObservedSpa(details.tabId, details.url)) return;
    const tab = await chrome.tabs.get(details.tabId);
    if (!tab) return;
    await trackLink({ tabId: tab.id, url: details.url, title: tab.title, targetBlank: false, windowId: Number.isInteger(tab.windowId) ? tab.windowId : null, navigationKind: 'spa' });
  }, { category: ERROR_CATEGORIES.NAVIGATION, component: 'service-worker', function: 'webNavigation.onHistoryStateUpdated', swallow: true })(details);
});

chrome.commands?.onCommand?.addListener((command) => {
  return wrapWithErrorBoundary(async () => {
    if (command !== 'toggle-mission') return;
    const state = await loadState();
    const session = activeSession(state);
    if (session) {
      await endSession('user_ended');
    } else {
      const tab = await chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]).catch(() => null);
      if (tab?.id != null && tab?.url) {
        await createSession(compactText(tab.title || tab.url, 140), { id: tab.id, url: tab.url, title: tab.title, windowId: tab.windowId });
      }
    }
  }, { category: ERROR_CATEGORIES.MESSAGING, component: 'service-worker', function: 'commands.onCommand', swallow: true })();
});

chrome.tabs.onCreated?.addListener((tab) => {
  return wrapWithErrorBoundary(async (tab) => {
    await takeOverBrowserNewTab(tab);
  }, { category: ERROR_CATEGORIES.NAVIGATION, component: 'service-worker', function: 'tabs.onCreated', swallow: true })(tab);
});
chrome.runtime.onSuspend?.addListener(() => {
  // Best-effort flush: the worker may terminate mid-queue, so attempt to
  // finish any pending mutation writes before shutdown. onSuspend cannot
  // guarantee completion, but catches the common idle-termination case.
  wrapWithErrorBoundary(() => mutationQueue.catch(() => undefined), { category: ERROR_CATEGORIES.STATE_MUTATION, component: 'service-worker', function: 'onSuspend', swallow: true })();
});
chrome.runtime.onStartup?.addListener(() => {
  wrapWithErrorBoundary(async () => {
    await takeOverOpenNewTabs();
    const tabs = await chrome.tabs.query({ active: true }).catch(() => []);
    await Promise.all(tabs.filter((tab) => Number.isInteger(tab.id)).map((tab) => recordActiveTab(tab.id, tab.windowId)));
  }, { category: ERROR_CATEGORIES.NAVIGATION, component: 'service-worker', function: 'onStartup', swallow: true })();
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  return wrapWithErrorBoundary(async (tabId, changeInfo, tab) => {
    if (await takeOverBrowserNewTab(tab)) return;
    if (changeInfo.status === 'complete' && tab.url) await observeTab(tabId, tab.url, tab.title, tab.openerTabId, tab.windowId);
  }, { category: ERROR_CATEGORIES.NAVIGATION, component: 'service-worker', function: 'tabs.onUpdated', swallow: true })(tabId, changeInfo, tab);
});
chrome.tabs.onActivated?.addListener((activeInfo) => {
  wrapWithErrorBoundary(() => recordActiveTab(activeInfo?.tabId, activeInfo?.windowId), { category: ERROR_CATEGORIES.NAVIGATION, component: 'service-worker', function: 'tabs.onActivated', swallow: true })();
});
chrome.webNavigation?.onCommitted?.addListener((details) => {
  if (details.frameId !== 0 || !Number.isInteger(details.tabId)) return;
  navigationHints.set(details.tabId, navigationKindForTransition(details.transitionType, details.transitionQualifiers || []));
  // FIFO eviction keeps the hint map bounded; hints are single-use and safe to drop.
  while (navigationHints.size > SERVICE_WORKER.MAX_ACTIVE_TABS) {
    navigationHints.delete(navigationHints.keys().next().value);
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  return wrapWithErrorBoundary(async (tabId) => {
    activeTabs.forEach((active, key) => { if (active.tabId === tabId) activeTabs.delete(key); });
    messageCounts.delete(`tab:${tabId}`);
    await mutate((state) => {
      const session = activeSession(state);
      if (!session) return NO_CHANGE;
      let changed = false;
      if (session.origin?.tabId === tabId) { session.origin.tabId = null; changed = true; }
      const pendingBefore = (session.pendingRedirects || []).length;
      clearPendingRedirect(session, tabId);
      if (session.pendingRedirects.length !== pendingBefore) changed = true;
      const node = nodeForTab(session, tabId);
      if (!node || node.closedAt) return changed ? session : NO_CHANGE;
      detachTab(node, tabId);
      if (!node.tabIds?.length) node.closedAt = Date.now();
      return node;
    });
  }, { category: ERROR_CATEGORIES.NAVIGATION, component: 'service-worker', function: 'tabs.onRemoved', swallow: true })(tabId);
});
