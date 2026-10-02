import { chromium } from 'playwright';
import path from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolveBraveExecutablePath } from './browser-runtime.mjs';

const root = process.env.INTENT_GROVE_ROOT
  ? path.resolve(process.env.INTENT_GROVE_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = resolveBraveExecutablePath();
const browser = await chromium.launch({ headless: true, executablePath });
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const filePath = path.resolve(root, `.${pathname}`);
    if (!filePath.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
    const body = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch { response.writeHead(404).end(); }
});
server.unref();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const client = await page.context().newCDPSession(page);
await client.send('Performance.enable');
await page.goto(`http://127.0.0.1:${server.address().port}/newtab/index.html`);
await page.waitForTimeout(1500);
await page.evaluate(() => {
  document.body.dataset.tod = 'day';
  document.body.dataset.motion = 'on';
  document.body.dataset.perf = 'normal';
  document.body.dataset.pageVisibility = 'visible';
});
const before = await client.send('Performance.getMetrics');
await page.waitForTimeout(5000);
const after = await client.send('Performance.getMetrics');
const visibleActiveAnimations = await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length);
await page.evaluate(() => { document.body.dataset.tod = 'night'; });
await page.waitForTimeout(1500); // let the one-time dusk/night opacity transition settle
const nightAnimationState = await page.evaluate(() => ({
  active: document.getAnimations().filter(animation => animation.playState === 'running').length,
  fireflies: document.getAnimations().filter(animation => animation.animationName === 'fireflyDrift' && animation.playState === 'running').length,
}));
await page.evaluate(() => { document.body.dataset.pageVisibility = 'hidden'; });
await page.waitForTimeout(500);
const snapshot = await page.evaluate(() => ({
  title: document.title,
  domNodes: document.querySelectorAll('*').length,
  stylesheets: document.styleSheets.length,
  renderedTreeNodes: document.querySelectorAll('#welcome-tree .tree-structure, #welcome-tree .canopy-back, #welcome-tree .canopy-front').length,
  animationNames: [...document.getAnimations()].map(animation => animation.animationName || animation.constructor.name),
  activeAnimations: document.getAnimations().filter(animation => animation.playState === 'running').length,
  runningAnimationNames: document.getAnimations()
    .filter(animation => animation.playState === 'running')
    .map(animation => animation.animationName || animation.constructor.name),
  reducedMotionRule: matchMedia('(prefers-reduced-motion: reduce)').matches,
  jsHeap: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize, limit: performance.memory.jsHeapSizeLimit } : null,
  longTasks: performance.getEntriesByType('longtask').map(entry => entry.duration)
}));
const metricMap = metrics => new Map(metrics.metrics.map(metric => [metric.name, metric.value]));
const b = metricMap(before);
const a = metricMap(after);
const result = {
  url: page.url(),
  domNodes: snapshot.domNodes,
  stylesheets: snapshot.stylesheets,
  animationNames: snapshot.animationNames,
  hiddenActiveAnimations: snapshot.activeAnimations,
  visibleActiveAnimations,
  nightActiveAnimations: nightAnimationState.active,
  nightFireflyAnimations: nightAnimationState.fireflies,
  hiddenRunningAnimations: snapshot.runningAnimationNames,
  reducedMotionRule: snapshot.reducedMotionRule,
  jsHeapBytes: snapshot.jsHeap,
  longTasksMs: snapshot.longTasks,
  intervalSeconds: (a.get('Timestamp') || 0) - (b.get('Timestamp') || 0),
  layoutCountDelta: (a.get('LayoutCount') || 0) - (b.get('LayoutCount') || 0),
  recalcStyleCountDelta: (a.get('RecalcStyleCount') || 0) - (b.get('RecalcStyleCount') || 0),
  scriptDurationDeltaMs: ((a.get('ScriptDuration') || 0) - (b.get('ScriptDuration') || 0)) * 1000,
  taskDurationDeltaMs: ((a.get('TaskDuration') || 0) - (b.get('TaskDuration') || 0)) * 1000,
  layoutDurationDeltaMs: ((a.get('LayoutDuration') || 0) - (b.get('LayoutDuration') || 0)) * 1000,
  recalcStyleDurationDeltaMs: ((a.get('RecalcStyleDuration') || 0) - (b.get('RecalcStyleDuration') || 0)) * 1000,
  paintImageLoaded: a.get('PaintImageCount') || 0,
};
console.log(JSON.stringify(result, null, 2));
if (process.argv.includes('--assert')) {
  const heapUsed = result.jsHeapBytes?.used || 0;
  const maxLongTask = Math.max(0, ...result.longTasksMs);
  const failures = [
    result.domNodes > 300 && `DOM node count ${result.domNodes} exceeds 300`,
    result.visibleActiveAnimations > 4 && `daytime animation count ${result.visibleActiveAnimations} exceeds the four intentional tree/atmosphere animations`,
    result.nightActiveAnimations > 10 && `night animation count ${result.nightActiveAnimations} exceeds the ten intentional tree/atmosphere/firefly animations`,
    result.nightFireflyAnimations !== 6 && `expected six firefly animations at night, got ${result.nightFireflyAnimations}`,
    maxLongTask > 100 && `long task ${maxLongTask.toFixed(1)}ms exceeds 100ms`,
    result.layoutDurationDeltaMs > 100 && `layout duration ${result.layoutDurationDeltaMs.toFixed(1)}ms exceeds 100ms`,
    result.recalcStyleDurationDeltaMs > 250 && `style recalculation ${result.recalcStyleDurationDeltaMs.toFixed(1)}ms exceeds 250ms`,
    heapUsed > 32 * 1024 * 1024 && `heap ${heapUsed} bytes exceeds 32MiB`,
    result.hiddenRunningAnimations.length > 0 && `animations remained active while the New Tab page was hidden: ${result.hiddenRunningAnimations.join(', ')}`
  ].filter(Boolean);
  if (failures.length) throw new Error(`performance regression: ${failures.join('; ')}`);
}
await browser.close();
server.close();

