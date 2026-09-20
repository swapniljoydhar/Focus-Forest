import { logError, wrapWithErrorBoundary, ERROR_CATEGORIES } from '../shared/error-tracing.js';
import { applyStoredTheme } from '../shared/theme.js';

applyStoredTheme();

/**
 * Send a message to the service worker with error handling
 * @param {string} type - Message type
 * @param {object} payload - Message payload
 * @returns {Promise<any>} Response from service worker
 */
async function message(type, payload = {}) {
  try {
    return await chrome.runtime.sendMessage({ type, ...payload });
  } catch (error) {
    // Service worker may be unavailable during startup or after crash
    logError(error, { category: ERROR_CATEGORIES.MESSAGING, operation: 'sendMessage', messageType: type });
    throw error; // Re-throw so caller can handle fallback
  }
}

async function activeTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  } catch {
    return null;
  }
}

function plantingPageUrl() {
  return chrome.runtime.getURL('newtab/index.html');
}

const empty = document.querySelector('#empty');
const active = document.querySelector('#active');
const completion = document.querySelector('#completion');
const footer = document.querySelector('#popup-footer');
const missionEl = document.querySelector('#mission');
const stateEl = document.querySelector('#state');
const depthLabelEl = document.querySelector('#depth-label');
const meterFillEl = document.querySelector('#meter-fill');
const nodesEl = document.querySelector('#nodes');
const compostEl = document.querySelector('#compost');
const pauseEl = document.querySelector('#pause');
const completeBtn = document.querySelector('#complete');
const completionCopyEl = document.querySelector('#completion-copy');
const completionTitleEl = document.querySelector('#completion-title');
const endBtn = document.querySelector('#end');

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

let latest = null;
let ritualReturnFocus = null;
// Follows the user's own rhythm while the popup is open, so the closing title
// never calls a garden "long" against thresholds they did not choose.
let thresholds = { DESATURATE: 4, INTERRUPT: 5 };

function reflectionFor(session) {
  const nodes = session.nodes || [];
  const branches = nodes.filter((node) => node.depth > 0).length;
  const neutral = nodes.filter((node) => node.relationshipConfidence === 'external').length;
  const saved = session.events.filter((event) => event.type === 'composted').length;
  const deepest = Math.max(0, ...nodes.map((node) => node.depth));
  const pages = nodes.length === 1 ? 'one page' : `${nodes.length} pages`;
  const branchLine = branches ? `The path grew through ${branches} ${branches === 1 ? 'branch' : 'branches'}.` : 'The path stayed close to its root.';
  const neutralLine = neutral ? `You also crossed ${neutral} unlinked ${neutral === 1 ? 'path' : 'paths'} without needing to call them a mistake.` : 'The path stayed close to the links you chose.';
  const savedLine = saved ? `${saved} ${saved === 1 ? 'curiosity is' : 'curiosities are'} resting in the compost pile.` : 'Nothing needed to be set aside for later.';
  return {
    deepest,
    copy: `You began with \u201c${session.mission}\u201d. ${branchLine} You grew through ${pages}, reached a deepest branch of ${deepest}, and ${savedLine} ${neutralLine}`
  };
}

function updatePauseCopy(paused) {
  pauseEl.textContent = paused ? 'Resume the forest' : 'Pause interventions';
}

function setRitual(open) {
  completion.hidden = !open;
  footer.hidden = open;
  if (open) {
    completeBtn.focus();
  } else if (ritualReturnFocus) {
    ritualReturnFocus.focus();
  }
}

const safeRender = wrapWithErrorBoundary(render, { category: ERROR_CATEGORIES.UI_RENDER, function: 'render' });

async function render() {
  const snap = await message('GET_SNAPSHOT');
  document.body.dataset.motion = snap?.settings?.ambientMotion === false ? 'off' : 'on';
  latest = snap.session;
  const session = snap.session;
  empty.hidden = Boolean(session);
  active.hidden = !session;
  setRitual(false);
  footer.hidden = Boolean(session) ? false : true;

  if (!session) return;

  const reflection = reflectionFor(session);
  const current = session.nodes.filter((node) => !node.closedAt).at(-1);
  const depth = current?.depth || 0;
  thresholds = snap.thresholds || { DESATURATE: 4, INTERRUPT: 5 };
  const state = session.interventionPaused
    ? 'Forest resting for this mission.'
    : depth >= thresholds.INTERRUPT
      ? 'This path is getting very deep.'
      : depth >= thresholds.DESATURATE
        ? 'This branch is getting long.'
        : depth > 0
          ? `Growing well — ${depth} ${depth === 1 ? 'branch' : 'branches'} from the root.`
          : 'Growing from the root of your mission.';

  missionEl.textContent = session.mission;
  stateEl.textContent = state;
  depthLabelEl.textContent = `Deepest branch ${reflection.deepest}`;
  // Show a truthful zero: the 4% floor only exists so a non-zero depth stays visible.
  meterFillEl.style.width = `${clamp((reflection.deepest / thresholds.INTERRUPT) * 100, reflection.deepest > 0 ? 4 : 0, 100)}%`;
  nodesEl.textContent = session.nodes.length;
  compostEl.textContent = snap.state.compostItems.length;

  updatePauseCopy(session.interventionPaused);
  pauseEl.setAttribute('aria-pressed', String(Boolean(session.interventionPaused)));
}

function renderSafely() {
  return safeRender().catch((error) => {
    logError(error, { category: ERROR_CATEGORIES.UI_RENDER, function: 'renderSafely' });
    latest = null;
    active.hidden = true;
    completion.hidden = true;
    footer.hidden = true;
    empty.hidden = false;
  });
}

document.querySelector('#plant-form').addEventListener('submit', wrapWithErrorBoundary(async (event) => {
  event.preventDefault();
  const input = document.querySelector('#plant-input');
  const note = document.querySelector('#plant-note');
  const status = document.querySelector('#plant-status');
  const mission = input.value.trim();
  if (!mission) { input.focus(); return; }
  status.hidden = true;
  try {
    const tab = await activeTab();
    await message('START_MISSION', {
      mission,
      missionNote: note?.value.trim() || '',
      tab: tab ? { id: tab.id, url: tab.url, title: tab.title, windowId: tab.windowId } : undefined
    });
    input.value = '';
    if (note) note.value = '';
    await renderSafely();
  } catch (error) {
    logError(error, { category: ERROR_CATEGORIES.MESSAGING, function: 'plant.submit' });
    status.hidden = false;
    status.textContent = 'Could not start this mission. Try again.';
  }
}, { category: ERROR_CATEGORIES.MESSAGING, function: 'plant.submit', swallow: true }));

document.querySelector('#open-planting').addEventListener('click', wrapWithErrorBoundary(async () => {
  await chrome.tabs.create({ url: plantingPageUrl(), active: true });
}, { category: ERROR_CATEGORIES.UI_RENDER, function: 'open-planting.click', swallow: true }));

document.querySelector('#return').addEventListener('click', wrapWithErrorBoundary(() => message('GO_HOME'), { category: ERROR_CATEGORIES.MESSAGING, function: 'return.click', swallow: true }));

pauseEl.addEventListener('click', wrapWithErrorBoundary(async () => {
  const snap = await message('GET_SNAPSHOT');
  if (!snap?.session) return;
  await message('PAUSE_INTERVENTION', { paused: !snap.session.interventionPaused });
  await renderSafely();
}, { category: ERROR_CATEGORIES.MESSAGING, function: 'pause.click', swallow: true }));

document.querySelector('#dashboard').addEventListener('click', wrapWithErrorBoundary(() => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') }), { category: ERROR_CATEGORIES.UI_RENDER, function: 'dashboard.click', swallow: true }));

document.querySelector('#settings').addEventListener('click', wrapWithErrorBoundary(() => chrome.runtime.openOptionsPage(), { category: ERROR_CATEGORIES.UI_RENDER, function: 'settings.click', swallow: true }));

endBtn.addEventListener('click', wrapWithErrorBoundary(() => {
  if (!latest) return;
  ritualReturnFocus = endBtn;
  const reflection = reflectionFor(latest);
  completionCopyEl.textContent = reflection.copy;
  completionTitleEl.textContent = reflection.deepest >= thresholds.DESATURATE ? 'This garden has a long path to remember.' : 'This garden can rest now.';
  active.hidden = true;
  setRitual(true);
}, { category: ERROR_CATEGORIES.UI_RENDER, function: 'end.click', swallow: true }));

completeBtn.addEventListener('click', wrapWithErrorBoundary(async () => {
  await message('END_MISSION', { reason: 'user_ended' });
  ritualReturnFocus = null;
  await renderSafely();
}, { category: ERROR_CATEGORIES.MESSAGING, function: 'complete.click', swallow: true }));

document.querySelector('#keep').addEventListener('click', wrapWithErrorBoundary(() => {
  active.hidden = false;
  setRitual(false);
}, { category: ERROR_CATEGORIES.UI_RENDER, function: 'keep.click', swallow: true }));

document.querySelector('#review').addEventListener('click', wrapWithErrorBoundary(() => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') }), { category: ERROR_CATEGORIES.UI_RENDER, function: 'review.click', swallow: true }));

document.addEventListener('keydown', wrapWithErrorBoundary((event) => {
  if (event.key === 'Escape' && !completion.hidden) {
    active.hidden = false;
    setRitual(false);
  }
}, { category: ERROR_CATEGORIES.UI_RENDER, function: 'keydown', swallow: true }));

renderSafely();
