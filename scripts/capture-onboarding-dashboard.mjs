import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { resolveBraveExecutablePath } from './browser-runtime.mjs';
import { emptyState } from '../shared/state.js';

// Regenerate the onboarding garden screenshot from the actual dashboard UI.
// The only mocked boundary is chrome.runtime messaging; all HTML, CSS, modules,
// SVG tree rendering, and browser layout come from the extension source.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const startedAt = Date.UTC(2026, 8, 7, 9);
const pages = [
  ['Search results', null, 0],
  ['Program overview', 0, 1],
  ['Admissions requirements', 1, 2],
  ['Scholarship options', 1, 2],
  ['Application timeline', 2, 3],
  ['Research opportunities', 2, 3],
  ['Compare course plans', 3, 3],
  ['A question to revisit', 4, 4],
  ['Student support', 5, 4]
];
const session = {
  id: 'guide-sample-garden',
  mission: 'Compare computer science programs',
  note: '',
  responsePlan: 'decide',
  status: 'active',
  startedAt,
  endedAt: null,
  endReason: null,
  interventionPaused: false,
  events: [],
  activeIntervals: [],
  nodes: pages.map(([title, parentIndex, depth], index) => ({
    id: `guide-page-${index}`,
    parentId: parentIndex === null ? null : `guide-page-${parentIndex}`,
    tabIds: [],
    url: `https://example.test/research/${index}`,
    title,
    depth,
    firstSeenAt: startedAt + index * 90_000,
    relationshipConfidence: 'direct',
    confidence: 'high',
    navigationKind: index === 0 ? 'mission-origin' : 'link',
    state: 'normal'
  }))
};
const state = { ...emptyState(), sessions: [session], activeSessionId: session.id };
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png'
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    const filename = path.resolve(root, `.${pathname}`);
    if (!filename.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', mimeTypes[path.extname(filename)] || 'application/octet-stream');
    response.setHeader('Content-Security-Policy', manifest.content_security_policy.extension_pages);
    response.end(await readFile(filename));
  } catch { response.writeHead(404).end(); }
});

const executablePath = resolveBraveExecutablePath();
if (!executablePath) throw new Error('Install Brave or set BRAVE_EXECUTABLE_PATH to capture the onboarding screen.');
const browser = await chromium.launch({ headless: true, executablePath });
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const context = await browser.newContext({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.addInitScript(({ initialState }) => {
    const state = initialState;
    globalThis.chrome = {
      runtime: {
        id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        getManifest: () => ({ version: '0.3.8' }),
        async sendMessage(message) {
          if (message.type === 'GET_SNAPSHOT') {
            const selected = state.sessions.find(item => item.id === message.sessionId);
            const active = state.sessions.find(item => item.id === state.activeSessionId);
            return structuredClone({ state, activeSessionId: state.activeSessionId, session: selected || active, settings: state.settings, thresholds: { DESATURATE: 4, INTERRUPT: 5 } });
          }
          if (message.type === 'GET_DASHBOARD_STATS') return {
            totalSessions: 1, totalFocusTime: 14 * 60, totalActiveTabTime: 11 * 60,
            intentionalBranches: 8, unlinkedPaths: 0, interruptionsDismissed: 0,
            averageBranchDepth: 4, currentStreak: 1,
            weeklyData: [], domainData: [], history: [], savedItems: []
          };
          if (message.type === 'GET_ACTIVE_VIEW') return { session, settings: state.settings, thresholds: { DESATURATE: 4, INTERRUPT: 5 } };
          if (message.type === 'OBSERVE_PAGE' || message.type === 'SPA_NAVIGATION') return null;
          if (message.type === 'FORGET_SITE') return { forgotten: true };
          return null;
        }
      },
      storage: { onChanged: { addListener() {}, removeListener() {} } }
    };
  }, { initialState: state });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/dashboard/index.html`);
  await page.waitForFunction(() => document.querySelector('#tree')?.dataset.treeMode === 'canopy');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  if (errors.length) throw new Error(`Dashboard screenshot has browser errors: ${errors.join('; ')}`);
  await page.locator('.garden-card').screenshot({ path: path.join(root, 'newtab/guide-images/03-garden.png') });
  await context.close();
  console.log('Captured newtab/guide-images/03-garden.png from the live dashboard UI with fictional sample paths.');
} finally {
  await browser.close();
  server.close();
}
