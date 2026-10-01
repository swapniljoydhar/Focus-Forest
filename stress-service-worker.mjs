import assert from 'node:assert/strict';

const store = {};
const listeners = { installed: [], message: [], updated: [], removed: [] };
globalThis.chrome = {
  storage: { local: { async get(key) { const keys = Array.isArray(key) ? key : [key]; return Object.fromEntries(keys.filter((item) => item in store).map((item) => [item, structuredClone(store[item])])); }, async set(value) { Object.assign(store, structuredClone(value)); }, async remove(key) { for (const item of Array.isArray(key) ? key : [key]) delete store[item]; } } },
  runtime: { id: 'test', onInstalled: { addListener(fn) { listeners.installed.push(fn); } }, onMessage: { addListener(fn) { listeners.message.push(fn); } } },
  tabs: { onUpdated: { addListener(fn) { listeners.updated.push(fn); } }, onRemoved: { addListener(fn) { listeners.removed.push(fn); } }, async update() {}, async create() { return { id: 999 }; } }
};
await import('./background/service-worker.js');
const handler = listeners.message[0];
async function send(message, tab = undefined, sender = { id: chrome.runtime.id, tab }) {
  return await new Promise((resolve, reject) => handler(message, sender, (response) => response?.error ? reject(new Error(response.error)) : resolve(response)));
}

await send({ type: 'START_MISSION', mission: 'Stress fixture', tab: { id: 1, url: 'chrome-extension://test/newtab/index.html', title: 'New Tab' } });
const beforeUntrustedClear = structuredClone(store.intentGroveState);
await send({ type: 'CLEAR_DATA' }, undefined, { id: 'untrusted-extension', tab: { id: 1, url: 'https://stress.example/root' }, url: 'https://stress.example/root' });
assert.deepEqual(store.intentGroveState, beforeUntrustedClear, 'untrusted sender must not clear local data');
await send({ type: 'OBSERVE_PAGE', url: 'https://stress.example/root', title: 'Root' }, { id: 1 });
await Promise.all(Array.from({ length: 500 }, (_, index) => send({ type: 'OBSERVE_PAGE', url: `https://stress.example/path-${index}`, title: `<stress-${index}>` }, { id: 1 })));
await Promise.all(Array.from({ length: 300 }, (_, index) => send({ type: 'UPDATE_SETTINGS', settings: { gentleDepth: index % 8 + 2, choiceDepth: index % 10 + 1 } })));
await Promise.all(Array.from({ length: 200 }, () => send(null)));
await Promise.all(Array.from({ length: 200 }, () => send([])));
const state = store.intentGroveState;
const session = state.sessions.find((item) => item.id === state.activeSessionId);
assert.ok(session, 'stress session should remain available');
assert.ok(session.nodes.length <= 96, 'node bound must hold under concurrent navigation');
assert.ok(session.events.length <= 72, 'event bound must hold under concurrent navigation');
assert.ok(state.sessions.length <= 12, 'session bound must hold');
assert.ok(state.compostItems.length <= 80, 'compost bound must hold');
assert.ok(state.settings.choiceDepth >= state.settings.gentleDepth + 1, 'threshold ordering must hold after concurrent updates');
assert.ok(session.nodes.every((node) => /^https?:\/\//.test(node.url) || /^chrome-extension:\/\//.test(node.url)), 'stress state must contain only safe URLs');
console.log(`stress passed: ${session.nodes.length} nodes, ${session.events.length} events`);
