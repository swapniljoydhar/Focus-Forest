(() => {
  if (typeof globalThis.chrome === 'undefined' && typeof globalThis.browser !== 'undefined') globalThis.chrome = globalThis.browser;
  // Browser-internal pages (including Chromium forks) and extension pages are not websites.
  if (!['http:', 'https:'].includes(location.protocol)) return;
  
  // --- Resilience: Prevent Duplicate Injection ---
  if (window.__focusForestInjected) {
    console.warn('[Focus Forest] Duplicate injection detected; skipping.');
    return;
  }
  window.__focusForestInjected = true;

  // Local error tracing and boundary implementations for isolated content script execution
  const ERROR_CATEGORIES = { CONTENT_SCRIPT: 'content_script', MESSAGING: 'messaging', UI_RENDER: 'ui_render', UNKNOWN: 'unknown' };
  function logError(error, context = {}) {
    const trace = {
      id: `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      message: error?.message || String(error),
      stack: error?.stack || (new Error()).stack,
      category: context.category || ERROR_CATEGORIES.UNKNOWN,
      severity: context.severity || 'medium',
      context: { url: location.href, userAgent: navigator.userAgent, ...context }
    };
    console.error('[Focus Forest Error]', JSON.stringify(trace, null, 2));
    return trace;
  }
  function wrapWithErrorBoundary(fn, context = {}) {
    const shouldRethrow = context.rethrow !== false && !context.swallow;
    return async (...args) => {
      try { return await fn(...args); }
      catch (error) {
        logError(error, { ...context, category: context.category || ERROR_CATEGORIES.UNKNOWN });
        if (shouldRethrow) throw error;
        return undefined;
      }
    };
  }

  function initContentScript() {
    function isInvalidatedContext(error) {
      return /extension context invalidated|message port closed|receiving end does not exist/i.test(String(error?.message || error));
    }
    async function send(type, payload = {}) {
      try {
        return await chrome.runtime.sendMessage({ type, ...payload });
      } catch (error) {
        // A page can outlive an extension reload. Do not turn that expected
        // lifecycle race into a visible error or interrupt the page.
        if (isInvalidatedContext(error)) return null;
        throw error;
      }
    }

  // Root host: pointer-events:none so the page behind stays fully interactive.
  // Only specific children (the chip, the choice card) opt back in with auto.
  const root = document.createElement('div');
  root.id = 'focus-forest-root';
  document.documentElement.appendChild(root);
  const shadow = root.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
:host{all:initial}
#ff-root{position:fixed;z-index:2147483646;inset:0;pointer-events:none}
#ff-root.motion-off *,#ff-root.motion-off *::before,#ff-root.motion-off *::after{animation:none!important;transition:none!important}
#ff-root *{box-sizing:border-box}
.chip{position:fixed;top:16px;right:18px;display:flex;align-items:center;gap:9px;max-width:min(380px,calc(100vw - 32px));padding:8px 8px 8px 12px;border:1px solid rgba(74,104,71,.22);border-radius:999px;background:linear-gradient(120deg,rgba(252,251,245,.97),rgba(243,248,239,.95));box-shadow:0 8px 28px rgba(42,65,41,.16),0 1px 0 rgba(255,255,255,.6) inset;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);font:13px/1.25 ui-sans-serif,system-ui,-apple-system,sans-serif;color:#29432d;pointer-events:auto;cursor:default;transition:transform .18s ease,box-shadow .18s ease,opacity .2s ease;animation:ff-slide-in .28s cubic-bezier(.2,.8,.3,1) both}
.chip:hover{box-shadow:0 10px 32px rgba(42,65,41,.22),0 1px 0 rgba(255,255,255,.6) inset}
.chip[hidden]{display:none}
.chip.dragging{transition:none;box-shadow:0 14px 40px rgba(42,65,41,.3)}
.chip[data-state="interrupt"]{border-color:rgba(189,132,115,.5)}
.chip[data-state="drift"]{border-color:rgba(198,165,98,.5)}
.chip[data-state="resting"]{opacity:.78}
.chip-seed{appearance:none;border:0;background:transparent;padding:0;position:relative;width:28px;height:28px;flex:none;cursor:grab;touch-action:none;color:inherit}
.chip-seed:active{cursor:grabbing}
.chip-seed svg{position:absolute;inset:0;width:100%;height:100%}
.chip-growth-ritual .chip-seed-tree{animation:ff-tree-grow 1.2s cubic-bezier(.25,.8,.25,1) both}
.chip-growth-flash .chip-seed-tree{animation:ff-tree-flicker .18s ease-in-out 3 both}
.chip-copy{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0;overflow:hidden}
.chip-kicker{font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:#6c8c68;white-space:nowrap}
.chip-mission{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chip-state{font-size:11px;color:#6c8c68;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chip-actions{display:flex;gap:4px;flex:none}
.chip-btn{appearance:none;border:0;border-radius:999px;background:rgba(74,104,71,.1);color:#29432d;font:inherit;font-size:11px;padding:5px 10px;cursor:pointer;transition:background .15s,transform .1s;white-space:nowrap}
.chip-btn:hover{background:rgba(74,104,71,.2)}
.chip-btn:active{transform:scale(.94)}
.chip-btn.minimize{padding:5px 7px;font-size:13px;line-height:1}
.chip.minimized .chip-copy,.chip.minimized .chip-btn:not(.minimize){display:none}
.chip.minimized{padding:6px}
.chip.minimized .chip-mission{display:block;font-size:11px;max-width:90px}
@keyframes ff-tree-grow{0%{opacity:0;transform:scale(.3)}
60%{opacity:1;transform:scale(1.05)}
100%{opacity:1;transform:scale(1)}}
@keyframes ff-tree-flicker{0%,100%{opacity:1;filter:brightness(1)}
50%{opacity:.5;filter:brightness(1.4)}}
@keyframes ff-slide-in{from{opacity:0;transform:translateY(-8px) scale(.96)} to{opacity:1;transform:translateY(0) scale(1)}}
.choice-card{position:fixed;bottom:24px;right:24px;z-index:2147483647;max-width:min(420px,calc(100vw - 32px));padding:20px 20px 18px;border:1px solid rgba(74,104,71,.2);border-radius:24px;background:rgba(252,251,245,.98);box-shadow:0 12px 36px rgba(42,65,41,.24);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);pointer-events:auto;animation:ff-slide-up .3s cubic-bezier(.2,.8,.3,1) both}
.choice-card[hidden]{display:none !important}
.choice-card .close{position:absolute;top:12px;right:12px;border:0;background:rgba(74,104,71,.1);border-radius:999px;width:28px;height:28px;font-size:16px;line-height:1;color:#3d5239;cursor:pointer;display:flex;align-items:center;justify-content:center}
.choice-card .close:hover{background:rgba(74,104,71,.2)}
.forest-find{position:fixed;right:24px;bottom:24px;max-width:min(340px,calc(100vw - 32px));padding:12px 16px;border:1px solid rgba(198,165,98,.42);border-radius:16px;background:rgba(255,251,235,.98);box-shadow:0 10px 28px rgba(82,70,39,.18);color:#5d563d;font:13px/1.4 ui-sans-serif,system-ui,sans-serif;pointer-events:auto;animation:ff-slide-up .28s ease both}
.forest-find[hidden]{display:none}
.choice-eyebrow{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#4a7c59;margin:0 0 6px}
.choice-card h2{font:600 17px/1.3 ui-sans-serif,system-ui,sans-serif;color:#29432d;margin:0 0 8px}
.choice-copy{font:14px/1.5 ui-sans-serif,system-ui,sans-serif;color:#3d5239;margin:0 0 16px}
.choice-actions{display:flex;flex-direction:column;gap:8px}
.choice{appearance:none;border:1px solid rgba(74,104,71,.2);border-radius:14px;background:rgba(255,255,255,.85);color:#29432d;font:inherit;text-align:left;padding:12px 14px;cursor:pointer;display:flex;align-items:center;gap:12px;transition:background .15s,border-color .15s,transform .1s}
.choice:hover{background:#ffffff;border-color:rgba(74,104,71,.4);transform:translateX(2px)}
.choice:active{transform:scale(.98)}
.choice.primary{background:linear-gradient(135deg,#4a7c59 0%,#3a5f46 100%);color:#ffffff;border:none}
.choice.primary small{color:rgba(255,255,255,.85)}
.choice.primary:hover{background:linear-gradient(135deg,#538b64 0%,#416b4f 100%)}
.choice-icon{font-size:16px;width:22px;text-align:center;flex:none}
.choice span{display:block}
.choice strong{font-weight:600;font-size:13px}
.choice small{font-size:11px;color:#6c8c68;margin-top:2px}
@keyframes ff-slide-up{from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)}}
`;
  shadow.append(style);

  const makeElement = (tag, className = '', attributes = {}, text = null) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value === true ? '' : String(value)));
    if (text != null) element.textContent = text;
    return element;
  };
  const makeChoice = (action, className, icon, title, copy) => {
    const button = makeElement('button', className, { 'data-action': action });
    const iconEl = makeElement('span', 'choice-icon', { 'aria-hidden': 'true' }, icon);
    const textEl = makeElement('span');
    textEl.append(makeElement('strong', '', {}, title), makeElement('small', '', {}, copy));
    button.append(iconEl, textEl);
    return button;
  };
  const rootEl = makeElement('div');
  rootEl.id = 'ff-root';
  const chipEl = makeElement('div', 'chip', { role: 'group', 'aria-label': 'Focus Forest companion', hidden: true });
  const seedEl = makeElement('button', 'chip-seed', { 'data-drag-handle': '', title: 'Drag to move', 'aria-label': 'Move companion with arrow keys' });
  // A tiny version of the storybook tree, built without an HTML/Trusted Types sink.
  const treeSVG = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  treeSVG.setAttribute('viewBox', '0 0 28 28');
  treeSVG.setAttribute('class', 'chip-seed-tree');
  const iconShapes = [
    ['ellipse', { cx: 14, cy: 25, rx: 10, ry: 1.7, fill: '#d5dfbd' }],
    ['path', { d: 'M10.5 24.5 C12 21 12 17 11.8 13 L15.8 12 C15.4 17 16 21 18 24.5 Q14 26 10.5 24.5 Z', fill: '#b78653', stroke: '#906b43', 'stroke-width': '.7' }],
    ['path', { d: 'M5 18 C1 18 0 12 3.5 10 C1.5 6 6 2.5 9 4 C10 0 16 0 18 4 C22 2 26 6 24 9 C28 11 27 17 23 18 C22 22 17 21 15 19 C11 22 7 21 5 18 Z', fill: '#7ea85b', stroke: '#537943', 'stroke-width': '.7' }],
    ['path', { d: 'M4 11 C3 7 6 5 9 6 C9 2 16 2 17 6 C21 5 24 8 21 11 C17 13 14 10 12 12 C9 15 5 14 4 11 Z', fill: '#a1c576' }],
    ['path', { d: 'M7 7 Q10 4 12 6', fill: 'none', stroke: '#deebaf', 'stroke-width': '1.1', 'stroke-linecap': 'round' }]
  ];
  iconShapes.forEach(([tag, attributes]) => {
    const shape = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([key, value]) => shape.setAttribute(key, String(value)));
    treeSVG.append(shape);
  });
  seedEl.appendChild(treeSVG);
  const copyEl = makeElement('span', 'chip-copy');
  copyEl.append(makeElement('span', 'chip-kicker', '', 'current mission'), makeElement('strong', 'chip-mission'), makeElement('small', 'chip-state', { 'aria-live': 'polite' }));
  const actionsEl = makeElement('div', 'chip-actions');
  actionsEl.append(makeElement('button', 'chip-btn', { 'data-action': 'pause', 'aria-label': 'Pause Focus Forest' }, 'Pause'), makeElement('button', 'chip-btn', { 'data-action': 'pause-site', 'aria-label': 'Pause Focus Forest on this site' }, 'This site'), makeElement('button', 'chip-btn minimize', { 'data-action': 'minimize', 'aria-label': 'Minimize Focus Forest' }, '–'));
  chipEl.append(seedEl, copyEl, actionsEl);
  const choiceCardEl = makeElement('section', 'choice-card', { role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'ff-title', hidden: true });
  choiceCardEl.append(makeElement('button', 'close', { 'data-action': 'dismiss', 'aria-label': 'Keep exploring' }, '×'), makeElement('p', 'choice-eyebrow', {}, 'A moment to choose'), makeElement('h2', '', { id: 'ff-title' }, 'This path is deep, not wrong.'), makeElement('p', 'choice-copy'));
  const choiceActionsEl = makeElement('div', 'choice-actions');
  choiceActionsEl.append(makeChoice('dismiss', 'choice', '→', 'Keep exploring', 'Leave the page open and continue by choice.'), makeChoice('home', 'choice primary', '↶', 'Return to my mission', 'Go back to where this session began.'), makeChoice('compost', 'choice', '⌁', 'Save this for later', 'Put this curiosity in your compost pile.'), makeChoice('mission', 'choice', '＋', 'Start a new mission', 'Let this become the thing you are here to do.'));
  choiceCardEl.append(choiceActionsEl);
  const forestFindEl = makeElement('aside', 'forest-find', { role: 'status', 'aria-live': 'polite', hidden: true });
  rootEl.append(chipEl, choiceCardEl, forestFindEl);
  shadow.append(rootEl);

  const chip = shadow.querySelector('.chip');
  const choiceCard = shadow.querySelector('.choice-card');
  const choiceCopy = shadow.querySelector('.choice-copy');
  const missionEl = shadow.querySelector('.chip-mission');
  const stateEl = shadow.querySelector('.chip-state');
  const pauseBtn = shadow.querySelector('[data-action="pause"]');
  const minimizeBtn = shadow.querySelector('[data-action="minimize"]');
  let current = null;
  let lastUrl = location.href;
  let lastTitle = document.title;
  let ritualToken = 0;
  let ritualTimer = 0;
  let lastPageFocus = null;
  let growthAnimationTrigger = 'mission-origin';
  let ambientMotion = true;
  let originRitualPlayed = false;
  try { originRitualPlayed = sessionStorage.getItem('ff-origin-ritual-played') === 'true'; } catch { /* storage may be unavailable */ }
  let forestFindTimer = 0;
  function showForestFind(reward) {
    if (!reward?.text) return;
    forestFindEl.textContent = `${reward.icon || '✦'} Forest Find · ${reward.text}`;
    forestFindEl.hidden = false;
    window.clearTimeout(forestFindTimer);
    forestFindTimer = window.setTimeout(() => { forestFindEl.hidden = true; }, 5200);
  }
  document.addEventListener('focusin', (event) => {
    if (event.target !== root && event.target?.isConnected) lastPageFocus = event.target;
  }, true);

  // === SPA SUPPORT: Intercept history.pushState and history.replaceState ===
  // This ensures we detect navigation in Single Page Applications (Gmail, Twitter, YouTube, etc.)
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  let spaUpdateChain = Promise.resolve();
  
  const notifyUrlChange = wrapWithErrorBoundary((nextUrl = location.href, nextTitle = document.title) => {
    // Debounce rapid changes
    if (lastUrl !== nextUrl || lastTitle !== nextTitle) {
      lastUrl = nextUrl;
      lastTitle = nextTitle;
      spaUpdateChain = spaUpdateChain.then(async () => {
        await send('SPA_NAVIGATION', { url: nextUrl, title: nextTitle });
        await safeUpdate(await send('GET_ACTIVE_VIEW'));
      }).catch((error) => {
        logError(error, { category: ERROR_CATEGORIES.MESSAGING, function: 'spaNavigation' });
      });
    }
  }, { category: ERROR_CATEGORIES.CONTENT_SCRIPT, function: 'notifyUrlChange', swallow: true });

  history.pushState = function(...args) {
    const result = originalPushState.apply(this, args);
    notifyUrlChange();
    return result;
  };

  history.replaceState = function(...args) {
    const result = originalReplaceState.apply(this, args);
    notifyUrlChange();
    return result;
  };

  // === SPA SUPPORT: MutationObserver for dynamic title changes ===
  // Some SPAs change titles without pushing state
  const titleObserver = new MutationObserver(wrapWithErrorBoundary(() => {
    if (document.title !== lastTitle) {
      notifyUrlChange();
    }
  }, { category: ERROR_CATEGORIES.UI_RENDER, function: 'titleObserver', swallow: true }));
  
  const titleElement = document.querySelector('title');
  if (titleElement) {
    titleObserver.observe(titleElement, { childList: true, characterData: true });
  }

  // The chip stays visible at all times (per README: "stays quietly available").
  // It does not auto-hide on scroll. Users can manually minimize via the minimize button.

  // --- Drag-to-move the chip (Pointer Events + setPointerCapture) ---
  let chipPos = null;
  try { const saved = sessionStorage.getItem('ff-chip-pos'); if (saved) chipPos = JSON.parse(saved); } catch { /* ignore */ }
  if (chipPos && Number.isFinite(chipPos.x) && Number.isFinite(chipPos.y)) applyChipPos(chipPos.x, chipPos.y);
  function applyChipPos(x, y) { chip.style.left = `${x}px`; chip.style.top = `${y}px`; chip.style.right = 'auto'; }
  const dragHandle = shadow.querySelector('[data-drag-handle]');
  dragHandle.addEventListener('pointerdown', wrapWithErrorBoundary((e) => {
    e.preventDefault();
    const rect = chip.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    chip.classList.add('dragging');
    dragHandle.setPointerCapture(e.pointerId);
    const onMove = wrapWithErrorBoundary((ev) => {
      const x = Math.max(8, Math.min(window.innerWidth - rect.width - 8, ev.clientX - offsetX));
      const y = Math.max(8, Math.min(window.innerHeight - rect.height - 8, ev.clientY - offsetY));
      applyChipPos(x, y);
    }, { category: ERROR_CATEGORIES.UI_RENDER, function: 'drag.pointermove', swallow: true });
    const onUp = wrapWithErrorBoundary((ev) => {
      chip.classList.remove('dragging');
      dragHandle.releasePointerCapture(ev.pointerId);
      const finalRect = chip.getBoundingClientRect();
      try { sessionStorage.setItem('ff-chip-pos', JSON.stringify({ x: finalRect.left, y: finalRect.top })); } catch { /* ignore */ }
      dragHandle.removeEventListener('pointermove', onMove);
      dragHandle.removeEventListener('pointerup', onUp);
    }, { category: ERROR_CATEGORIES.UI_RENDER, function: 'drag.pointerup', swallow: true });
    dragHandle.addEventListener('pointermove', onMove);
    dragHandle.addEventListener('pointerup', onUp);
  }, { category: ERROR_CATEGORIES.UI_RENDER, function: 'drag.pointerdown', swallow: true }));
  dragHandle.addEventListener('keydown', wrapWithErrorBoundary((event) => {
    const step = event.shiftKey ? 24 : 8;
    const rect = chip.getBoundingClientRect();
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') { chip.style.left = ''; chip.style.right = '18px'; chip.style.top = '16px'; return; }
    const x = Math.max(8, Math.min(window.innerWidth - rect.width - 8, rect.left + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0)));
    const y = Math.max(8, Math.min(window.innerHeight - rect.height - 8, rect.top + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)));
    applyChipPos(x, y);
    try { sessionStorage.setItem('ff-chip-pos', JSON.stringify({ x, y })); } catch { /* ignore */ }
  }, { category: ERROR_CATEGORIES.UI_RENDER, function: 'drag.keydown', swallow: true }));

  async function loadSettings() {
    try {
      const snap = await send('GET_ACTIVE_VIEW');
      growthAnimationTrigger = snap.settings?.growthAnimationTrigger || 'mission-origin';
      ambientMotion = snap.settings?.ambientMotion !== false;
      rootEl.classList.toggle('motion-off', !ambientMotion);
    } catch (error) {
      logError(error, { category: ERROR_CATEGORIES.MESSAGING, function: 'loadSettings' });
      growthAnimationTrigger = 'mission-origin';
    }
  }

  function cancelGrowthRitual() { ritualToken += 1; window.clearTimeout(ritualTimer); ritualTimer = 0; chip.classList.remove('chip-growth-ritual', 'chip-growth-flash'); }
  function waitForGrowth(ms, token) { return new Promise((resolve) => { ritualTimer = window.setTimeout(() => resolve(token === ritualToken), ms); }); }

  const safeShowGrowthRitual = wrapWithErrorBoundary(showGrowthRitual, { category: ERROR_CATEGORIES.UI_RENDER, function: 'showGrowthRitual' });

  async function showGrowthRitual(isOrigin = false) {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || !ambientMotion) return false;
    if (growthAnimationTrigger === 'none') return false;
    if (growthAnimationTrigger === 'mission-origin' && !isOrigin) return false;
    if (growthAnimationTrigger === 'mission-origin' && originRitualPlayed) return false;
    const token = ++ritualToken;
    window.clearTimeout(ritualTimer);
    chip.classList.remove('chip-growth-flash');
    chip.classList.add('chip-growth-ritual');
    stateEl.textContent = 'A branch is growing';
    chip.hidden = false;
    // Tree grows for ~1.2s, then flickers for ~0.5s before notification
    if (!await waitForGrowth(1200, token)) return false;
    chip.classList.remove('chip-growth-ritual');
    chip.classList.add('chip-growth-flash');
    if (!await waitForGrowth(540, token)) return false;
    chip.classList.remove('chip-growth-flash');
    if (isOrigin) {
      originRitualPlayed = true;
      try { sessionStorage.setItem('ff-origin-ritual-played', 'true'); } catch { /* storage may be unavailable */ }
    }
    return true;
  }

  const safeUpdate = wrapWithErrorBoundary(update, { category: ERROR_CATEGORIES.UI_RENDER, function: 'update' });
  async function update(view) {
    const previous = current;
    current = view?.session || null;
    if (!current?.node || view?.sitePaused) { cancelGrowthRitual(); chip.hidden = true; choiceCard.hidden = true; return; }
    const previousSessionId = previous?.id || null;
    const currentSessionId = current.id || null;
    if (previousSessionId && currentSessionId && previousSessionId !== currentSessionId) {
      originRitualPlayed = false;
      try { sessionStorage.removeItem('ff-origin-ritual-played'); } catch { /* storage may be unavailable */ }
    }
    const depth = current.node.depth || 0;
    const paused = current.interventionPaused;
    const thresholds = view?.thresholds || { DESATURATE: 4, INTERRUPT: 5 };
    const stateKind = paused ? 'resting' : depth >= thresholds.INTERRUPT ? 'interrupt' : depth >= thresholds.DESATURATE ? 'drift' : depth > 0 ? 'branch' : 'root';
    const state = paused ? 'Forest resting' : depth >= thresholds.INTERRUPT ? 'You may be wandering' : depth >= thresholds.DESATURATE ? 'This branch is getting long' : depth > 0 ? `Branch \u00b7 ${depth} ${depth === 1 ? 'step' : 'steps'} deep` : 'Growing from this mission';
    const enteredNewBranch = !paused && previous?.node?.id && previous.node.id !== current.node.id && depth > (previous.node.depth || 0);
    const isOriginLoad = !paused && !previous?.node?.id && depth === 0;
    missionEl.textContent = current.mission;
    chip.dataset.state = enteredNewBranch ? 'growing' : stateKind;
    chip.setAttribute('aria-label', `Focus Forest companion. Mission: ${current.mission}. ${state}.`);
    chip.hidden = false;
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    pauseBtn.setAttribute('aria-label', paused ? 'Resume Focus Forest' : 'Pause Focus Forest');
    if (isOriginLoad) await safeShowGrowthRitual(true); else if (enteredNewBranch) await safeShowGrowthRitual(false); else cancelGrowthRitual();
    if (!paused && view.interventionEligible && choiceCard.dataset.shownFor !== location.href) showChoiceSheet(depth, current.node.confidence);
    stateEl.textContent = state;
  }

  // DOM-safe choice sheet: all dynamic content set via textContent/elements, no innerHTML.
  function showChoiceSheet(depth, confidence = 'medium') {
    choiceCard.dataset.shownFor = location.href;
    if (document.activeElement !== root && document.activeElement?.isConnected) lastPageFocus = document.activeElement;
    choiceCopy.replaceChildren();
    const missionEl = document.createElement('q');
    missionEl.textContent = current?.mission || '';
    const depthEl = document.createElement('strong');
    depthEl.textContent = String(depth);
    const pageEl = document.createElement('q');
    pageEl.textContent = document.title || location.hostname;
    choiceCopy.append(
      document.createTextNode('You started with '),
      missionEl,
      document.createTextNode('. You are now '),
      depthEl,
      document.createTextNode(' branches away, looking at '),
      pageEl,
      document.createTextNode(`. This is a ${confidence}-confidence branch. Nothing is wrong — choose whether to keep exploring, return to your intention, or pause the forest.`)
    );
    choiceCard.hidden = false;
    shadow.querySelector('[data-action="home"]').focus();
  }

  function hideChoiceCard() { choiceCard.hidden = true; }
  function restorePageFocus() {
    const target = lastPageFocus;
    if (target?.isConnected && typeof target.focus === 'function') target.focus({ preventScroll: true });
  }

  shadow.addEventListener('click', wrapWithErrorBoundary(async (event) => {
    if (!event.isTrusted) return;
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'home') { hideChoiceCard(); showForestFind((await send('GO_HOME'))?.reward); }
    else if (action === 'compost') { showForestFind((await send('COMPOST', { url: location.href, title: document.title }))?.reward); hideChoiceCard(); restorePageFocus(); }
    else if (action === 'mission') { const result = await send('END_MISSION', { reason: 'mission_changed' }); showForestFind(result?.reward); hideChoiceCard(); window.location.href = chrome.runtime.getURL('newtab/index.html'); }
    else if (action === 'dismiss') { hideChoiceCard(); restorePageFocus(); }
    else if (action === 'pause') { await send('PAUSE_INTERVENTION', { paused: !current?.interventionPaused }); await safeRefresh(false); }
    else if (action === 'pause-site') { await send('PAUSE_SITE'); chip.hidden = true; choiceCard.hidden = true; }
    else if (action === 'minimize') { chip.classList.toggle('minimized'); minimizeBtn.textContent = chip.classList.contains('minimized') ? '+' : '\u2013'; }
  }, { category: ERROR_CATEGORIES.UI_RENDER, function: 'shadow.click', swallow: true }));

  shadow.addEventListener('keydown', wrapWithErrorBoundary((event) => {
    if (event.key === 'Escape' && !choiceCard.hidden) { hideChoiceCard(); return; }
  }, { category: ERROR_CATEGORIES.UI_RENDER, function: 'shadow.keydown', swallow: true }));

  document.addEventListener('click', wrapWithErrorBoundary(async (event) => {
    if (!event.isTrusted || event.button !== 0 || event.defaultPrevented) return;
    const link = event.target.closest('a[href]');
    if (!link) return;
    let target;
    try { target = new URL(link.href, location.href); } catch { return; }
    if (!['http:', 'https:'].includes(target.protocol) || (target.href.split('#')[0] === location.href.split('#')[0] && target.hash)) return;
    const opensElsewhere = link.target === '_blank' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
    await send('LINK_CLICK', { url: target.href, title: link.textContent?.trim() || target.hostname, targetBlank: opensElsewhere });
  }, { category: ERROR_CATEGORIES.CONTENT_SCRIPT, function: 'document.click', swallow: true }), true);

  const safeRefresh = wrapWithErrorBoundary(refresh, { category: ERROR_CATEGORIES.MESSAGING, function: 'refresh', swallow: true });
  async function refresh(observe = true) {
    try {
      if (observe) await send('OBSERVE_PAGE', { url: location.href, title: document.title });
      await safeUpdate(await send('GET_ACTIVE_VIEW'));
    } catch { update(null); }
  }

  // Adaptive SPA-URL watch: polls only while the tab is visible, backs off
  // when idle, and stops entirely on hidden tabs. The service worker also
  // receives webNavigation.onHistoryStateUpdated, so this is a render fallback.
  // Enhanced for SPAs: Reduced interval for smoother tracking during rapid navigation
  let watchTimer = 0;
  const WATCH_INTERVAL = document.hidden ? 8000 : 2500; // Faster polling when visible for better SPA responsiveness
  function scheduleWatch() {
    window.clearTimeout(watchTimer);
    if (document.hidden) return;
    watchTimer = window.setTimeout(() => {
      if (location.href !== lastUrl) { lastUrl = location.href; choiceCard.removeAttribute('data-shown-for'); refresh(true); }
      scheduleWatch();
    }, WATCH_INTERVAL);
  }

  // Debounced navigation handler to prevent rapid-fire state updates during SPA transitions
  let navDebounceTimer = null;
  const onNavigation = () => {
    if (navDebounceTimer) window.clearTimeout(navDebounceTimer);
    navDebounceTimer = window.setTimeout(() => {
      if (location.href !== lastUrl) {
        choiceCard.removeAttribute('data-shown-for');
        notifyUrlChange(location.href, document.title);
      }
    }, 100); // 100ms debounce window - faster for responsive SPA feel while preventing flicker
  };
  const safeOnNavigation = wrapWithErrorBoundary(onNavigation, { category: ERROR_CATEGORIES.CONTENT_SCRIPT, function: 'onNavigation', swallow: true });
  window.addEventListener('popstate', safeOnNavigation, { passive: true });
  
  // SPA navigation detection already implemented above with history interception and MutationObserver
  
  window.addEventListener('pageshow', wrapWithErrorBoundary(() => safeRefresh(false), { category: ERROR_CATEGORIES.CONTENT_SCRIPT, function: 'pageshow', swallow: true }), { passive: true });
  document.addEventListener('visibilitychange', wrapWithErrorBoundary(() => { if (document.hidden) window.clearTimeout(watchTimer); else { safeRefresh(false); scheduleWatch(); } }, { category: ERROR_CATEGORIES.CONTENT_SCRIPT, function: 'visibilitychange', swallow: true }));

  const safeLoadSettings = wrapWithErrorBoundary(loadSettings, { category: ERROR_CATEGORIES.MESSAGING, function: 'loadSettings', swallow: true });
  const safeScheduleWatch = wrapWithErrorBoundary(scheduleWatch, { category: ERROR_CATEGORIES.CONTENT_SCRIPT, function: 'scheduleWatch', swallow: true });

  safeLoadSettings();
  safeRefresh(true);
  safeScheduleWatch();
}

initContentScript();
})();
