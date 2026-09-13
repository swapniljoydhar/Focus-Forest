import { logError, wrapWithErrorBoundary, ERROR_CATEGORIES } from '../shared/error-tracing.js';

async function message(type, payload = {}) { return chrome.runtime.sendMessage({ type, ...payload }); }
const gentle = document.querySelector('#gentle'); const choice = document.querySelector('#choice'); const motion = document.querySelector('#motion'); const excludedSites = document.querySelector('#excluded-sites'); const status = document.querySelector('#status'); const save = document.querySelector('#save');
const gentleValue = document.querySelector('#gentle-value'); const choiceValue = document.querySelector('#choice-value');
const gentlePreviewLabel = document.querySelector('#gentle-preview-label'); const choicePreviewLabel = document.querySelector('#choice-preview-label');
const previewGentle = document.querySelector('#preview-gentle'); const previewChoice = document.querySelector('#preview-choice');
const previewCopy = document.querySelector('#preview-copy');
const original = { gentleDepth: 4, choiceDepth: 5, ambientMotion: true, growthAnimationTrigger: 'mission-origin', excludedSites: [] }; let saved = { ...original }; let ready = false;
function currentSettings() { return { gentleDepth: Number(gentle.value), choiceDepth: Number(choice.value), ambientMotion: motion.checked, growthAnimationTrigger: document.querySelector('input[name="growth-animation"]:checked')?.value || 'mission-origin', excludedSites: excludedSites.value.split(/\r?\n/).map((site) => site.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean) }; }
function markDirty() { if (!ready) return; const dirty = JSON.stringify(currentSettings()) !== JSON.stringify(saved); save.disabled = !dirty; if (dirty) status.textContent = 'You have a rhythm change ready to save.'; }
function sync() {
  const g = Number(gentle.value);
  if (Number(choice.value) <= g) choice.value = String(Math.min(10, g + 1));
  const c = Number(choice.value);
  gentleValue.textContent = g;
  choiceValue.textContent = c;
  gentlePreviewLabel.textContent = `Quieter at ${g}`;
  choicePreviewLabel.textContent = `Choice at ${c}`;
  previewGentle.style.left = `${(g / 10) * 100}%`;
  previewChoice.style.left = `${(c / 10) * 100}%`;
  previewCopy.textContent = g <= 3 ? 'The forest will whisper early, useful for short and deliberate paths.' : c >= 7 ? 'There is more room to explore before the forest offers a choice.' : 'The path stays open. The forest simply becomes easier to notice.';
  markDirty();
}
const safeLoad = wrapWithErrorBoundary(load, { category: ERROR_CATEGORIES.UI_RENDER, function: 'load' });
async function load() { 
  try { 
    const snap = await message('GET_SNAPSHOT'); 
    const settings = snap.settings || original; 
    saved = { gentleDepth: settings.gentleDepth || original.gentleDepth, choiceDepth: settings.choiceDepth || original.choiceDepth, ambientMotion: settings.ambientMotion !== false, growthAnimationTrigger: ['mission-origin', 'every-branch', 'none'].includes(settings.growthAnimationTrigger) ? settings.growthAnimationTrigger : original.growthAnimationTrigger, excludedSites: Array.isArray(settings.excludedSites) ? settings.excludedSites : [] };
    gentle.value = saved.gentleDepth; 
    choice.value = saved.choiceDepth; 
    motion.checked = saved.ambientMotion; 
    excludedSites.value = saved.excludedSites.join('\n');
    const radio = document.querySelector(`input[name="growth-animation"][value="${saved.growthAnimationTrigger}"]`); 
    if (radio) radio.checked = true; 
    ready = true; 
    sync(); 
    save.disabled = true; 
    status.textContent = 'Your current rhythm is already tending the forest.'; 
  } catch (error) { 
    logError(error, { category: ERROR_CATEGORIES.MESSAGING, function: 'load' });
    status.textContent = 'The forest could not read its local rhythm. Try again.'; 
  } 
}
gentle.addEventListener('input', wrapWithErrorBoundary(sync, { category: ERROR_CATEGORIES.UI_RENDER, function: 'gentle.input', swallow: true }));
choice.addEventListener('input', wrapWithErrorBoundary(sync, { category: ERROR_CATEGORIES.UI_RENDER, function: 'choice.input', swallow: true }));
motion.addEventListener('change', wrapWithErrorBoundary(markDirty, { category: ERROR_CATEGORIES.UI_RENDER, function: 'motion.change', swallow: true }));
excludedSites.addEventListener('input', wrapWithErrorBoundary(markDirty, { category: ERROR_CATEGORIES.UI_RENDER, function: 'excluded-sites.input', swallow: true }));
document.querySelectorAll('input[name="growth-animation"]').forEach((radio) => radio.addEventListener('change', wrapWithErrorBoundary(markDirty, { category: ERROR_CATEGORIES.UI_RENDER, function: 'growth-animation.change', swallow: true })));
save.addEventListener('click', wrapWithErrorBoundary(async () => { 
  sync(); 
  try { 
    await message('UPDATE_SETTINGS', { settings: currentSettings() }); 
    saved = currentSettings(); 
    save.disabled = true; 
    status.textContent = 'Your rhythm is tending the forest now.'; 
  } catch (error) { 
    logError(error, { category: ERROR_CATEGORIES.MESSAGING, function: 'save.click' });
    status.textContent = 'The rhythm could not be saved. Nothing was changed.'; 
  } 
}, { category: ERROR_CATEGORIES.MESSAGING, function: 'save.click', swallow: true }));
document.querySelector('#reset').addEventListener('click', wrapWithErrorBoundary(async () => { 
  try { 
    await message('UPDATE_SETTINGS', { settings: original }); 
    saved = { ...original }; 
    gentle.value = original.gentleDepth; 
    choice.value = original.choiceDepth; 
    motion.checked = original.ambientMotion; 
    excludedSites.value = '';
    const radio = document.querySelector(`input[name="growth-animation"][value="${original.growthAnimationTrigger}"]`); 
    if (radio) radio.checked = true; 
    sync(); 
    save.disabled = true; 
    status.textContent = 'The original rhythm has returned.'; 
  } catch (error) { 
    logError(error, { category: ERROR_CATEGORIES.MESSAGING, function: 'reset.click' });
    status.textContent = 'The original rhythm could not be restored.'; 
  } 
}, { category: ERROR_CATEGORIES.MESSAGING, function: 'reset.click', swallow: true }));
safeLoad();
