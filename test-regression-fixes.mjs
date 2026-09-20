// Regression tests for the 2026-09 audit fix batch (test-regression-fixes.mjs).
// Each block names the issue id it guards. Run: node test-regression-fixes.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// --- Minimal Chrome API stub (mirrors test-service-worker.mjs) ---
const store = {};
const tabActions = [];
const listeners = { installed: [], message: [], updated: [], removed: [], created: [], startup: [], committed: [], historyStateUpdated: [] };
const tabInfo = new Map();

globalThis.chrome = {
  storage: {
    local: {
      async get(key) { return key in store ? { [key]: structuredClone(store[key]) } : {}; },
      async set(value) { Object.assign(store, structuredClone(value)); }
    },
    sync: { async set() {} }
  },
  runtime: {
    id: 'test',
    getURL(path) { return `chrome-extension://test/${path}`; },
    onInstalled: { addListener(fn) { listeners.installed.push(fn); } },
    onMessage: { addListener(fn) { listeners.message.push(fn); } },
    onStartup: { addListener(fn) { listeners.startup.push(fn); } }
  },
  alarms: { create() {}, onAlarm: { addListener() {} } },
  webNavigation: { onCommitted: { addListener(fn) { listeners.committed.push(fn); } }, onHistoryStateUpdated: { addListener(fn) { listeners.historyStateUpdated.push(fn); } } },
  windows: { async update() {} },
  tabs: {
    onCreated: { addListener(fn) { listeners.created.push(fn); } },
    onUpdated: { addListener(fn) { listeners.updated.push(fn); } },
    onRemoved: { addListener(fn) { listeners.removed.push(fn); } },
    async query() { return [...tabInfo.values()].map((tab) => structuredClone(tab)); },
    async remove(id) { tabActions.push(['remove', id]); },
    async get(id) { const tab = tabInfo.get(id); if (!tab) throw new Error('No tab'); return structuredClone({ id, windowId: 1, ...tab }); },
    async update(id, patch) { const next = { ...(tabInfo.get(id) || { id, windowId: 1 }), ...patch }; tabInfo.set(id, next); tabActions.push(['update', id, patch]); },
    async create(info) { const id = 99 + tabInfo.size; tabInfo.set(id, { id, windowId: 1, ...info }); tabActions.push(['create', info]); return { id, ...info }; }
  }
};
globalThis.ServiceWorkerGlobalScope = class {};
globalThis.self = new globalThis.ServiceWorkerGlobalScope();

await import('./background/service-worker.js');
const handler = listeners.message[0];

function rawSend(message, sender) {
  return new Promise((resolve, reject) => handler(message, sender, (response) => response?.error ? reject(new Error(response.error)) : resolve(response)));
}
function send(message, tab = undefined) {
  if (tab?.id != null) { const current = { ...tab, windowId: 1 }; if (message?.type === 'OBSERVE_PAGE' && typeof message.url === 'string') { current.url = message.url; current.title = message.title || current.title; } tabInfo.set(tab.id, current); }
  const sender = tab ? { id: 'test', tab, url: `https://page.test/${tab.id}` } : { id: 'test', url: 'chrome-extension://test/dashboard/index.html' };
  return rawSend(message, sender);
}
const session = () => store.focusForestState.sessions.find((s) => s.id === store.focusForestState.activeSessionId);
const clear = () => send({ type: 'CLEAR_DATA' });

await test('B10: search fallback for "default" engine never routes to Google', async () => {
  await clear();
  // Simulate a Chromium fork without the Search API.
  chrome.search = undefined;
  tabActions.length = 0;
  await send({ type: 'START_MISSION', mission: 'quiet research', openSearch: true, tab: { id: 10, url: 'chrome://newtab', title: 'New Tab' } }, { id: 10 });
  const navigations = tabActions.filter(([action, id, patch]) => action === 'update' && id === 10 && typeof patch?.url === 'string');
  assert.equal(navigations.length, 1, 'fallback must navigate the active tab exactly once');
  assert.match(navigations[0][2].url, /^https:\/\/duckduckgo\.com\/\?q=/, 'fallback must use the privacy-preserving engine');
  assert.equal(navigations[0][2].url.includes('google'), false, 'fallback must never silently pick Google');
  await clear();
});

await test('B6: Forget Site on the origin host lets the session replant a fresh root', async () => {
  await clear();
  await send({ type: 'START_MISSION', mission: 'origin host', tab: { id: 7, url: 'chrome://newtab', title: 'New Tab' } });
  await send({ type: 'OBSERVE_PAGE', url: 'https://root.example/', title: 'Root' }, { id: 7 });
  await send({ type: 'OBSERVE_PAGE', url: 'https://keep.example/', title: 'Keep', openerTabId: 7 }, { id: 8, openerTabId: 7 });
  // Baseline: an unlinked tab is ignored while a real origin is planted.
  assert.equal(await send({ type: 'OBSERVE_PAGE', url: 'https://solo.example/', title: 'Solo' }, { id: 9 }), null);

  const forget = await send({ type: 'FORGET_SITE', hostname: 'root.example' });
  assert.ok(forget?.removed > 0);
  assert.equal(session().origin.url, 'chrome://newtab', 'origin must reset to the standard placeholder so replanting can happen');

  const replanted = await send({ type: 'OBSERVE_PAGE', url: 'https://solo.example/', title: 'Solo' }, { id: 9 });
  assert.ok(replanted && typeof replanted === 'object' && !('error' in replanted), 'an unlinked tab must plant a fresh root after the origin was forgotten');
  const nodes = session().nodes;
  const freshRoot = nodes.find((node) => node.url === 'https://solo.example/');
  assert.ok(freshRoot, 'the new root node must exist');
  assert.equal(freshRoot.depth, 0);
  assert.equal(freshRoot.parentId, null);
  const survivor = nodes.find((node) => node.id !== freshRoot.id);
  assert.equal(survivor?.url, 'https://keep.example/', 'replanting must not overwrite unrelated surviving nodes');
  assert.equal(session().origin.url, 'https://solo.example/', 'origin must follow the replanted root');
  await clear();
});

await test('B7: compost entries carry no fabricated depth', async () => {
  await clear();
  await send({ type: 'START_MISSION', mission: 'compost depth', tab: { id: 7, url: 'chrome://newtab', title: 'New Tab' } });
  await send({ type: 'COMPOST', url: 'https://snack.example/article', title: 'Snack' }, { id: 7 });
  const item = store.focusForestState.compostItems[0];
  assert.ok(item, 'compost item must be stored');
  assert.equal(Object.hasOwn(item, 'depth'), false, 'compost items must not invent a depth field');
  const exported = (await send({ type: 'EXPORT_DATA' })).data;
  assert.equal(Object.hasOwn(exported.compostItems[0], 'depth'), false, 'compaction must not re-add depth');
  await clear();
});

await test('B1: dismissing the choice sheet is recorded and counted', async () => {
  await clear();
  await send({ type: 'START_MISSION', mission: 'dismiss counting', tab: { id: 7, url: 'chrome://newtab', title: 'New Tab' } });
  await send({ type: 'OBSERVE_PAGE', url: 'https://deep.example/', title: 'Deep' }, { id: 7 });
  assert.equal(await send({ type: 'DISMISS_INTERVENTION', url: 'https://deep.example/' }), null, 'dismissals require a tab sender');
  const counted = await send({ type: 'DISMISS_INTERVENTION', url: 'https://deep.example/' }, { id: 7 });
  assert.deepEqual(counted, { counted: true });
  assert.equal(session().events.filter((event) => event.type === 'interruption_dismissed').length, 1, 'one dismissal must be recorded once');
  const stats = await send({ type: 'GET_DASHBOARD_STATS' });
  assert.equal(stats.interruptionsDismissed, 1, 'dashboard stats must surface recorded dismissals');
  await clear();
});

await test('legacy migration: sessions frozen by the old Forget-Site bug heal on observation', async () => {
  await clear();
  const { clearStateCache } = await import('./shared/state.js');
  const now = Date.now();
  // Seed storage exactly the way an old install would have persisted it after
  // forgetting the origin host: dashboard URL as origin, no way to replant.
  store.focusForestState = {
    schemaVersion: 4,
    activeSessionId: 'legacy_frozen',
    sessions: [{
      id: 'legacy_frozen', mission: 'frozen session', note: '', status: 'active', startedAt: now - 60000, endedAt: null, endReason: null,
      origin: { tabId: null, windowId: null, url: 'chrome-extension://test/dashboard/index.html', title: 'Forgotten origin' },
      nodes: [{ id: 'survivor', tabIds: [], url: 'https://kept.example/', title: 'Kept', parentId: null, depth: 0, firstSeenAt: now - 50000, relationshipConfidence: 'external', confidence: 'low', navigationKind: 'external', state: 'normal' }],
      events: [], activeIntervals: [], pendingRedirects: [], interventionPaused: false
    }],
    compostItems: [], settings: {}, onboardingCompleted: true, rewardHistory: []
  };
  clearStateCache(); // drop the in-memory cache so the next read goes through normalizeState

  const replanted = await send({ type: 'OBSERVE_PAGE', url: 'https://thawed.example/', title: 'Thawed' }, { id: 31 });
  assert.ok(replanted && typeof replanted === 'object', 'a session frozen by the legacy bug must accept new roots again');
  const fresh = session().nodes.find((node) => node.url === 'https://thawed.example/');
  assert.ok(fresh, 'the replanted root must exist');
  assert.equal(fresh.depth, 0);
  assert.ok(session().nodes.some((node) => node.url === 'https://kept.example/'), 'pre-existing survivor node must be preserved');
  assert.equal(session().origin.url, 'https://thawed.example/', 'origin must follow the replanted root');

  // The legitimate placeholder (our own newtab page) must NOT be rewritten by the migration.
  await clear();
  store.focusForestState = {
    schemaVersion: 4, activeSessionId: 'legit_placeholder',
    sessions: [{ id: 'legit_placeholder', mission: 'placeholder', status: 'active', startedAt: now, endedAt: null, endReason: null,
      origin: { tabId: 5, windowId: 1, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' },
      nodes: [], events: [], activeIntervals: [], pendingRedirects: [], interventionPaused: false }],
    compostItems: [], settings: {}, onboardingCompleted: true, rewardHistory: []
  };
  clearStateCache();
  const snap = await send({ type: 'GET_SNAPSHOT' });
  assert.equal(snap.session.origin.url, 'chrome-extension://test/newtab/index.html', 'the extension newtab placeholder must survive normalization untouched');
  await clear();
});

// NOTE on B9 (per-tab in-memory map cleanup in tabs.onRemoved): after a tab is
// removed, the worker always detaches that tab from its node, so no public
// message can distinguish "dedupe entry cleared" from "entry leaked" — both
// produce the same response. It is therefore guarded by the source sentinel
// below plus the TTL/size caps that already bound those maps.
await test('tabs.onRemoved still closes nodes after the cleanup additions', async () => {
  await clear();
  await send({ type: 'START_MISSION', mission: 'close cleanup', tab: { id: 7, url: 'chrome://newtab', title: 'New Tab' } });
  await send({ type: 'OBSERVE_PAGE', url: 'https://spa.example/', title: 'SPA' }, { id: 7 });
  await listeners.removed[0](7);
  const node = session().nodes.find((item) => item.url === 'https://spa.example/');
  assert.ok(node, 'node must exist');
  assert.ok(Number.isFinite(node.closedAt), 'closing the tab must close its node');
  assert.deepEqual(node.tabIds, [], 'closing the tab must detach it from the node');
  await clear();
});

await test('source-level sentinels for the remaining fixes', async () => {
  const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url)));
  assert.equal(manifest.content_security_policy.extension_pages.includes("'unsafe-inline'"), false, 'B15: extension pages must not allow inline styles');

  const gitignore = readFileSync(new URL('./.gitignore', import.meta.url), 'utf8').trim().split('\n');
  assert.notEqual(gitignore[0].trim(), '```', '.gitignore must not be wrapped in a markdown fence');
  assert.notEqual(gitignore.at(-1).trim(), '```', '.gitignore must not be wrapped in a markdown fence');

  const dashboard = readFileSync(new URL('./dashboard/app.js', import.meta.url), 'utf8');
  assert.ok(dashboard.includes('(b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt)'), 'session list comparator must use each row\'s own timestamps');

  const content = readFileSync(new URL('./content/content.js', import.meta.url), 'utf8');
  assert.ok(content.includes("send('DISMISS_INTERVENTION'"), 'content script must report dismissals');
  assert.ok(content.indexOf('originRitualPlayed = true') < content.indexOf('waitForGrowth(1200'), 'B16: origin ritual must be marked before the animation awaits');

  const worker = readFileSync(new URL('./background/service-worker.js', import.meta.url), 'utf8');
  const removedStart = worker.indexOf('chrome.tabs.onRemoved.addListener');
  const removedBlock = worker.slice(removedStart, removedStart + 1200);
  assert.ok(removedBlock.includes('navigationHints.delete(tabId)'), 'B9: tab-close cleanup must include navigation hints');
  assert.ok(removedBlock.includes('spaDedup'), 'B9: tab-close cleanup must include the SPA dedupe map');
  assert.ok(removedBlock.includes('pendingBranches'), 'B9: tab-close cleanup must include pending branches');
  assert.ok(!worker.includes("chrome.runtime.getURL('dashboard/index.html'), title: 'Forgotten origin'"), 'B6: forgotten origins must not be replaced with an extension URL');

  const popup = readFileSync(new URL('./popup/app.js', import.meta.url), 'utf8');
  assert.ok(popup.includes('reflection.deepest > 0 ? 4 : 0'), 'popup meter must allow a truthful 0% fill');

  const state = readFileSync(new URL('./shared/state.js', import.meta.url), 'utf8');
  assert.equal(state.includes('interventionsPaused'), false, 'B2: the dead interventionsPaused field must be gone from the state module');
});

console.log('test-regression-fixes.mjs: all regression checks passed');
