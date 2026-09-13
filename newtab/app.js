import { renderTreeIllustration } from '../dashboard/tree-renderer.js';
import { logError, wrapWithErrorBoundary, ERROR_CATEGORIES } from '../shared/error-tracing.js';

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

// Message helper
async function message(type, payload = {}) { return chrome.runtime.sendMessage({ type, ...payload }); }

// Update character counter
function updateCount() { if (charCurrent) { charCurrent.textContent = input.value.length.toString(); } }

// Initialize page
const safeInit = wrapWithErrorBoundary(init, { category: ERROR_CATEGORIES.UI_RENDER, function: 'init' });
async function init() {
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
        document.getElementById('onboarding-start')?.focus();
      }
    }
  } catch (err) { logError(err, { category: ERROR_CATEGORIES.MESSAGING, function: 'init' }); }
  setTimeout(() => input.focus(), 350);
}

function initSafely() { return safeInit().catch((error) => { logError(error, { category: ERROR_CATEGORIES.UI_RENDER, function: 'initSafely' }); }); }

// Event Listeners
input.addEventListener('input', wrapWithErrorBoundary(updateCount, { category: ERROR_CATEGORIES.UI_RENDER, function: 'updateCount', swallow: true }));

form.addEventListener('submit', wrapWithErrorBoundary(async (event) => {
  event.preventDefault();
  const mission = input.value.trim();
  if (!mission) { input.focus(); return; }
  try {
    await message('START_MISSION', { mission, missionNote: missionNote?.value.trim() || '', tab: { url: location.href, title: 'Focus Forest' } });
    status.hidden = false;
    status.textContent = '🌱 Intention planted! Your mission is ready when you are.';
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
      status.textContent = '✓ Returning to your active session...';
    } else {
      status.textContent = 'Active intention ready — search or enter a URL to explore.';
    }
    setTimeout(() => { status.hidden = true; }, 3000);
  } catch (err) { logError(err, { category: ERROR_CATEGORIES.MESSAGING, function: 'resumeClick' }); }
}, { category: ERROR_CATEGORIES.MESSAGING, function: 'resume.click', swallow: true }));

browseBtn.addEventListener('click', wrapWithErrorBoundary(async () => {
  try {
    await message('END_MISSION', { reason: 'browse_without_mission' });
    resumeBtn.hidden = true;
    status.hidden = false;
    status.textContent = 'Browse freely — plant an intention whenever you\'re ready.';
    input.focus();
    setTimeout(() => { status.hidden = true; }, 4000);
  } catch (err) { logError(err, { category: ERROR_CATEGORIES.MESSAGING, function: 'browseClick' }); }
}, { category: ERROR_CATEGORIES.MESSAGING, function: 'browse.click', swallow: true }));

updateCount();
initSafely();

// Onboarding dismiss
const onboardingStart = document.getElementById('onboarding-start');
if (onboardingStart) {
  onboardingStart.addEventListener('click', wrapWithErrorBoundary(async () => {
    const overlay = document.getElementById('onboarding-overlay');
    if (overlay) overlay.hidden = true;
    await message('COMPLETE_ONBOARDING');
  }, { category: ERROR_CATEGORIES.MESSAGING, function: 'onboarding.start', swallow: true }));
}
