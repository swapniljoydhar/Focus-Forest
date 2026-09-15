import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { emptyState, STORAGE_KEY } from './shared/state.js';

// Exercise the real HTML, CSS, modules, and extension CSP in Chromium.
// Only Chrome's messaging/storage APIs are mocked; no external website is used.
const root = new URL('.', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
let browser;
before(async () => {
  const defaultEdge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const defaultChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || (process.platform === 'win32' ? (fs.existsSync(defaultEdge) ? defaultEdge : fs.existsSync(defaultChrome) ? defaultChrome : undefined) : undefined);
  browser = await chromium.launch({ executablePath });
});
after(async () => { await browser?.close(); });

function garden(count, id = 'garden-one') {
  const startedAt = Date.UTC(2026, 8, 7, 9);
  return {
    id, mission: 'Research a little more intentionally', status: 'active', startedAt,
    endedAt: null, endReason: null, interventionPaused: false, events: [],
    nodes: Array.from({ length: count }, (_, index) => ({
      id: `${id}-node-${index}`, parentId: index ? `${id}-node-${index - 1}` : null,
      depth: index, url: `https://example.test/page-${index}`, title: `Research page ${index + 1}`,
      state: 'normal', relationshipConfidence: 'direct', firstSeenAt: startedAt + index * 1000, tabIds: []
    }))
  };
}
function stateFor(...sessions) {
  return { ...emptyState(), sessions, activeSessionId: sessions.at(-1)?.id || null };
}
async function openDashboard(t, state = stateFor(), viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  t.after(() => assert.deepEqual(errors, [], 'dashboard must not log rendering or CSP errors'));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://focus-forest.test') return route.abort();
    const pathname = url.pathname.slice(1);
    const contentType = pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.js') ? 'text/javascript' : 'text/html';
    await route.fulfill({
      body: await readFile(new URL(pathname, root)), contentType,
      headers: { 'Content-Security-Policy': manifest.content_security_policy.extension_pages }
    });
  });
  await page.addInitScript(({ initialState, storageKey }) => {
    let state = initialState;
    const listeners = new Set();
    globalThis.chrome = {
      runtime: {
        id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        getManifest: () => ({ version: '0.3.2' }),
        async sendMessage(message) {
          globalThis.contentMessages ||= [];
          globalThis.contentMessages.push(message);
          if (message.type === 'GET_SNAPSHOT') {
            const selected = state.sessions.find(session => session.id === message.sessionId);
            const active = state.sessions.find(session => session.id === state.activeSessionId);
            return structuredClone({
              state, activeSessionId: state.activeSessionId,
              session: selected || active || state.sessions.at(-1) || null
            });
          }
          if (message.type === 'GET_ACTIVE_VIEW') return { session: null, settings: { growthAnimationTrigger: 'none' } };
          if (message.type === 'OBSERVE_PAGE') return null;
          if (message.type === 'SPA_NAVIGATION') return null;
          if (message.type === 'GET_DASHBOARD_STATS') {
            return { totalSessions: state.sessions.length, totalFocusTime: 0, currentStreak: 0,
              weeklyData: [], domainData: [], history: [], savedItems: [] };
          }
          throw new Error(`Unexpected test message: ${message.type}`);
        }
      },
      storage: { onChanged: {
        addListener: listener => listeners.add(listener),
        removeListener: listener => listeners.delete(listener)
      } }
    };
    globalThis.updateTestState = next => {
      const oldValue = state;
      state = next;
      for (const listener of listeners) listener({ [storageKey]: { oldValue, newValue: state } }, 'local');
    };
  }, { initialState: state, storageKey: STORAGE_KEY });
  await page.goto('https://focus-forest.test/dashboard/index.html');
  await page.waitForFunction(() => document.querySelector('#tree').dataset.treeMode);
  return page;
}

test('empty garden is visible immediately, including when the active Map button is clicked', async t => {
  const page = await openDashboard(t);
  assert.equal(await page.locator('#tree').isVisible(), true);
  assert.equal(await page.locator('#tree').getAttribute('data-tree-mode'), 'empty');
  await page.locator('[data-tab="map"]').click();
  assert.equal(await page.locator('#tree').isVisible(), true);
  assert.equal(await page.locator('#stats-tab').isVisible(), false);
  assert.equal(await page.locator('#branch-detail').isVisible(), false);
});

test('young trees have a filled cartoon crown, a wooden trunk, and selectable pages', async t => {
  for (const count of [1, 2]) {
    const page = await openDashboard(t, stateFor(garden(count)));
    assert.equal(await page.locator('#tree').isVisible(), true);
    assert.equal(await page.locator('#tree .node').count(), count);
    assert.equal(await page.locator('#tree .branch-layer .branch-taper').count(), count - 1);
    assert.equal(await page.locator('#tree .canopy-silhouette').count(), 1);
    assert.equal(await page.locator('#tree .foliage-puff').count(), 6);
    assert.equal(await page.locator('#tree .tree-bole').count(), 1);
    assert.equal(await page.locator('#tree .wood-limb').count(), 2);
    assert.equal(await page.locator('#tree .branch-twig').count(), 4);
    assert.equal(await page.locator('#tree .branch-bud').count(), 4);
    const crownFill = await page.locator('#tree .canopy-silhouette').evaluate(el => getComputedStyle(el).fill);
    assert.notEqual(crownFill, 'none');
    assert.notEqual(crownFill, 'rgb(0, 0, 0)');
    assert.equal(await page.locator('#tree .page-leaf').count(), count - 1);
  }
});

test('deep branches and leaf clusters stay inside the SVG drawing area', async t => {
  const page = await openDashboard(t, stateFor(garden(13)));
  await page.locator('[data-tab="stats"]').click();
  await page.locator('[data-tab="map"]').click();
  assert.equal(await page.locator('#tree').isVisible(), true);
  const overflow = await page.locator('#tree').evaluate(svg => {
    const box = svg.getBoundingClientRect();
    return [...svg.querySelectorAll('.node')].filter(node => {
      const bounds = node.getBoundingClientRect();
      return bounds.x < box.x || bounds.y < box.y ||
        bounds.x + bounds.width > box.x + box.width || bounds.y + bounds.height > box.y + box.height;
    }).map(node => node.dataset.nodeId);
  });
  assert.deepEqual(overflow, [], 'no branch tip should be clipped above the canvas');
});

test('switching between Insights and Garden Map restores the tree', async t => {
  const page = await openDashboard(t, stateFor(garden(6)));
  await page.locator('[data-tab="stats"]').click();
  assert.equal(await page.locator('#tree').isVisible(), false);
  assert.equal(await page.locator('#stats-tab').isVisible(), true);
  await page.locator('[data-tab="map"]').click();
  assert.equal(await page.locator('#tree').isVisible(), true);
  assert.equal(await page.locator('#tree .node').count(), 6);
});

test('new browsing branches appear without reloading an already-open garden', async t => {
  const page = await openDashboard(t, stateFor(garden(2)));
  await page.evaluate(state => updateTestState(state), stateFor(garden(3)));
  await page.waitForFunction(() => document.querySelectorAll('#tree .node').length === 3, null, { timeout: 3000 });
  assert.equal(await page.locator('#tree .branch-layer .branch-taper').count(), 2);
  await page.evaluate(state => updateTestState(state), stateFor());
  await page.waitForFunction(() => document.querySelector('#tree').dataset.treeMode === 'empty', null, { timeout: 3000 });
  assert.equal(await page.locator('#tree .node').count(), 0);
});

test('keyboard selection highlights the full branch and closing details hides the panel', async t => {
  const page = await openDashboard(t, stateFor(garden(6)));
  // Also exercise the tab round-trip rather than depending on startup state.
  await page.locator('[data-tab="stats"]').click();
  await page.locator('[data-tab="map"]').click();
  const leaf = page.locator('#tree .node[data-node-id="garden-one-node-5"]');
  await leaf.focus();
  await page.keyboard.press('Enter');
  await page.locator('#branch-detail h3').waitFor();
  assert.equal(await page.locator('#tree .highlight-layer .branch-taper').count(), 5);
  assert.equal(await page.locator('#branch-detail h3').textContent(), 'Research page 6');
  await page.locator('[data-branch-action="close"]').click();
  await page.waitForFunction(() => document.querySelector('#branch-detail').hidden);
  assert.equal(await page.locator('#branch-detail').isVisible(), false);
});

test('the tree remains visible on a narrow screen', async t => {
  const page = await openDashboard(t, stateFor(garden(8)), { width: 390, height: 844 });
  assert.equal(await page.locator('#tree').isVisible(), true);
  const bounds = await page.locator('#tree').boundingBox();
  assert.ok(bounds.width > 0 && bounds.x >= 0 && bounds.x + bounds.width <= 390);
});


test('the page picker exposes small or crowded leaves and preserves the real ancestry', async t => {
  const page = await openDashboard(t, stateFor(garden(96)), { width: 390, height: 844 });
  assert.equal(await page.locator('#tree-page-select option').count(), 97);
  await page.locator('#tree-page-select').selectOption('garden-one-node-95');
  await page.locator('#branch-detail h3').waitFor();
  assert.equal(await page.locator('#branch-detail h3').textContent(), 'Research page 96');
  assert.equal(await page.locator('#tree .highlight-layer .branch-taper').count(), 95);
  assert.equal(await page.locator('#tree .node.selected').getAttribute('aria-pressed'), 'true');
});


test('the new-tab illustration shares the cartoon artwork without fake selectable pages', async t => {
  const page = await openDashboard(t);
  await page.goto('https://focus-forest.test/newtab/index.html');
  await page.locator('#welcome-tree .canopy-silhouette').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#welcome-tree .foliage-puff').count(), 6);
  assert.equal(await page.locator('#welcome-tree .branch-twig').count(), 4);
  assert.equal(await page.locator('#welcome-tree .branch-bud').count(), 4);
  assert.equal(await page.locator('#welcome-tree [tabindex]').count(), 0);
  assert.notEqual(await page.locator('#welcome-tree .canopy-silhouette').evaluate(el => getComputedStyle(el).fill), 'rgb(0, 0, 0)');
});

test('the companion cartoon icon builds under a strict Trusted Types CSP', async t => {
  const page = await openDashboard(t);
  // Observe the closed ShadowRoot in the test harness only; production stays closed.
  await page.evaluate(() => {
    const attachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) {
      const root = attachShadow.call(this, options);
      if (this.id === 'focus-forest-root') globalThis.testCompanionRoot = root;
      return root;
    };
  });
  await page.evaluate(() => import('/content/content.js'));
  await page.waitForFunction(() => globalThis.testCompanionRoot?.querySelector('.chip-seed-tree'));
  const shapeCount = await page.evaluate(() => testCompanionRoot.querySelectorAll('.chip-seed-tree path').length);
  assert.equal(shapeCount, 4);
});

test('title-only SPA changes notify the background without changing the URL', async t => {
  const page = await openDashboard(t);
  await page.evaluate(() => import('/content/content.js'));
  await page.waitForFunction(() => globalThis.contentMessages?.some(message => message.type === 'GET_ACTIVE_VIEW'));
  await page.evaluate(() => { document.title = 'A new chapter'; });
  await page.waitForFunction(() => globalThis.contentMessages?.some(message => message.type === 'SPA_NAVIGATION' && message.title === 'A new chapter'));
});

test('pushState snapshots and Back navigation preserve SPA route history', async t => {
  const page = await openDashboard(t);
  await page.evaluate(() => import('/content/content.js'));
  await page.waitForFunction(() => globalThis.contentMessages?.some(message => message.type === 'GET_ACTIVE_VIEW'));
  await page.evaluate(() => {
    history.pushState({}, '', '/chapter-one');
    history.pushState({}, '', '/chapter-two');
  });
  await page.waitForFunction(() => {
    const routes = globalThis.contentMessages?.filter(message => message.type === 'SPA_NAVIGATION').map(message => new URL(message.url).pathname) || [];
    return routes.includes('/chapter-one') && routes.includes('/chapter-two');
  });
  await page.goBack();
  await page.waitForFunction(() => globalThis.contentMessages?.filter(message => message.type === 'SPA_NAVIGATION').some(message => new URL(message.url).pathname === '/chapter-one'));
  assert.equal(new URL(page.url()).pathname, '/chapter-one');
});
