import assert from 'node:assert';
import { describe, it } from 'node:test';

const storage = {};
const changeListeners = [];
let heldSetCount = 0;
let failNextGet = false;
let failNextSet = false;
const setStartResolvers = [];
const setReleaseResolvers = [];

globalThis.chrome = {
  runtime: { id: 'test' },
  storage: {
    local: {
      async get(key) {
        if (failNextGet) { failNextGet = false; throw new Error('simulated storage read failure'); }
        return key in storage ? { [key]: structuredClone(storage[key]) } : {};
      },
      async set(value) {
        if (failNextSet) { failNextSet = false; throw new Error('simulated storage write failure'); }
        Object.assign(storage, structuredClone(value));
        if (heldSetCount <= 0) return;
        heldSetCount -= 1;
        setStartResolvers.shift()?.();
        await new Promise((resolve) => { setReleaseResolvers.push(resolve); });
      }
    },
    onChanged: {
      addListener(listener) { changeListeners.push(listener); }
    }
  }
};

const {
  STORAGE_KEY,
  isSearchUrl,
  isBrowserNewTabUrl,
  isExtensionNewTabUrl,
  isPlaceholderOriginUrl,
  safeHttpUrl,
  safeSessionUrl,
  canonicalUrl,
  normalizeSettings,
  compactText,
  getDepthState,
  LIMITS,
  DEFAULT_SETTINGS,
  normalizeState,
  emptyState,
  earnReward,
  canEarnReward,
  selectRandomReward,
  loadState,
  saveState,
  clearStateCache,
  makeId
} = await import('./shared/state.js');

function fireStorageChange(newValue, oldValue = undefined) {
  for (const listener of changeListeners) {
    listener({ [STORAGE_KEY]: { oldValue, newValue } }, 'local');
  }
}

function sessionFixture(id) {
  return {
    sessions: [{
      id,
      mission: 'm',
      status: 'active',
      startedAt: 1,
      origin: { url: 'https://example.com', title: 'Example' },
      nodes: [{ id: `${id}-n`, url: 'https://example.com/page', title: 'Page', parentId: null, depth: 0, state: 'normal' }],
      events: []
    }],
    activeSessionId: id,
    compostItems: [],
    settings: { ...DEFAULT_SETTINGS }
  };
}

describe('shared/state.js core functions', () => {
  it('compactText trims and truncates', () => {
    assert.strictEqual(compactText('  hello world  '), 'hello world');
    assert.strictEqual(compactText('a'.repeat(200), 50), 'a'.repeat(50));
    assert.strictEqual(compactText(''), '');
  });

  it('safeHttpUrl accepts http/https and rejects others', () => {
    assert.ok(safeHttpUrl('https://example.com/path'));
    assert.ok(safeHttpUrl('http://example.com'));
    assert.strictEqual(safeHttpUrl('ftp://example.com'), null);
    assert.strictEqual(safeHttpUrl('not-a-url'), null);
  });

  it('isSearchUrl detects known search engines and query params', () => {
    assert.ok(isSearchUrl('https://www.google.com/search?q=cats'));
    assert.ok(isSearchUrl('https://search.brave.com/search?q=trees'));
    assert.ok(isSearchUrl('https://search.brave.com/'));
    assert.ok(isSearchUrl('https://duckduckgo.com/?q=test'));
    assert.ok(isSearchUrl('https://bing.com/search?q=hello'));
    assert.ok(isSearchUrl('https://yahoo.com/search?p=term'));
    assert.strictEqual(isSearchUrl('https://example.com/page'), false);
  });

  it('normalizeSettings clamps and defaults', () => {
    const base = { gentleDepth: 4, choiceDepth: 5, ambientMotion: true, growthAnimationTrigger: 'mission-origin', excludedSites: [], searchEngine: 'default', enableRewards: false };
    assert.deepStrictEqual(normalizeSettings(base), { interventionsPaused: false, ...base });
    assert.deepStrictEqual(normalizeSettings({}), { interventionsPaused: false, gentleDepth: 4, choiceDepth: 5, ambientMotion: true, growthAnimationTrigger: 'mission-origin', excludedSites: [], searchEngine: 'default', enableRewards: false });
    assert.deepStrictEqual(normalizeSettings({ gentleDepth: 1, choiceDepth: 1 }), { interventionsPaused: false, gentleDepth: 2, choiceDepth: 3, ambientMotion: true, growthAnimationTrigger: 'mission-origin', excludedSites: [], searchEngine: 'default', enableRewards: false });
    assert.deepStrictEqual(normalizeSettings({ growthAnimationTrigger: 'invalid' }), { interventionsPaused: false, gentleDepth: 4, choiceDepth: 5, ambientMotion: true, growthAnimationTrigger: 'mission-origin', excludedSites: [], searchEngine: 'default', enableRewards: false });
    assert.equal(normalizeSettings({ searchEngine: 'brave' }).searchEngine, 'brave');
    assert.deepStrictEqual(normalizeSettings({ excludedSites: ['WWW.Example.com', 'example.com', ''] }).excludedSites, ['example.com']);
  });

  it('persists bounded reward history and keeps reward records minimal', () => {
    const state = emptyState();
    state.settings.enableRewards = true;
    state.sessions.push({ id: 'reward-session', startedAt: Date.now(), status: 'active', nodes: [], events: [] });
    state.activeSessionId = 'reward-session';
    const reward = earnReward(state, 'leaves', 'test-choice');
    assert.ok(reward?.id);
    assert.deepEqual(Object.keys(state.rewardHistory[0]).sort(), ['rewardId', 'timestamp']);
    const normalized = normalizeState(state);
    assert.equal(normalized.rewardHistory.length, 1);
    assert.equal(normalized.rewardHistory[0].rewardId, reward.id);
    assert.equal(canEarnReward(normalized), false, 'cooldown should prevent an immediate second reward');
    assert.equal(selectRandomReward('leaves', 0).id, 'leaf_1');
  });

  it('getDepthState maps explicit and default thresholds to states', () => {
    assert.strictEqual(getDepthState(0, false, { gentleDepth: 4, choiceDepth: 5 }), 'normal');
    assert.strictEqual(getDepthState(4, false, { gentleDepth: 4, choiceDepth: 5 }), 'desaturated');
    assert.strictEqual(getDepthState(5, false, { gentleDepth: 4, choiceDepth: 5 }), 'interrupted');
    assert.strictEqual(getDepthState(3, true, { gentleDepth: 4, choiceDepth: 5 }), 'paused');
    assert.strictEqual(getDepthState(4), 'desaturated');
    assert.strictEqual(getDepthState(5), 'interrupted');
  });

  it('canonicalUrl rejects malformed values instead of returning unsafe raw strings', () => {
    assert.strictEqual(canonicalUrl('not-a-url'), null);
    assert.strictEqual(canonicalUrl('javascript:alert(1)'), null);
    assert.strictEqual(canonicalUrl('https://user:password@example.com/private'), null);
    assert.strictEqual(canonicalUrl('https://example.com/path?utm_source=x#fragment'), 'https://example.com/path');
    assert.strictEqual(canonicalUrl(`https://example.com/${'x'.repeat(LIMITS.URL)}`), null);
    assert.strictEqual(safeHttpUrl(`https://example.com/${'x'.repeat(LIMITS.URL)}`), null);
  });

  it('recognizes Chromium new tabs without accepting arbitrary privileged URLs', () => {
    const accepted = [
      'chrome://newtab', 'chrome://newtab/', 'chrome://new-tab-page', 'chrome://new-tab-page/',
      'chrome://new-tab-page-third-party', 'brave://newtab', 'brave://newtab/', 'edge://newtab',
      'edge://newtab/', 'opera://startpage', 'opera://newtab', 'vivaldi://newtab', 'vivaldi://startpage',
      'chromium://newtab', 'chrome://vivaldi-webui/startpage'
    ];
    for (const url of accepted) {
      assert.strictEqual(isBrowserNewTabUrl(url), true, url);
      assert.strictEqual(safeSessionUrl(url), url);
      assert.strictEqual(safeHttpUrl(url), null, 'internal tabs must never become ordinary browsing pages');
    }
    for (const url of ['brave://settings', 'brave://history', 'brave://newtab.evil/', 'brave://newtab/settings',
      'brave://user@newtab/', 'brave://newtab:80/', 'chrome://newtab/other', 'brave-extension://test/newtab/index.html',
      'edge://settings', 'edge://newtab/settings', 'opera://settings', 'vivaldi://settings',
      'chrome://settings', 'chrome://extensions', 'chrome://vivaldi-webui/settings']) {
      assert.strictEqual(isBrowserNewTabUrl(url), false, url);
      assert.strictEqual(safeSessionUrl(url), null);
    }
    assert.strictEqual(isExtensionNewTabUrl('chrome-extension://test/newtab/index.html'), true);
    assert.strictEqual(isPlaceholderOriginUrl('edge://newtab'), true);
    assert.strictEqual(isPlaceholderOriginUrl('chrome-extension://test/newtab/index.html'), true);
    assert.strictEqual(isExtensionNewTabUrl('chrome-extension://other/newtab/index.html'), false);
  });

  it('safeSessionUrl accepts only the current extension origin or new-tab placeholder', () => {
    assert.strictEqual(safeSessionUrl('chrome://newtab'), 'chrome://newtab');
    assert.strictEqual(safeSessionUrl('chrome-extension://test/newtab/index.html'), 'chrome-extension://test/newtab/index.html');
    assert.strictEqual(safeSessionUrl('chrome-extension://test/'), 'chrome-extension://test/');
    assert.strictEqual(safeSessionUrl('chrome-extension://other/newtab/index.html'), null);
    assert.strictEqual(safeSessionUrl('chrome-extension://test'), null);
    assert.strictEqual(safeSessionUrl('javascript:alert(1)'), null);
    assert.strictEqual(safeSessionUrl(`chrome-extension://test/${'x'.repeat(LIMITS.URL)}`), null);
  });
});

describe('security invariants', () => {
  it('safeHttpUrl rejects dangerous schemes', () => {
    assert.strictEqual(safeHttpUrl('javascript:alert(1)'), null);
    assert.strictEqual(safeHttpUrl('data:text/html,<script>alert(1)</script>'), null);
    assert.strictEqual(safeHttpUrl('file:///etc/passwd'), null);
    assert.strictEqual(safeHttpUrl('vbscript:msgbox(1)'), null);
    assert.strictEqual(safeHttpUrl('about:blank'), null);
  });

  it('safeHttpUrl strips tracking parameters and hashes', () => {
    const u = safeHttpUrl('https://example.com/path?utm_source=x&id=1#frag');
    assert.ok(u);
    assert.ok(!u.includes('utm_source'));
    assert.ok(u.includes('id=1'));
    assert.ok(!u.includes('#frag'));
  });

  it('compactText never throws on weird input', () => {
    assert.strictEqual(compactText(null), '');
    assert.strictEqual(compactText(undefined), '');
    assert.strictEqual(compactText(123), '123');
    assert.strictEqual(compactText('a\nb\tc'), 'a b c');
  });
});

describe('normalizeState migration and bounds', () => {
  it('migrates legacy tabId to tabIds and drops the tabId field', () => {
    const legacy = {
      sessions: [{
        id: 's1', mission: 'm', status: 'active', startedAt: 1,
        origin: { tabId: 5, url: 'https://example.com', title: 'Ex' },
        nodes: [{ id: 'n1', tabId: 7, url: 'https://example.com/page', title: 'Pg', parentId: null, depth: 0, state: 'normal' }],
        events: []
      }],
      activeSessionId: 's1'
    };
    const result = normalizeState(legacy);
    assert.strictEqual(result.schemaVersion, 4);
    const node = result.sessions[0].nodes[0];
    assert.deepStrictEqual(node.tabIds, [7]);
    assert.ok(!('tabId' in node), 'legacy tabId should not survive normalization');
  });

  it('rejects javascript: URLs during normalization', () => {
    const poisoned = {
      sessions: [{
        id: 's1', mission: 'm', status: 'active', startedAt: 1,
        origin: { url: 'javascript:alert(1)' },
        nodes: [{ id: 'n1', url: 'javascript:alert(1)', title: 'x', parentId: null, depth: 0, state: 'normal' }],
        events: []
      }],
      compostItems: [{ id: 'c1', url: 'javascript:alert(1)', title: 'x', mission: 'm', depth: 1, savedAt: 1 }]
    };
    const result = normalizeState(poisoned);
    assert.strictEqual(result.sessions[0].origin.url, 'chrome://newtab');
    assert.strictEqual(result.sessions[0].nodes.length, 0);
    assert.strictEqual(result.compostItems.length, 0);
  });

  it('caps sessions, nodes, events, and compost to LIMITS', () => {
    const big = { ...emptyState() };
    big.sessions = Array.from({ length: LIMITS.SESSIONS + 5 }, (_, i) => ({
      id: `s${i}`, mission: 'm', status: 'completed', startedAt: i, endedAt: i + 1,
      origin: { url: 'https://example.com' },
      nodes: Array.from({ length: LIMITS.NODES_PER_SESSION + 5 }, (_, j) => ({ id: `n${i}_${j}`, url: `https://example.com/${j}`, title: 't', parentId: null, depth: 0, state: 'normal' })),
      events: Array.from({ length: LIMITS.EVENTS_PER_SESSION + 5 }, (_, k) => ({ id: `e${k}`, type: 'navigation', at: k }))
    }));
    big.compostItems = Array.from({ length: LIMITS.COMPOST + 5 }, (_, i) => ({ id: `c${i}`, url: `https://example.com/c${i}`, title: 't', mission: 'm', depth: 1, savedAt: i }));
    const result = normalizeState(big);
    assert.ok(result.sessions.length <= LIMITS.SESSIONS, `sessions ${result.sessions.length}`);
    for (const sess of result.sessions) {
      assert.ok(sess.nodes.length <= LIMITS.NODES_PER_SESSION, `nodes ${sess.nodes.length}`);
      assert.ok(sess.events.length <= LIMITS.EVENTS_PER_SESSION, `events ${sess.events.length}`);
    }
    assert.ok(result.compostItems.length <= LIMITS.COMPOST, `compost ${result.compostItems.length}`);
  });
});

describe('storage cache and invalidation', () => {
  it('caches reads, invalidates on external storage changes, and ignores changes during own writes', async () => {
    clearStateCache();
    storage[STORAGE_KEY] = sessionFixture('s1');
    const first = await loadState();
    storage[STORAGE_KEY] = sessionFixture('s2');
    assert.strictEqual((await loadState()).sessions[0].id, 's1');

    fireStorageChange(storage[STORAGE_KEY], sessionFixture('s1'));
    const refreshed = await loadState();
    assert.strictEqual(refreshed.sessions[0].id, 's2');

    const next = sessionFixture('s3');
    heldSetCount = 1;
    const started = new Promise((resolve) => { setStartResolvers.push(resolve); });
    const savePromise = saveState(next);
    await started;
    fireStorageChange(next, refreshed);
    assert.strictEqual((await loadState()).sessions[0].id, 's2', 'own-write change must not evict cache while save is in flight');
    setReleaseResolvers.shift()?.();
    await savePromise;
    assert.strictEqual((await loadState()).sessions[0].id, 's3');

    const overlapBase = await loadState();
    heldSetCount = 2;
    const firstStarted = new Promise((resolve) => { setStartResolvers.push(resolve); });
    const secondStarted = new Promise((resolve) => { setStartResolvers.push(resolve); });
    const firstSave = saveState(sessionFixture('s4'));
    const secondSave = saveState(sessionFixture('s5'));
    await Promise.all([firstStarted, secondStarted]);
    fireStorageChange(sessionFixture('external'), overlapBase);
    assert.strictEqual((await loadState()).sessions[0].id, 's3', 'external change must not evict cache while overlapping own writes remain in flight');
    setReleaseResolvers.shift()?.();
    setReleaseResolvers.shift()?.();
    await Promise.all([firstSave, secondSave]);
    assert.strictEqual((await loadState()).sessions[0].id, 's5');

    storage[STORAGE_KEY] = sessionFixture('s6');
    fireStorageChange(storage[STORAGE_KEY], sessionFixture('s5'));
    assert.strictEqual((await loadState()).sessions[0].id, 's6');

    clearStateCache();
    failNextGet = true;
    assert.deepStrictEqual((await loadState()).sessions, [], 'storage read failure must return an empty safe state');
    storage[STORAGE_KEY] = sessionFixture('s7');
    clearStateCache();
    await loadState();
    failNextSet = true;
    await assert.rejects(saveState(sessionFixture('failed')), /simulated storage write failure/);
    storage[STORAGE_KEY] = sessionFixture('s8');
    fireStorageChange(storage[STORAGE_KEY], sessionFixture('s7'));
    assert.strictEqual((await loadState()).sessions[0].id, 's8', 'failed writes must release the cache guard');
  });
});
