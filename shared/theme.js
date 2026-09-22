/**
 * Shared theme preference for all extension pages.
 * The dashboard owns the toggle; every other page respects the same stored
 * choice (extension pages share one localStorage origin).
 */

// Module-internal storage key; pages interact through applyStoredTheme/toggleTheme.
const THEME_STORAGE_KEY = 'focus-forest-theme';

/** Apply the user's stored theme (dark/light) to the current page's <html>. */
export function applyStoredTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch { /* storage may be unavailable */ }
}

/** Toggle between light and dark, persist the choice, and apply it. */
export function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  html.setAttribute('data-theme', next);
  try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* storage may be unavailable */ }
  return next;
}

/** Remove the stored theme choice; used by the dashboard's clear-all-data
 *  flow so no preference outlives an explicit local data wipe. */
export function clearStoredTheme() {
  try { localStorage.removeItem(THEME_STORAGE_KEY); } catch { /* storage may be unavailable */ }
  document.documentElement.removeAttribute('data-theme');
}
