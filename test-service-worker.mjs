import assert from 'node:assert/strict';

const store = {};
const messages = [];
const tabActions = [];
const windowActions = [];
const tabInfo = new Map();
const listeners = { installed: [], message: [], updated: [], removed: [], created: [], startup: [], committed: [], historyStateUpdated: [] };

globalThis.chrome = {
  storage: {
    local: {
      async get(key) { return key in store ? { [key]: structuredClone(store[key]) } : {}; },
      async set(value) { Object.assign(store, structuredClone(value)); }
    }
  },
  runtime: {
    id: 'test',
    getURL(path) { return `chrome-extension://test/${path}`; },
    onInstalled: { addListener(fn) { listeners.installed.push(fn); } },
    onMessage: { addListener(fn) { listeners.message.push(fn); } },
    onStartup: { addListener(fn) { listeners.startup.push(fn); } }
  },
  webNavigation: { onCommitted: { addListener(fn) { listeners.committed.push(fn); } }, onHistoryStateUpdated: { addListener(fn) { listeners.historyStateUpdated.push(fn); } } },
  windows: { async update(id, patch) { windowActions.push(['update', id, patch]); } },
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

await import('./background/service-worker.js');
const handler = listeners.message[0];
async function rawSend(message, sender) {
  return await new Promise((resolve, reject) => handler(message, sender, (response) => response?.error ? reject(new Error(response.error)) : resolve(response)));
}
async function send(message, tab = undefined) {
  if (tab?.id != null) { const current = { ...(tabInfo.get(tab.id) || {}), windowId: 1, ...tab }; if (message?.type === 'OBSERVE_PAGE' && typeof message.url === 'string') { current.url = message.url; current.title = message.title || current.title; } tabInfo.set(tab.id, current); }
  const sender = tab ? { id: 'test', tab, url: `https://page.test/${tab.id}` } : { id: 'test', url: 'chrome-extension://test/dashboard/index.html' };
  return rawSend(message, sender);
}
assert.equal(await rawSend({ type: 'CLEAR_DATA' }, undefined), null, 'missing sender must be rejected without throwing');
assert.equal(await rawSend({ type: 'toString' }, { id: 'test', url: 'chrome-extension://test/dashboard/index.html' }), null, 'inherited property names must not be accepted as message types');
const inheritedMessage = Object.create({ type: 'CLEAR_DATA' });
assert.equal(await rawSend(inheritedMessage, { id: 'test', url: 'chrome-extension://test/dashboard/index.html' }), null, 'inherited message fields must not bypass own-property validation');
function session() { return store.focusForestState.sessions.find((s) => s.id === store.focusForestState.activeSessionId); }

// Chromium forks keep the chrome.* extension API and chrome-extension:// sender origin,
// but expose their own new-tab placeholders (chrome://, brave://, edge://, opera://, vivaldi://).
const chromiumNewTabs = [
  'chrome://newtab', 'chrome://new-tab-page', 'brave://newtab', 'brave://newtab/',
  'edge://newtab', 'opera://startpage', 'vivaldi://newtab', 'chrome://vivaldi-webui/startpage'
];
for (const newTabUrl of chromiumNewTabs) {
  await send({ type: 'START_MISSION', mission: 'Research in Chromium', tab: { id: 801, url: newTabUrl, title: 'New Tab' } });
  assert.equal(session().origin.url, newTabUrl, `${newTabUrl} should survive validation as a new-tab placeholder`);
  await send({ type: 'OBSERVE_PAGE', url: 'chrome://settings', title: 'Settings' }, { id: 801 });
  assert.equal(session().origin.url, newTabUrl, 'restricted browser pages must not become the mission origin');
  await send({ type: 'OBSERVE_PAGE', url: 'https://search.brave.com/search?q=trees', title: 'Search' }, { id: 801 });
  assert.equal(session().nodes.length, 1, 'the first ordinary page replaces the placeholder, not an extra branch');
  assert.equal(session().nodes[0].depth, 0);
  assert.equal(session().origin.url, 'https://search.brave.com/search?q=trees');
  await send({ type: 'LINK_CLICK', url: 'https://example.com/trees', title: 'Trees' }, { id: 801 });
  await send({ type: 'OBSERVE_PAGE', url: 'https://example.com/trees', title: 'Trees' }, { id: 801 });
  assert.equal(session().nodes.at(-1).depth, 1, 'a link from the first page should grow exactly one branch');
  await send({ type: 'CLEAR_DATA' });
}
tabInfo.delete(801);

await send({ type: 'START_MISSION', mission: 'Find a good laptop to buy.', tab: { id: 7, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
assert.ok(Array.isArray(session().activeIntervals), 'sessions should track active-tab intervals');
await send({ type: 'OBSERVE_PAGE', url: 'https://example.com', title: 'Origin' }, { id: 7, openerTabId: undefined });
assert.equal(session().nodes[0].depth, 0, 'first ordinary page must become depth 0');
assert.equal(session().origin.tabId, 7, 'origin tab must be remembered');
const activeView = await send({ type: 'GET_ACTIVE_VIEW' }, { id: 7 });
assert.equal(activeView.session.mission, 'Find a good laptop to buy.', 'active view should carry the current mission');
assert.equal(activeView.session.node.depth, 0, 'active view should carry only the current node depth');
assert.equal('nodes' in activeView.session, false, 'active view should not serialize full branch history to page scripts');
assert.equal((await send({ type: 'GET_ACTIVE_VIEW' }, { id: 88 })).session, null, 'untracked tabs should not receive a mission chip view');

await send({ type: 'CLEAR_DATA' });
tabInfo.clear();
tabInfo.set(11, { id: 11, windowId: 1, url: 'chrome-extension://test/newtab/index.html', title: 'Focus Forest' });
await send({ type: 'START_MISSION', mission: 'Find quiet study music', openSearch: true, tab: { url: 'chrome-extension://test/newtab/index.html', title: 'Focus Forest' } });
assert.equal(tabActions.at(-1)?.[0], 'update', 'planting from New Tab should navigate the active browser tab');
assert.equal(tabActions.at(-1)?.[1], 11);
assert.match(tabActions.at(-1)?.[2]?.url || '', /google\.com\/search\?q=Find%20quiet%20study%20music/, 'planting should open search results for the mission');

await send({ type: 'OBSERVE_PAGE', url: 'https://unrelated.example', title: 'Unrelated' }, { id: 88 });
assert.equal(session().nodes.length, 1, 'unrelated tabs must not become branches');

for (const [i, path] of ['/battery', '/mines', '/bolivia', '/inca', '/weapons'].entries()) {
  const url = `https://example.com${path}`;
  await send({ type: 'LINK_CLICK', url, title: path, targetBlank: false }, { id: 7 });
  await send({ type: 'OBSERVE_PAGE', url, title: path }, { id: 7 });
  assert.equal(session().nodes.at(-1).depth, i + 1, `link ${path} should create depth ${i + 1}`);
}
assert.equal(Math.max(...session().nodes.map((n) => n.depth)), 5, 'five links should reach interruption depth');
assert.equal(session().nodes.at(-1).state, 'interrupted', 'depth 5 should be interrupted');
assert.equal(session().nodes.slice(0, -1).some((node) => node.tabIds?.includes(7)), false, 'a navigating tab should not remain attached to historical nodes');

await send({ type: 'COMPOST', url: 'https://example.com/weapons', title: 'Weapons' }, { id: 7 });
assert.equal(store.focusForestState.schemaVersion, 3, 'state should use the current compact schema');
assert.equal('transitions' in session(), false, 'nodes should be the only branch relationship source');
assert.equal(store.focusForestState.compostItems.length, 1, 'compost should save one item');
assert.equal(tabActions.some((action) => action[0] === 'remove' && action[1] === 7), false, 'compost must not close the current tab');

await send({ type: 'CLEAR_DATA' });
tabActions.length = 0;
await send({ type: 'START_MISSION', mission: 'First mission', tab: { id: 7, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
await send({ type: 'START_MISSION', mission: 'Research history', missionNote: 'Understand the roots before choosing a direction.', tab: { id: 9, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
assert.equal(session().note, 'Understand the roots before choosing a direction.', 'mission note should be stored with the active garden');
assert.equal(store.focusForestState.sessions[0].status, 'completed', 'starting a new mission should complete the prior garden');
assert.equal(store.focusForestState.sessions[0].endReason, 'mission_changed', 'prior garden should record the reason for change');
await send({ type: 'CLEAR_DATA' });
tabActions.length = 0;
await send({ type: 'START_MISSION', mission: 'Research history', tab: { id: 7, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
await send({ type: 'OBSERVE_PAGE', url: 'https://history.example', title: 'History' }, { id: 7 });
const beforeDuplicate = session().nodes.length;
await send({ type: 'OBSERVE_PAGE', url: 'https://history.example', title: 'History duplicate' }, { id: 8, openerTabId: 7 });
assert.equal(session().nodes.length, beforeDuplicate, 'duplicate tab should reuse the known path');
assert.equal(session().nodes.find((node) => node.url === 'https://history.example/').tabIds.includes(8), true, 'known path should attach duplicate tab alias');
const beforeNewTab = session().nodes.length;
await send({ type: 'LINK_CLICK', url: 'https://history.example/inca', title: 'Inca', targetBlank: true }, { id: 7 });
assert.equal(session().nodes.length, beforeNewTab, 'new-tab click should wait for the destination tab before adding a node');
await send({ type: 'OBSERVE_PAGE', url: 'https://history.example/inca', title: 'Inca' }, { id: 8, openerTabId: 7 });
assert.equal(session().nodes.at(-1).depth, 1, 'new tab link should inherit source depth');
const beforeRedirect = session().nodes.length;
await send({ type: 'LINK_CLICK', url: 'https://search.example/redirect?target=https%3A%2F%2Fhistory.example%2Ffinal', title: 'Redirect', targetBlank: false }, { id: 7 });
await send({ type: 'OBSERVE_PAGE', url: 'https://search.example/redirect?target=https%3A%2F%2Fhistory.example%2Ffinal', title: 'Redirect' }, { id: 7 });
await send({ type: 'OBSERVE_PAGE', url: 'https://history.example/final', title: 'Final' }, { id: 7 });
assert.equal(session().nodes.length, beforeRedirect + 1, 'redirect journey should resolve to one branch node');
const beforeMultiHop = session().nodes.length;
await send({ type: 'LINK_CLICK', url: 'https://search.example/url?target=https%3A%2F%2Fsearch.example%2Fredirect%3Fdest%3Dhttps%253A%252F%252Fhistory.example%252Fdeep', title: 'Multi-hop result', targetBlank: false }, { id: 7 });
await send({ type: 'OBSERVE_PAGE', url: 'https://search.example/url?target=https%3A%2F%2Fsearch.example%2Fredirect%3Fdest%3Dhttps%253A%252F%252Fhistory.example%252Fdeep', title: 'Transport one' }, { id: 7 });
await send({ type: 'OBSERVE_PAGE', url: 'https://search.example/redirect?dest=https%3A%2F%2Fhistory.example%2Fdeep', title: 'Transport two' }, { id: 7 });
await send({ type: 'OBSERVE_PAGE', url: 'https://history.example/deep', title: 'Final destination' }, { id: 7 });
assert.equal(session().nodes.length, beforeMultiHop + 1, 'multi-hop redirect should resolve to one branch node');
assert.equal(session().nodes.at(-1).relationshipConfidence, 'direct', 'resolved redirect should remain a direct structural branch');
assert.equal(session().pendingRedirects.length, 0, 'resolved redirect should clear pending transport state');
const pruneTarget = session().nodes.find((node) => node.depth === 1);
const beforePruneNodes = session().nodes.length;
await send({ type: 'PRUNE_NODE', sessionId: session().id, nodeId: pruneTarget.id, toCompost: true });
assert.equal(session().nodes.length, beforePruneNodes, 'pruning should preserve the historical node');
assert.equal(session().nodes.find((node) => node.id === pruneTarget.id).state, 'pruned', 'pruning should mark the node without deleting it');
assert.equal(store.focusForestState.compostItems.some((item) => item.url === pruneTarget.url), true, 'returning a branch to compost should save its canonical path');
const prunedCount = session().nodes.length;
await send({ type: 'OBSERVE_PAGE', url: pruneTarget.url, title: 'Pruned path' }, { id: 61 });
assert.equal(session().nodes.length, prunedCount, 'a pruned path must not become an active known-path alias again');
const eventCountBeforeInvalidPrune = session().events.length;
await send({ type: 'PRUNE_NODE', sessionId: 'not-this-session', nodeId: pruneTarget.id, toCompost: true });
assert.equal(session().events.length, eventCountBeforeInvalidPrune, 'cross-session prune requests must not mutate the garden');
await send({ type: 'UPDATE_SETTINGS', settings: { gentleDepth: 2, choiceDepth: 3 } });
assert.equal((await send({ type: 'GET_SNAPSHOT' })).thresholds.DESATURATE, 2, 'gentle depth should be locally configurable');
await send({ type: 'UPDATE_SETTINGS', settings: { gentleDepth: 99, choiceDepth: 0 } });
const clamped = await send({ type: 'GET_SNAPSHOT' });
assert.equal(clamped.thresholds.DESATURATE, 8, 'gentle depth should clamp to the safe maximum');
assert.equal(clamped.thresholds.INTERRUPT, 9, 'choice depth should remain one step after the gentle threshold');
await send({ type: 'OBSERVE_PAGE', url: 'https://unlinked.example', title: 'Unlinked' }, { id: 7 });
assert.equal(session().nodes.at(-1).depth, 0, 'manual or external navigation should remain neutral');
const nodeCountBeforeReturn = session().nodes.length;
await send({ type: 'OBSERVE_PAGE', url: 'https://history.example', title: 'History again' }, { id: 7 });
assert.equal(session().nodes.length, nodeCountBeforeReturn, 'returning to a known URL should reuse its node');
listeners.committed[0]?.({ frameId: 0, tabId: 7, transitionType: 'back_forward', transitionQualifiers: [] });
await send({ type: 'OBSERVE_PAGE', url: 'https://history.example', title: 'History back' }, { id: 7 });
assert.equal(session().nodes.find((node) => node.url === 'https://history.example/').confidence, 'low', 'back/forward returns should be low confidence');
await send({ type: 'GO_HOME' });
assert.equal(tabActions.some((a) => a[0] === 'remove'), false, 'Go Home must not close tracked tabs automatically');
const goHomeUpdate = tabActions.findLast((a) => a[0] === 'update' && a[1] === 7);
assert(goHomeUpdate, 'Go Home should activate origin tab');
assert.equal(goHomeUpdate[2].url, 'https://history.example/', 'Go Home should return the origin tab to its stored origin URL');
await send({ type: 'END_MISSION', reason: 'user_ended' });
await send({ type: 'CLEAR_DATA' });
await send({ type: 'START_MISSION', mission: 'Search root test', tab: { id: 7, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
await send({ type: 'OBSERVE_PAGE', url: 'https://search.example/search?q=focus', title: 'Search results' }, { id: 7 });
assert.equal(session().nodes[0].depth, 0, 'directly opened search page should remain a neutral root');
await send({ type: 'END_MISSION', reason: 'user_ended' });
assert.equal((await send({ type: 'GET_SNAPSHOT' })).session, null, 'completed mission should not reappear as active page state');
assert.equal((await send({ type: 'GET_SNAPSHOT', includeHistory: true })).session.mission, 'Search root test', 'dashboard history should expose the latest completed garden');
assert.equal(store.focusForestState.sessions.length <= 12, true, 'session history should remain bounded');
assert.equal(store.focusForestState.sessions.at(-1).events.length <= 72, true, 'event history should remain bounded');
const forgetId = store.focusForestState.sessions.at(-1).id;
await send({ type: 'DELETE_SESSION', sessionId: forgetId });
assert.equal(store.focusForestState.sessions.some((item) => item.id === forgetId), false, 'selected garden should be deletable without clearing all history');

await send({ type: 'START_MISSION', mission: 'Boundary safety', tab: { id: 31, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
await send({ type: 'OBSERVE_PAGE', url: 'https://safe.example', title: 'Safe' }, { id: 31 });
const safeNodeCount = session().nodes.length; const safeCompostCount = store.focusForestState.compostItems.length; const safeEvents = session().events.length;
await send({ type: 'OBSERVE_PAGE', url: 'javascript:alert(1)', title: 'Unsafe' }, { id: 31 });
await send({ type: 'LINK_CLICK', url: 'data:text/html,<script>alert(1)</script>', title: 'Unsafe', targetBlank: false }, { id: 31 });
await send({ type: 'COMPOST', url: 'javascript:alert(1)', title: 'Unsafe' }, { id: 31 });
assert.equal(session().nodes.length, safeNodeCount, 'unsafe URL schemes must not create nodes');
assert.equal(store.focusForestState.compostItems.length, safeCompostCount, 'unsafe URL schemes must not create compost items');
assert.equal(session().events.length, safeEvents, 'unsafe URL schemes must not create navigation events');
const beforeInvalidMutation = JSON.stringify(store.focusForestState);
await send({ type: 'PRUNE_NODE', sessionId: 'bad.id', nodeId: 'bad.id', toCompost: true });
assert.equal(JSON.stringify(store.focusForestState), beforeInvalidMutation, 'invalid identifiers must not mutate state');
await send({ type: 'LINK_CLICK', title: 'Missing URL', targetBlank: false }, { id: 31 });
assert.equal(JSON.stringify(store.focusForestState), beforeInvalidMutation, 'messages missing required fields must not mutate state');
await send({ type: 'CLEAR_DATA' }, { id: 31 });
assert.equal(JSON.stringify(store.focusForestState), beforeInvalidMutation, 'content-script senders must not clear all local data');
assert.equal(await send({ type: 'GET_SNAPSHOT' }, { id: 31 }), null, 'content-script senders must not receive the full garden snapshot');
await send({ type: 'UPDATE_SETTINGS', settings: { gentleDepth: 1, choiceDepth: 2 } }, { id: 31 });
const protectedSettings = await send({ type: 'GET_SNAPSHOT' });
assert.equal(protectedSettings.thresholds.DESATURATE, 4, 'content-script senders must not alter global settings');
await Promise.all([send({ type: 'UPDATE_SETTINGS', settings: { gentleDepth: 3, choiceDepth: 4 } }), send({ type: 'UPDATE_SETTINGS', settings: { gentleDepth: 5, choiceDepth: 6 } })]);
const concurrentSnapshot = await send({ type: 'GET_SNAPSHOT' });
assert.equal(concurrentSnapshot.thresholds.INTERRUPT >= concurrentSnapshot.thresholds.DESATURATE + 1, true, 'concurrent settings updates must preserve threshold ordering');
await listeners.removed[0](31);
tabActions.length = 0;
await send({ type: 'GO_HOME' });
assert.equal(tabActions.some((action) => action[0] === 'update'), false, 'stale origin removal must not target a reused tab');
assert.equal(tabActions.some((action) => action[0] === 'create' && action[1].url === 'https://safe.example/'), true, 'stale origin removal should recover with a safe new origin tab');

await assert.doesNotReject(() => send(null), 'null runtime messages must be ignored safely');
await send({ type: 'CLEAR_DATA' });
await send({ type: 'START_MISSION', mission: 'Pending collision', tab: { id: 101, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
await send({ type: 'OBSERVE_PAGE', url: 'https://origin.example', title: 'Origin' }, { id: 101 });
await send({ type: 'LINK_CLICK', url: 'https://origin.example/a', title: 'A', targetBlank: false }, { id: 101 });
await send({ type: 'OBSERVE_PAGE', url: 'https://origin.example/a', title: 'A' }, { id: 101 });
const aNode = session().nodes.at(-1);
await send({ type: 'OBSERVE_PAGE', url: 'https://origin.example', title: 'Origin' }, { id: 102, openerTabId: 101 });
await send({ type: 'LINK_CLICK', url: 'https://origin.example/b', title: 'B', targetBlank: false }, { id: 102 });
await send({ type: 'OBSERVE_PAGE', url: 'https://origin.example/b', title: 'B' }, { id: 102 });
const bNode = session().nodes.at(-1);
await send({ type: 'LINK_CLICK', url: 'https://shared.example/path', title: 'Shared', targetBlank: true }, { id: 101 });
await send({ type: 'LINK_CLICK', url: 'https://shared.example/path', title: 'Shared', targetBlank: true }, { id: 102 });
const shared = await send({ type: 'OBSERVE_PAGE', url: 'https://shared.example/path', title: 'Shared' }, { id: 101 });
assert.equal(shared.parentId, aNode.id, 'same-destination pending links must retain the source-tab relationship');
assert.notEqual(shared.parentId, bNode.id, 'pending links from another source tab must not overwrite this relationship');
await send({ type: 'CLEAR_DATA' });
await send({ type: 'START_MISSION', mission: 'Alias care', tab: { id: 201, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
await send({ type: 'OBSERVE_PAGE', url: 'https://alias.example', title: 'Alias' }, { id: 201 });
await send({ type: 'OBSERVE_PAGE', url: 'https://alias.example', title: 'Alias duplicate' }, { id: 202, openerTabId: 201 });
await send({ type: 'COMPOST', url: 'https://alias.example', title: 'Alias' }, { id: 201 });
const closedAliasNode = session().nodes.find((node) => node.url === 'https://alias.example/');
assert.deepEqual(closedAliasNode.tabIds, [], 'composting a path must detach every live tab alias');

await send({ type: 'CLEAR_DATA' });
await send({ type: 'START_MISSION', mission: 'Reused origin', tab: { id: 300, url: 'https://origin.example/home', title: 'Origin' } });
tabInfo.set(300, { id: 300, windowId: 1, url: 'https://unrelated.example/reused', title: 'Unrelated' });
tabActions.length = 0;
await send({ type: 'GO_HOME' });
assert.equal(tabActions.some((action) => action[0] === 'update' && action[1] === 300), false, 'Go Home must not target an unrelated tab that reused the origin ID');
assert.equal(tabActions.some((action) => action[0] === 'create' && action[1].url === 'https://origin.example/home'), true, 'Go Home should create a safe origin tab when the stored tab identity is stale');
await send({ type: 'CLEAR_DATA' });
await send({ type: 'START_MISSION', mission: 'Redirect reuse', tab: { id: 400, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
await send({ type: 'OBSERVE_PAGE', url: 'https://redirect-origin.example', title: 'Redirect origin' }, { id: 400 });
await send({ type: 'LINK_CLICK', url: 'https://redirect.example/redirect?target=https%3A%2F%2Ffinal.example', title: 'Redirect', targetBlank: false }, { id: 400 });
assert.equal(session().pendingRedirects.length, 1, 'redirect should create pending state');
await listeners.removed[0](400);
assert.equal(session().pendingRedirects.length, 0, 'tab removal must clear pending redirect state');
const beforeReusedTab = session().nodes.length;
await send({ type: 'OBSERVE_PAGE', url: 'https://reused.example', title: 'Reused tab' }, { id: 400 });
assert.equal(session().nodes.length, beforeReusedTab, 'a reused tab must not inherit a removed tab redirect relationship');
await send({ type: 'CLEAR_DATA' });
await send({ type: 'START_MISSION', mission: 'Other window', tab: { id: 500, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
await send({ type: 'OBSERVE_PAGE', url: 'https://window-two.example/home', title: 'Window two' }, { id: 500 });
tabInfo.set(500, { id: 500, windowId: 2, url: 'https://window-two.example/home', title: 'Window two' });
tabActions.length = 0; windowActions.length = 0;
await send({ type: 'GO_HOME' });
assert.equal(windowActions.some((action) => action[0] === 'update' && action[1] === 2 && action[2].focused === true), true, 'Go Home should focus the origin window');

// Test node close and reopen lifecycle
await send({ type: 'CLEAR_DATA' });
await send({ type: 'START_MISSION', mission: 'Node close and reopen lifecycle', tab: { id: 600, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
await send({ type: 'OBSERVE_PAGE', url: 'https://lifecycle.example/first', title: 'First page' }, { id: 600 });
const firstNodeId = session().nodes.at(-1).id;
await send({ type: 'LINK_CLICK', url: 'https://lifecycle.example/second', title: 'Second page', targetBlank: false }, { id: 600 });
await send({ type: 'OBSERVE_PAGE', url: 'https://lifecycle.example/second', title: 'Second page' }, { id: 600 });

// Verify first page node is closed when navigated away
const firstNodeAfterNav = session().nodes.find(n => n.id === firstNodeId);
assert.ok(firstNodeAfterNav.closedAt, 'first page node must be marked as closed after navigating away');

// Return to first page URL and verify node is reopened
await send({ type: 'OBSERVE_PAGE', url: 'https://lifecycle.example/first', title: 'First page again' }, { id: 600 });
const firstNodeAfterReturn = session().nodes.find(n => n.id === firstNodeId);
assert.equal(firstNodeAfterReturn.closedAt, undefined, 'first page node must be reopened (closedAt cleared) when returning to its URL');

// Test import/export roundtrip
await send({ type: 'CLEAR_DATA' });
await send({ type: 'START_MISSION', mission: 'Export import test', tab: { id: 700, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
await send({ type: 'OBSERVE_PAGE', url: 'https://export.example/page', title: 'Export page' }, { id: 700 });
const exported = await send({ type: 'EXPORT_DATA' });
assert.ok(exported.data, 'export should return data');
assert.equal(exported.data.sessions.length, 1, 'export should contain one session');
assert.equal(exported.data.sessions[0].mission, 'Export import test', 'export should preserve mission');

await send({ type: 'CLEAR_DATA' });
assert.equal((await send({ type: 'GET_SNAPSHOT' })).session, null, 'clearing data should remove active session');

const imported = await send({ type: 'IMPORT_DATA', payload: exported });
assert.ok(imported.imported, 'import should succeed');
const afterImport = await send({ type: 'GET_SNAPSHOT', includeHistory: true });
assert.equal(afterImport.session.mission, 'Export import test', 'import should restore session');
assert.equal(afterImport.session.nodes[0].url, 'https://export.example/page', 'import should restore nodes');

await send({ type: 'COMPLETE_ONBOARDING' });
await send({ type: 'UPDATE_SETTINGS', settings: { ambientMotion: false } });
const importedWithExistingPreferences = await send({
  type: 'IMPORT_DATA',
  payload: { data: { sessions: [], compostItems: [], settings: { ambientMotion: true }, onboardingCompleted: false } }
});
assert.ok(importedWithExistingPreferences.imported, 'import should merge a valid state with existing preferences');
const afterPreferenceImport = await send({ type: 'GET_SNAPSHOT' });
assert.equal(afterPreferenceImport.state.onboardingCompleted, true, 'import must not erase onboarding completion');
assert.equal(afterPreferenceImport.settings.ambientMotion, true, 'import should apply the imported settings explicitly');

// Test onboarding completion
await send({ type: 'CLEAR_DATA' });
const beforeOnboarding = await send({ type: 'GET_SNAPSHOT' });
assert.equal(beforeOnboarding.state.onboardingCompleted, false, 'new state should not have onboarding completed');
await send({ type: 'COMPLETE_ONBOARDING' });
const afterOnboarding = await send({ type: 'GET_SNAPSHOT' });
assert.equal(afterOnboarding.state.onboardingCompleted, true, 'onboarding should be marked as completed');

// Test settings sync
await send({ type: 'UPDATE_SETTINGS', settings: { gentleDepth: 6, choiceDepth: 8 } });
const afterSettings = await send({ type: 'GET_SNAPSHOT' });
assert.equal(afterSettings.settings.gentleDepth, 6, 'settings update should persist');
assert.equal(afterSettings.settings.choiceDepth, 8, 'settings update should persist');

await send({ type: 'CLEAR_DATA' });
await send({ type: 'START_MISSION', mission: 'Read the next chapter', tab: { id: 7, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
await send({ type: 'OBSERVE_PAGE', url: 'https://example.com', title: 'Reader' }, { id: 7 });
await send({ type: 'SPA_NAVIGATION', url: 'https://example.com/reader/chapter-2', title: 'Chapter 2' }, { id: 7 });
assert.equal(session().nodes.at(-1).navigationKind, 'spa', 'SPA route changes must be tracked on any ordinary HTTPS domain');
assert.equal(session().nodes.at(-1).depth, 1, 'the first SPA route must grow one branch');
const nodeCountAfterSpa = session().nodes.length;
await send({ type: 'SPA_NAVIGATION', url: 'https://example.com/reader/chapter-2', title: 'Chapter 2' }, { id: 7 });
assert.equal(session().nodes.length, nodeCountAfterSpa, 'duplicate SPA route notifications must be ignored');
await listeners.historyStateUpdated[0]({ frameId: 0, tabId: 7, url: 'https://example.com/reader/chapter-3' });
assert.equal(session().nodes.at(-1).navigationKind, 'spa', 'webNavigation history events must track SPA routes outside the old domain allowlist');
assert.equal(session().nodes.at(-1).url, 'https://example.com/reader/chapter-3');

tabActions.length = 0;
await listeners.updated[0](901, { status: 'loading', url: 'brave://newtab/' }, { id: 901, url: 'brave://newtab/', pendingUrl: 'brave://newtab/' });
assert.equal(tabActions.some((action) => action[0] === 'update' && action[1] === 901 && action[2].url === 'chrome-extension://test/newtab/index.html'), true, 'Brave dashboard new tabs must be replaced by Focus Forest');
tabActions.length = 0;
await listeners.created[0]({ id: 902, pendingUrl: 'chrome://newtab', url: 'chrome://newtab' });
assert.equal(tabActions.some((action) => action[0] === 'update' && action[1] === 902 && action[2].url === 'chrome-extension://test/newtab/index.html'), true, 'Chrome new tabs must be replaced by Focus Forest when the override is skipped');
tabActions.length = 0;
await listeners.updated[0](903, { status: 'complete', url: 'https://example.com/' }, { id: 903, url: 'https://example.com/' });
assert.equal(tabActions.some((action) => action[0] === 'update' && action[1] === 903), false, 'ordinary pages must not be rewritten to the planting page');
tabActions.length = 0;
await listeners.updated[0](904, { status: 'complete', url: 'chrome://settings' }, { id: 904, url: 'chrome://settings' });
assert.equal(tabActions.some((action) => action[0] === 'update' && action[1] === 904), false, 'settings pages must not be rewritten to the planting page');

console.log('service-worker behavioral tests passed');
