import { renderTreeIllustration } from '../dashboard/tree-renderer.js';
import { logError, wrapWithErrorBoundary, ERROR_CATEGORIES } from '../shared/error-tracing.js';
import { applyStoredTheme } from '../shared/theme.js';

applyStoredTheme();

renderTreeIllustration(document.querySelector('#welcome-tree'), 'sapling');
renderTreeIllustration(document.querySelector('#onboarding-tree'), 'seed');

// DOM Elements - New Structure
const form = document.querySelector('#mission-form');
const input = document.querySelector('#mission-input');
const missionNote = document.querySelector('#mission-note');
const charCurrent = document.querySelector('#char-current');
const status = document.querySelector('#form-status');
const resumeBtn = document.querySelector('#resume-mission-btn');
const browseBtn = document.querySelector('#browse-freely-btn');

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

function statusWithReward(prefix, result) {
  return result?.reward?.text ? `${prefix} · Forest Find: ${result.reward.text}` : prefix;
}

// Update character counter
function updateCount() { if (charCurrent) { charCurrent.textContent = input.value.length.toString(); } }

// Initialize page
const safeInit = wrapWithErrorBoundary(init, { category: ERROR_CATEGORIES.UI_RENDER, function: 'init' });
async function init() {
  let onboardingVisible = false;
  try {
    const snap = await message('GET_SNAPSHOT');
    document.body.dataset.motion = snap?.settings?.ambientMotion === false ? 'off' : 'on';
    if (snap && snap.session) {
      resumeBtn.hidden = false;
      resumeBtn.querySelector('.action-text').textContent = `Continue Session · "${snap.session.mission}"`;
      const threshold = snap.thresholds?.INTERRUPT || 5;
      const currentDepth = Math.max(...snap.session.nodes.map((node) => node.depth || 0), 0);
      if (currentDepth >= threshold) {
        resumeBtn.querySelector('.action-text').textContent += ` · ${currentDepth} branches deep`;
      }
    }
    if (snap && snap.state && !snap.state.onboardingCompleted) {
      const overlay = document.getElementById('onboarding-overlay');
      if (overlay) {
        overlay.hidden = false;
        onboardingVisible = true;
        document.getElementById('onboarding-start')?.focus();
      }
    }
  } catch (err) { logError(err, { category: ERROR_CATEGORIES.MESSAGING, function: 'init' }); }
  // Never steal focus from the welcome overlay: it is the only visible control
  // until the user dismisses it, so focusing the field behind it would strand
  // keyboard users on an element they cannot see.
  if (!onboardingVisible) setTimeout(() => input.focus(), 350);
}

function initSafely() { return safeInit().catch((error) => { logError(error, { category: ERROR_CATEGORIES.UI_RENDER, function: 'initSafely' }); }); }

// Event Listeners
input.addEventListener('input', wrapWithErrorBoundary(updateCount, { category: ERROR_CATEGORIES.UI_RENDER, function: 'updateCount', swallow: true }));

form.addEventListener('submit', wrapWithErrorBoundary(async (event) => {
  event.preventDefault();
  const mission = input.value.trim();
  if (!mission) { input.focus(); return; }
  try {
    await message('START_MISSION', { mission, missionNote: missionNote?.value.trim() || '', openSearch: true, tab: { url: location.href, title: 'Focus Forest' } });
    status.hidden = false;
    status.textContent = '🌱 Intention planted! Opening a gentle first step...';
    input.blur();
    missionNote.value = '';
  } catch (err) {
    logError(err, { category: ERROR_CATEGORIES.MESSAGING, function: 'startMission' });
    status.hidden = false;
    status.textContent = 'Could not start session. Please try again.';
  }
}, { category: ERROR_CATEGORIES.MESSAGING, function: 'form.submit', swallow: true }));

input.addEventListener('keydown', wrapWithErrorBoundary((event) => {
  if (event.key !== 'Enter' || event.isComposing) return;
  event.preventDefault();
  if (typeof form.requestSubmit === 'function') form.requestSubmit();
  else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}, { category: ERROR_CATEGORIES.MESSAGING, function: 'mission-input.keydown', swallow: true }));

resumeBtn.addEventListener('click', wrapWithErrorBoundary(async () => {
  try {
    const view = await message('GO_HOME');
    status.hidden = false;
    const originUrl = view?.session?.origin?.url;
    let hasRealDestination = false;
    try {
      const parsed = new URL(originUrl || '');
      hasRealDestination = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {}
    if (hasRealDestination) {
      status.textContent = statusWithReward('✓ Returning to your active session...', view);
    } else {
      status.textContent = statusWithReward('Active intention ready — search or enter a URL to explore.', view);
    }
    setTimeout(() => { status.hidden = true; }, 3000);
  } catch (err) { logError(err, { category: ERROR_CATEGORIES.MESSAGING, function: 'resumeClick' }); }
}, { category: ERROR_CATEGORIES.MESSAGING, function: 'resume.click', swallow: true }));

browseBtn.addEventListener('click', wrapWithErrorBoundary(async () => {
  try {
    const result = await message('END_MISSION', { reason: 'browse_without_mission' });
    resumeBtn.hidden = true;
    status.hidden = false;
    status.textContent = statusWithReward('Browse freely — plant an intention whenever you\'re ready.', result);
    input.focus();
    setTimeout(() => { status.hidden = true; }, 4000);
  } catch (err) { logError(err, { category: ERROR_CATEGORIES.MESSAGING, function: 'browseClick' }); }
}, { category: ERROR_CATEGORIES.MESSAGING, function: 'browse.click', swallow: true }));

updateCount();
initSafely();

// Battery Optimization: Pause animations when tab is hidden
function updatePageVisibility() {
  document.body.dataset.pageVisibility = document.hidden ? 'hidden' : 'visible';
}

// Set initial state
updatePageVisibility();

// Listen for visibility changes
document.addEventListener('visibilitychange', updatePageVisibility);

// Onboarding dismiss
const onboardingStart = document.getElementById('onboarding-start');
if (onboardingStart) {
  onboardingStart.addEventListener('click', wrapWithErrorBoundary(async () => {
    const overlay = document.getElementById('onboarding-overlay');
    if (overlay) overlay.hidden = true;
    await message('COMPLETE_ONBOARDING');
  }, { category: ERROR_CATEGORIES.MESSAGING, function: 'onboarding.start', swallow: true }));
}
