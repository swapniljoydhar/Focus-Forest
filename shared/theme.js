/**
 * Shared theme preference for all extension pages.
 * Every extension surface exposes the same choice. A saved choice is shared
 * through the extension origin; otherwise the OS color preference is used.
 */

// Module-internal storage key; pages interact through applyStoredTheme/toggleTheme.
const THEME_STORAGE_KEY = 'intent-grove-theme';
const LEGACY_THEME_STORAGE_KEY = 'focus-forest-theme';

function readThemePreference() {
  try {
    const current = localStorage.getItem(THEME_STORAGE_KEY);
    if (current === 'dark' || current === 'light') {
      localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
      return current;
    }
    const legacy = localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (legacy === 'dark' || legacy === 'light') {
      localStorage.setItem(THEME_STORAGE_KEY, legacy);
      localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
      return legacy;
    }
  } catch { /* storage may be unavailable */ }
  return null;
}

function systemTheme() {
  try { return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  catch { return 'light'; }
}

function updateThemeButtons() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  for (const button of document.querySelectorAll('[data-theme-toggle]')) {
    const target = dark ? 'light' : 'dark';
    button.setAttribute('aria-label', `Switch to ${target} theme`);
    button.title = `Switch to ${target} theme`;
    const label = button.querySelector('[data-theme-label]');
    if (label) label.textContent = `${dark ? 'Dark' : 'Light'} theme`;
    const icon = button.querySelector('[data-theme-icon]');
    if (icon) icon.textContent = dark ? '☼' : '☾';
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
  updateThemeButtons();
}

/** Apply the user's stored theme (dark/light) to the current page's <html>. */
export function applyStoredTheme() {
  const saved = readThemePreference();
  applyTheme(saved || systemTheme());

  // Follow the OS until the user chooses a theme. Extension pages share
  // localStorage, and the storage event keeps already-open surfaces in sync.
  try {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', () => {
      if (!readThemePreference()) applyTheme(systemTheme());
    });
    window.addEventListener('storage', (event) => {
      if (event.key === THEME_STORAGE_KEY || event.key === LEGACY_THEME_STORAGE_KEY) {
        applyTheme(readThemePreference() || systemTheme());
      }
    });
  } catch { /* older browsers may not support preference change events */ }
}

/** Toggle between light and dark, persist the choice, and apply it. */
export function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
    localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
  } catch { /* storage may be unavailable */ }
  return next;
}

/** Attach one accessible, synchronized theme control to each current surface. */
export function mountThemeToggle() {
  for (const button of document.querySelectorAll('[data-theme-toggle]')) {
    button.addEventListener('click', toggleTheme);
  }
  updateThemeButtons();
}

/** Remove the stored theme choice; used by the dashboard's clear-all-data
 *  flow so no preference outlives an explicit local data wipe. */
export function clearStoredTheme() {
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
    localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
  } catch { /* storage may be unavailable */ }
  applyTheme(systemTheme());
}
