// Regression tests for the 2026-09-21 deep audit fixes.
// Covers: storage-read-failure data wipe, spurious reload events, unpersisted
// search_refinement events, blocked web->extension navigation (OPEN_PLANTING_PAGE),
// context-menu duplicate-id rejections, import endedAt validation, Brave search
// detection scoping, [hidden] CSS guards, and the MAIN-world SPA bridge wiring.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const store = {};
const listeners = { installed: [], message: [], committed: [], historyStateUpdated: [], created: [], updated: [], removed: [] };
const tabActions = [];
const tabInfo = new Map();
const menuActions = [];
let failGets = 0;
let menuCreateShouldReject = false;
const unhandled = [];
process.on('unhandledRejection', (reason) => unhandled.push(reason));

globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (failGets > 0) { failGets -= 1; throw new Error('simulated transient read failure'); }
        return key in store ? { [key]: structuredClone(store[key]) } : {};
      },
      async set(value) { Object.assign(store, structuredClone(value)); }
    }
  },
  runtime: {
    id: 'test',
    getURL(path) { return `chrome-extension://test/${path}`; },
    onInstalled: { addListener(fn) { listeners.installed.push(fn); } },
    onMessage: { addListener(fn) { listeners.message.push(fn); } }
  },
  alarms: { create() {}, onAlarm: { addListener() {} } },
  search: { async query() {} },
  contextMenus: {
    async removeAll() { menuActions.push(['removeAll']); },
    async create(item) {
      if (menuCreateShouldReject) { menuCreateShouldReject = false; throw new Error('Cannot create item with duplicate id'); }
      menuActions.push(['create', item.id]);
    }
  },
  webNavigation: {
    onCommitted: { addListener(fn) { listeners.committed.push(fn); } },
    onHistoryStateUpdated: { addListener(fn) { listeners.historyStateUpdated.push(fn); } }
  },
  windows: { async update() {} },
  tabs: {
    onCreated: { addListener(fn) { listeners.created.push(fn); } },
    onUpdated: { addListener(fn) { listeners.updated.push(fn); } },
    onRemoved: { addListener(fn) { listeners.removed.push(fn); } },
    async query() { return [...tabInfo.values()].map((t) => structuredClone(t)); },
    async get(id) { const tab = tabInfo.get(id); if (!tab) throw new Error('No tab'); return structuredClone({ id, windowId: 1, ...tab }); },
    async update(id, patch) { const next = { ...(tabInfo.get(id) || { id, windowId: 1 }), ...patch }; tabInfo.set(id, next); tabActions.push(['update', id, patch]); },
    async create(info) { const id = 999 + tabInfo.size; tabInfo.set(id, { id, windowId: 1, ...info }); tabActions.push(['create', info]); return { id, ...info }; }
  }
};
globalThis.ServiceWorkerGlobalScope = class {};
globalThis.self = new globalThis.ServiceWorkerGlobalScope();

await import('./background/service-worker.js');
// Same module instance the worker uses (identical resolved specifier), so the
// cache controls below act on the worker's live state cache.
const { clearStateCache, isSearchUrl } = await import('./shared/state.js');

const handler = listeners.message[0];
async function rawSend(message, sender) {
  return await new Promise((resolve, reject) => handler(message, sender, (response) => response?.error ? reject(new Error(response.error)) : resolve(response)));
}
async function send(message, tab = undefined) {
  const sender = tab
    ? { id: 'test', tab, url: `https://page.test/${tab.id}` }
    : { id: 'test', url: 'chrome-extension://test/dashboard/index.html' };
  return rawSend(message, sender);
}
function session() { return store.focusForestState.sessions.find((s) => s.id === store.focusForestState.activeSessionId); }

await test('A1: a transient storage read failure aborts mutations instead of wiping durable data', async () => {
  clearStateCache();
  await send({ type: 'CLEAR_DATA' });
  await send({ type: 'START_MISSION', mission: 'Precious garden', tab: { id: 7, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
  await send({ type: 'OBSERVE_PAGE', url: 'https://example.com/start', title: 'Start' }, { id: 7 });
  assert.equal(store.focusForestState.sessions.length, 1, 'fixture mission must be persisted');

  // Simulate a worker restart / external invalidation so the next load hits
  // storage, then fail BOTH the attempt and its retry: the mutation must abort
  // with an error instead of running against (and persisting) an empty
  // fallback state.
  clearStateCache();
  failGets = 2;
  await assert.rejects(
    send({ type: 'PAUSE_INTERVENTION', paused: true }),
    /INTERNAL_ERROR/,
    'a failed state read must surface as an error, not as a silent empty state'
  );
  assert.equal(failGets, 0, 'both read attempts must have been exercised');
  assert.equal(store.focusForestState.sessions.length, 1, 'durable data must survive a failed read');
  assert.equal(store.focusForestState.sessions[0].mission, 'Precious garden', 'no session may be lost or replaced by an empty fallback');
  assert.equal(session().interventionPaused, false, 'the aborted mutation must not half-apply');

  // A single-attempt (truly transient) failure is recovered by the retry
  // against freshly loaded state — and still never wipes anything.
  clearStateCache();
  failGets = 1;
  await send({ type: 'PAUSE_INTERVENTION', paused: true });
  assert.equal(session().interventionPaused, true, 'mutations must recover once storage reads succeed again');
  assert.equal(store.focusForestState.sessions[0].mission, 'Precious garden');
});

await test('A2: dual-observed commits never double-record; tracked links never record reloads', async () => {
  clearStateCache();
  await send({ type: 'CLEAR_DATA' });
  await send({ type: 'START_MISSION', mission: 'Research laptops', tab: { id: 7, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
  await send({ type: 'OBSERVE_PAGE', url: 'https://example.com/start', title: 'Start' }, { id: 7 });

  // Ordinary link click: trackLink records 'navigation'; production then
  // observes the SAME commit twice (content OBSERVE_PAGE + tabs.onUpdated).
  // The tracked-nav mark plus the same-URL window must keep reloads at zero.
  await send({ type: 'LINK_CLICK', url: 'https://example.com/page-a', title: 'Page A', targetBlank: false }, { id: 7 });
  listeners.committed[0]?.({ frameId: 0, tabId: 7, transitionType: 'link', transitionQualifiers: [], url: 'https://example.com/page-a' });
  await send({ type: 'OBSERVE_PAGE', url: 'https://example.com/page-a', title: 'Page A' }, { id: 7 });
  await send({ type: 'OBSERVE_PAGE', url: 'https://example.com/page-a', title: 'Page A' }, { id: 7 });
  const events = session().events.map((e) => e.type);
  assert.ok(events.includes('navigation'), 'the link click itself must still record its navigation event');
  assert.equal(events.filter((t) => t === 'reload').length, 0, 'a tracked link navigation must not be relabelled as a reload by either observation');
  assert.equal(session().nodes.at(-1).depth, 1, 'the branch must still grow from the link click');

  // A genuine reload, observed twice like production, records exactly one —
  // immediately after the link commit (commit memos are timing-independent).
  listeners.committed[0]?.({ frameId: 0, tabId: 7, transitionType: 'reload', transitionQualifiers: [], url: 'https://example.com/page-a' });
  await send({ type: 'OBSERVE_PAGE', url: 'https://example.com/page-a', title: 'Page A' }, { id: 7 });
  await send({ type: 'OBSERVE_PAGE', url: 'https://example.com/page-a', title: 'Page A' }, { id: 7 });
  assert.equal(session().events.filter((e) => e.type === 'reload').length, 1, 'a real reload must still be recorded exactly once');

  // Back/forward, observed twice, records exactly one back_forward, no reload.
  listeners.committed[0]?.({ frameId: 0, tabId: 7, transitionType: 'back_forward', transitionQualifiers: [], url: 'https://example.com/page-a' });
  await send({ type: 'OBSERVE_PAGE', url: 'https://example.com/page-a', title: 'Page A' }, { id: 7 });
  await send({ type: 'OBSERVE_PAGE', url: 'https://example.com/page-a', title: 'Page A' }, { id: 7 });
  assert.equal(session().events.filter((e) => e.type === 'back_forward').length, 1, 'back/forward returns must keep their own single event');
  assert.equal(session().events.filter((e) => e.type === 'reload').length, 1, 'back/forward must not add reloads');
});

await test('A3: search_refinement events are persisted, not left in the cache only', async () => {
  clearStateCache();
  await send({ type: 'CLEAR_DATA' });
  await send({ type: 'START_MISSION', mission: 'Research', tab: { id: 7, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
  await send({ type: 'OBSERVE_PAGE', url: 'https://example.com/start', title: 'Start' }, { id: 7 });
  const nodesBefore = session().nodes.length;
  await send({ type: 'OBSERVE_PAGE', url: 'https://duckduckgo.com/?q=later+refinement', title: 'Search' }, { id: 7 });

  // The commit's twin observation must not double-record the refinement.
  await send({ type: 'OBSERVE_PAGE', url: 'https://duckduckgo.com/?q=later+refinement', title: 'Search' }, { id: 7 });

  const persisted = store.focusForestState.sessions.find((s) => s.id === store.focusForestState.activeSessionId).events.map((e) => e.type);
  const snapshot = await send({ type: 'GET_SNAPSHOT' });
  const inMemory = snapshot.session.events.map((e) => e.type);
  assert.ok(persisted.includes('search_refinement'), 'the refinement event must reach durable storage immediately');
  assert.equal(persisted.filter((t) => t === 'search_refinement').length, 1, 'one commit records exactly one refinement (dual-observation safe)');
  assert.deepEqual(inMemory, persisted, 'cache and storage must not diverge after a refinement');
  assert.equal(session().nodes.length, nodesBefore, 'a search refinement must not grow a branch');
});

await test('A14: origin replant and known-page reuse observed twice record no spurious reload', async () => {
  clearStateCache();
  await send({ type: 'CLEAR_DATA' });
  await send({ type: 'START_MISSION', mission: 'Replant probe', tab: { id: 7, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
  // First ordinary page: observation #1 replants the placeholder root...
  listeners.committed[0]?.({ frameId: 0, tabId: 7, transitionType: 'typed', transitionQualifiers: [], url: 'https://serp.example/results' });
  await send({ type: 'OBSERVE_PAGE', url: 'https://serp.example/results', title: 'Results' }, { id: 7 });
  // ...observation #2 (the tabs.onUpdated twin) arrives hint-less.
  await send({ type: 'OBSERVE_PAGE', url: 'https://serp.example/results', title: 'Results' }, { id: 7 });
  let events = session().events.map((e) => e.type);
  assert.equal(events.filter((t) => t === 'origin_planted').length, 1, 'the root is planted exactly once');
  assert.equal(events.filter((t) => t === 'reload').length, 0, 'the twin observation must not stamp a reload on the fresh root');
  assert.equal(session().nodes.length, 1, 'no duplicate root node');
  assert.equal(session().nodes[0].confidence, 'high', 'the twin must not degrade the root confidence either');

  // Known-page reuse (another tab returns to a tracked URL) is twin-safe too.
  await send({ type: 'OBSERVE_PAGE', url: 'https://serp.example/results', title: 'Results' }, { id: 8 });
  await send({ type: 'OBSERVE_PAGE', url: 'https://serp.example/results', title: 'Results' }, { id: 8 });
  events = session().events.map((e) => e.type);
  assert.equal(events.filter((t) => t === 'return_to_path' || t === 'tab_joined_path').length, 1, 'known-page reuse records exactly one note');
  assert.equal(events.filter((t) => t === 'reload').length, 0, 'known-page reuse twin adds no reload');
});

await test('A4: OPEN_PLANTING_PAGE navigates the sender tab (web pages cannot navigate to extension URLs themselves)', async () => {
  clearStateCache();
  tabActions.length = 0;
  const result = await send({ type: 'OPEN_PLANTING_PAGE' }, { id: 42, url: 'https://deep.example/rabbit/hole', title: 'Deep page' });
  assert.deepEqual(result, { opened: true });
  const update = tabActions.findLast((a) => a[0] === 'update' && a[1] === 42);
  assert.ok(update, 'the worker must navigate the requesting tab');
  assert.equal(update[2].url, 'chrome-extension://test/newtab/index.html');

  tabActions.length = 0;
  const withoutTab = await send({ type: 'OPEN_PLANTING_PAGE' });
  assert.equal(withoutTab, null, 'senders without a tab must be rejected');
  assert.equal(tabActions.filter((a) => a[0] === 'update').length, 0, 'no navigation may happen without a sender tab');
});

await test('A5: context-menu registration is idempotent and duplicate-id rejections are swallowed', async () => {
  // onInstalled listeners: [storage seeding, context menus]
  assert.equal(listeners.installed.length, 2, 'both onInstalled listeners must be registered');
  menuActions.length = 0;
  await listeners.installed[1]({ reason: 'install' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(menuActions, [['removeAll'], ['create', 'focus-forest-start'], ['create', 'focus-forest-compost'], ['create', 'focus-forest-end']], 'removeAll must run first so re-registration cannot hit duplicate ids');

  // Even when a create rejects (stale duplicate), the failure is logged and
  // swallowed instead of surfacing as an unhandled promise rejection.
  menuActions.length = 0;
  menuCreateShouldReject = true;
  await listeners.installed[1]({ reason: 'update' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(unhandled.length, 0, 'duplicate-id menu rejections must never become unhandled rejections');
});

await test('A6: imported sessions ending before they started are repaired to an open-ended record', async () => {
  clearStateCache();
  await send({ type: 'CLEAR_DATA' });
  const now = Date.now();
  await send({
    type: 'IMPORT_DATA',
    payload: {
      data: {
        sessions: [{
          id: 'session-bad-range', mission: 'Time-tangled import', status: 'completed',
          startedAt: now, endedAt: now - 60000, endReason: 'user_ended',
          origin: { tabId: null, windowId: null, url: 'chrome://newtab', title: 'New Tab' },
          nodes: [], events: [], activeIntervals: [], pendingRedirects: []
        }]
      }
    }
  });
  const imported = store.focusForestState.sessions.find((s) => s.id === 'session-bad-range');
  assert.ok(imported, 'the imported session must survive validation');
  assert.equal(imported.endedAt, null, 'endedAt before startedAt must be cleared, not stored');
});

await test('A7: Brave search detection is scoped to search.brave.com', () => {
  assert.equal(isSearchUrl('https://search.brave.com/'), true, 'the Brave Search home is a search page');
  assert.equal(isSearchUrl('https://search.brave.com/search?q=trees'), true, 'Brave Search results are search pages');
  assert.equal(isSearchUrl('https://www.brave.com/'), false, 'the Brave marketing site root must not be misread as a search page');
  assert.equal(isSearchUrl('https://www.brave.com/features'), false, 'ordinary Brave marketing pages are not search pages');
  // A ?q= parameter on any known search-domain family still counts (generic
  // SEARCH_PARAMS rule shared with duckduckgo.com/?q=, bing.com/?q=, etc.).
  assert.equal(isSearchUrl('https://duckduckgo.com/?q=test'), true, 'the generic query-parameter rule is unchanged');
});

await test('A8: popup and New Tab stylesheets keep the hidden attribute authoritative', () => {
  for (const file of ['./popup/style.css', './newtab/style.css', './dashboard/style.css']) {
    const css = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/, `${file} must guard [hidden] against author display rules`);
  }
});

await test('A9: the companion never navigates the page to an extension URL directly', () => {
  const content = readFileSync(new URL('./content/content.js', import.meta.url), 'utf8');
  assert.ok(!content.includes("window.location.href = chrome.runtime.getURL"), 'web-origin navigation to chrome-extension:// URLs is blocked without web_accessible_resources');
  assert.match(content, /send\('OPEN_PLANTING_PAGE'\)/, 'the mission action must ask the worker to navigate instead');
  assert.match(content, /chrome\.storage\?\.onChanged\?\.addListener/, 'the companion must sync with cross-context state changes');
  assert.match(content, /focus-forest-history/, 'the companion must listen for the MAIN-world SPA bridge event');
  assert.equal(/setInterval\(/.test(content), false, 'companion timers must stay bounded');

  const bridge = readFileSync(new URL('./content/spa-bridge.js', import.meta.url), 'utf8');
  const checked = spawnSync(process.execPath, ['--check', new URL('./content/spa-bridge.js', import.meta.url).pathname], { encoding: 'utf8' });
  assert.equal(checked.status, 0, `spa-bridge.js must parse as a classic script:\n${checked.stderr}`);
  assert.match(bridge, /history\.pushState/, 'the bridge must wrap pushState in the page world');
  assert.match(bridge, /history\.replaceState/, 'the bridge must wrap replaceState in the page world');
  assert.match(bridge, /focus-forest-history/, 'the bridge must announce via the namespaced DOM event');

  const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
  const bridgeEntry = (manifest.content_scripts || []).find((entry) => (entry.js || []).includes('content/spa-bridge.js'));
  assert.ok(bridgeEntry, 'the bridge must be registered as a content script');
  assert.equal(bridgeEntry.world, 'MAIN', 'the bridge only works in the page world');
  assert.equal(bridgeEntry.run_at, 'document_start', 'the bridge must wrap history before page scripts run');
  assert.ok(Number(manifest.minimum_chrome_version) >= 111, 'manifest world:"MAIN" requires Chrome 111+');
  assert.deepEqual(manifest.web_accessible_resources, [], 'the fix must not open any web-accessible resources');
});

await test('A10: self-link reloads are recorded exactly once via commit-verified marks', async () => {
  clearStateCache();
  await send({ type: 'CLEAR_DATA' });
  await send({ type: 'START_MISSION', mission: 'Self-link probe', tab: { id: 7, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
  await send({ type: 'OBSERVE_PAGE', url: 'https://example.com/doc', title: 'Doc' }, { id: 7 });

  // A link to the URL the tab already shows is a genuine reload-by-link:
  // trackLink finds the existing node (no navigation event), marks it, and
  // the dual commit observation must record exactly one 'reload' — with no
  // timing assumptions (commit memos are keyed per commit, not per window).
  const before = session().events.length;
  await send({ type: 'LINK_CLICK', url: 'https://example.com/doc', title: 'Doc (self link)', targetBlank: false }, { id: 7 });
  listeners.committed[0]?.({ frameId: 0, tabId: 7, transitionType: 'link', transitionQualifiers: [], url: 'https://example.com/doc' });
  await send({ type: 'OBSERVE_PAGE', url: 'https://example.com/doc', title: 'Doc' }, { id: 7 });
  await send({ type: 'OBSERVE_PAGE', url: 'https://example.com/doc', title: 'Doc' }, { id: 7 });
  const recorded = session().events.slice(before).map((e) => e.type);
  assert.deepEqual(recorded, ['reload'], 'a dual-observed self-link reload must record exactly one reload event');

  // The hint-less twin and hint-carrying repeats add nothing without a mark.
  listeners.committed[0]?.({ frameId: 0, tabId: 7, transitionType: 'link', transitionQualifiers: [], url: 'https://example.com/doc' });
  await send({ type: 'OBSERVE_PAGE', url: 'https://example.com/doc', title: 'Doc' }, { id: 7 });
  assert.equal(session().events.filter((e) => e.type === 'reload').length, 1, 'observations inside the window must not replay events');

  // A 'link'-hint observation without a fresh mark is still suppressed (the
  // mark was single-use and is gone; the hint branch covers it).
  listeners.committed[0]?.({ frameId: 0, tabId: 7, transitionType: 'link', transitionQualifiers: [], url: 'https://example.com/doc' });
  await send({ type: 'OBSERVE_PAGE', url: 'https://example.com/doc', title: 'Doc' }, { id: 7 });
  assert.equal(session().events.filter((e) => e.type === 'reload').length, 1, 'marks must not replay into extra reload events');

  // A target=_blank click on the current URL opens a new tab; it is not a
  // reload of this tab and must not leave a mark behind.
  await send({ type: 'LINK_CLICK', url: 'https://example.com/doc', title: 'Doc', targetBlank: true }, { id: 7 });
  listeners.committed[0]?.({ frameId: 0, tabId: 7, transitionType: 'link', transitionQualifiers: [], url: 'https://example.com/doc' });
  await send({ type: 'OBSERVE_PAGE', url: 'https://example.com/doc', title: 'Doc' }, { id: 7 });
  assert.equal(session().events.filter((e) => e.type === 'reload').length, 1, 'new-tab self-links must not fabricate reloads');
});

await test('A11: completed sessions without a usable endedAt never accrue phantom time', async () => {
  clearStateCache();
  await send({ type: 'CLEAR_DATA' });
  const now = Date.now();
  const DAY = 86400000;
  await send({
    type: 'IMPORT_DATA',
    payload: {
      data: {
        sessions: [{
          id: 'session-inverted', mission: 'Inverted import', status: 'completed',
          startedAt: now - 90 * DAY, endedAt: now - 91 * DAY, // ends before it starts
          origin: { url: 'chrome://newtab', title: 'New Tab' },
          nodes: [], events: [], activeIntervals: [], pendingRedirects: []
        }]
      }
    }
  });
  const imported = store.focusForestState.sessions.find((s) => s.id === 'session-inverted');
  assert.equal(imported.endedAt, null, 'the inverted endedAt must be repaired to null');
  const stats = await send({ type: 'GET_DASHBOARD_STATS' });
  assert.equal(stats.totalFocusTime, 0, 'a repaired completed session must count as zero-length, not accrue to now');
  const invertedRow = stats.history.find((row) => row.timestamp <= now - 89 * DAY);
  assert.ok(invertedRow, 'the repaired session must still appear in recent history');
  assert.equal(invertedRow.duration, 0, 'the history table must not show a phantom 90-day session');
  assert.ok(stats.weeklyData.every((day) => day.minutes === 0), 'weekly minutes must not be inflated by the repaired session');

  // Genuinely active sessions still accrue elapsed time up to now.
  await send({ type: 'START_MISSION', mission: 'Live garden', tab: { id: 7, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
  store.focusForestState.sessions.find((s) => s.id === store.focusForestState.activeSessionId).startedAt = now - 3600000;
  clearStateCache();
  const liveStats = await send({ type: 'GET_DASHBOARD_STATS' });
  assert.ok(liveStats.totalFocusTime >= 3599 && liveStats.totalFocusTime <= 3601, `active session time must still accrue (got ${liveStats.totalFocusTime})`);
});

await test('A12: V2 hardening sentinels (visibility gate, isolated bookkeeping, frozen-history bridge)', async () => {
  const content = readFileSync(new URL('./content/content.js', import.meta.url), 'utf8');
  assert.match(content, /if \(document\.hidden\) return;\s*\n\s*if \(Date\.now\(\) - lastRefreshAt < STORAGE_SYNC_MIN_GAP_MS\) return;/, 'storage sync must skip hidden tabs before spending rate-limit budget');

  const worker = readFileSync(new URL('./background/service-worker.js', import.meta.url), 'utf8');
  assert.match(worker, /try \{\s*\n\s*await recordActiveTab\(/, 'createSession must isolate interval bookkeeping failures from the START_MISSION result');
  assert.match(worker, /session\.endedAt \|\| \(session\.status === 'completed' \? sessionStart : now\)/, 'completed sessions with a null endedAt must not accrue time to now');
  assert.ok(worker.includes('trackedNavMarks.clear()'), 'CLEAR_DATA must drop tracked-nav marks with the other runtime tracking');
    assert.ok(worker.includes('trackedNavMarks.delete(tabId)'), 'tab removal must drop that tab\u2019s tracked-nav mark');

  const bridge = readFileSync(new URL('./content/spa-bridge.js', import.meta.url), 'utf8');
  assert.match(bridge, /try \{\s*\n\s*history\.pushState = function pushState/, 'the bridge must survive pages with frozen History methods');
  assert.match(bridge, /typeof history\.pushState !== 'function'/, 'the bridge must not throw when History methods are missing or replaced');

  // Execute the bridge against stubs: normal history patches cleanly and
  // announces; a sabotaged history object exits without throwing.
  const { Script } = await import('node:vm');
  const bridgeSource = new Script(bridge);
  const events = [];
  const healthy = {
    // A bare vm context has no DOM globals; the bridge only needs these two.
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
    document: { dispatchEvent(event) { events.push(event.type); return true; } },
    history: { pushState() {}, replaceState() {} }
  };
  bridgeSource.runInNewContext(healthy);
  healthy.history.pushState({}, '', '/a');
  healthy.history.replaceState({}, '', '/b');
  assert.deepEqual(events, ['focus-forest-history', 'focus-forest-history'], 'patched history must announce each write');

  const sabotaged = {
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
    document: { dispatchEvent() { throw new Error('must not be called'); } },
    history: { pushState: undefined, replaceState: undefined }
  };
  bridgeSource.runInNewContext(sabotaged); // must not throw
});

await test('A13: rate limiting exempts extension pages and gives content senders a distinguishable signal', async () => {
  const { SERVICE_WORKER } = await import('./shared/constants.js');
  clearStateCache();
  await send({ type: 'CLEAR_DATA' });
  await send({ type: 'START_MISSION', mission: 'Rate probe', tab: { id: 7, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });

  // A fresh tab sender (untouched budget) is allowed exactly the configured
  // number of messages per window; the next one is limited with the
  // distinguishable signal — never a bare null that reads as "no mission".
  const probeTab = { id: 888, url: 'https://probe.example/x', title: 'Probe' };
  let limitedAt = -1;
  for (let i = 0; i < SERVICE_WORKER.RATE_LIMIT_MAX_REQUESTS + 20; i++) {
    const view = await send({ type: 'GET_ACTIVE_VIEW' }, probeTab);
    if (view && view.rateLimited) { limitedAt = i + 1; break; }
    assert.ok(view && !view.rateLimited, `message ${i + 1} within budget must be served`);
  }
  assert.equal(limitedAt, SERVICE_WORKER.RATE_LIMIT_MAX_REQUESTS + 1, 'the corrected budget must hold exactly');

  // First-party extension pages are exempt entirely — even far beyond the
  // content-sender budget, the dashboard must never be throttled into a
  // blank render.
  for (let i = 0; i < SERVICE_WORKER.RATE_LIMIT_MAX_REQUESTS + 100; i++) {
    const snap = await send({ type: 'GET_SNAPSHOT' });
    assert.ok(snap && !snap.rateLimited && snap.state, `extension-page sender must never be rate limited (message ${i + 1})`);
  }
});

await test('A15: onUpdated observes only committed navigations; same-document completes belong to the SPA paths', async () => {
  const settle = () => new Promise((r) => setTimeout(r, 60));
  clearStateCache();
  await send({ type: 'CLEAR_DATA' });
  await send({ type: 'START_MISSION', mission: 'Commit gate probe', tab: { id: 7, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
  tabInfo.set(7, { id: 7, windowId: 1, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' });

  // A genuine cross-document navigation: committed -> loading -> complete.
  listeners.committed[0]?.({ frameId: 0, tabId: 7, transitionType: 'typed', transitionQualifiers: [], url: 'https://example.com/real' });
  await listeners.updated[0](7, { status: 'loading', url: 'https://example.com/real' }, { id: 7, url: 'https://example.com/real', windowId: 1 });
  tabInfo.set(7, { id: 7, windowId: 1, url: 'https://example.com/real', title: 'Real' });
  await listeners.updated[0](7, { status: 'complete' }, { id: 7, url: 'https://example.com/real', title: 'Real', windowId: 1 });
  await settle();
  assert.ok(session().nodes.some((n) => n.url === 'https://example.com/real'), 'a committed navigation must be observed');

  // A same-document route change fires the IDENTICAL onUpdated signature but
  // never fires onCommitted — observing it would race the SPA paths and
  // mislabel the route as an unlinked depth-0 path.
  await listeners.updated[0](7, { status: 'loading', url: 'https://example.com/route-1' }, { id: 7, url: 'https://example.com/route-1', windowId: 1 });
  tabInfo.set(7, { id: 7, windowId: 1, url: 'https://example.com/route-1', title: 'Route' });
  await listeners.updated[0](7, { status: 'complete' }, { id: 7, url: 'https://example.com/route-1', title: 'Route', windowId: 1 });
  await settle();
  assert.equal(session().nodes.some((n) => n.url === 'https://example.com/route-1'), false, 'an uncommitted (same-document) complete must not create a node');

  // The SPA path owns the route change and records it properly linked.
  await listeners.historyStateUpdated[0]({ frameId: 0, tabId: 7, url: 'https://example.com/route-1' });
  await settle();
  const spaNode = session().nodes.find((n) => n.url === 'https://example.com/route-1');
  assert.ok(spaNode, 'the SPA path must still record the route');
  assert.equal(spaNode.navigationKind, 'spa', 'SPA routes keep their spa classification');
  assert.equal(spaNode.depth, 1, 'SPA routes stay linked to the page they changed from');
});

await new Promise((resolve) => setTimeout(resolve, 50));
assert.equal(unhandled.length, 0, 'no unhandled promise rejections may escape the audit fixes');
console.log('test-audit-fixes.mjs: all audit regression checks passed');
