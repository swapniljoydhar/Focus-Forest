import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.FOCUS_FOREST_ROOT
  ? path.resolve(process.env.FOCUS_FOREST_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const client = await page.context().newCDPSession(page);
await client.send('Performance.enable');
await page.goto(`file://${root}/newtab/index.html`);
await page.waitForTimeout(1500);
const before = await client.send('Performance.getMetrics');
await page.waitForTimeout(5000);
const after = await client.send('Performance.getMetrics');
const snapshot = await page.evaluate(() => ({
  title: document.title,
  domNodes: document.querySelectorAll('*').length,
  stylesheets: document.styleSheets.length,
  animationNames: [...document.getAnimations()].map(animation => animation.animationName || animation.constructor.name),
  activeAnimations: document.getAnimations().filter(animation => animation.playState === 'running').length,
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
  activeAnimations: snapshot.activeAnimations,
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
    result.domNodes > 160 && `DOM node count ${result.domNodes} exceeds 160`,
    maxLongTask > 100 && `long task ${maxLongTask.toFixed(1)}ms exceeds 100ms`,
    result.layoutDurationDeltaMs > 100 && `layout duration ${result.layoutDurationDeltaMs.toFixed(1)}ms exceeds 100ms`,
    result.recalcStyleDurationDeltaMs > 250 && `style recalculation ${result.recalcStyleDurationDeltaMs.toFixed(1)}ms exceeds 250ms`,
    heapUsed > 32 * 1024 * 1024 && `heap ${heapUsed} bytes exceeds 32MiB`
  ].filter(Boolean);
  if (failures.length) throw new Error(`performance regression: ${failures.join('; ')}`);
}
await browser.close();
