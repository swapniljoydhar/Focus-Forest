/* Apply appearance before page styles paint, preventing a light-to-dark flash. */
(() => {
  try {
    const current = localStorage.getItem('intent-grove-theme');
    const legacy = localStorage.getItem('focus-forest-theme');
    const saved = current === 'dark' || current === 'light'
      ? current
      : legacy === 'dark' || legacy === 'light' ? legacy : null;
    const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
    const theme = saved || (systemDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
  } catch { /* local storage and media preferences can be unavailable */ }
})();
