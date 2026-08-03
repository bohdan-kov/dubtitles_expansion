/** Popup appearance — shared by the popup (owner) and the worker (toolbar icon). */

export type ThemeMode = 'system' | 'light' | 'dark';
/** `'system'` resolved against the OS setting. */
export type ResolvedTheme = 'light' | 'dark';

/**
 * The preference itself syncs across the profile; the resolved value is
 * device-local (it depends on that machine's OS setting).
 */
export const THEME_STORAGE_KEY = 'theme';
export const THEME_RESOLVED_STORAGE_KEY = 'themeResolved';

export const DEFAULT_THEME: ThemeMode = 'system';
/** Matches the icon set the manifest ships as `default_icon`. */
export const DEFAULT_RESOLVED_THEME: ResolvedTheme = 'dark';

/**
 * Toolbar icon for a theme: the mark always sits on that theme's `--primary`
 * surface — dark (#343434) in light mode, light (#fafafa) in dark mode.
 */
export function actionIconPaths(theme: ResolvedTheme): Record<number, string> {
  return {
    16: `icons/${theme}/icon16.png`,
    32: `icons/${theme}/icon32.png`,
    48: `icons/${theme}/icon48.png`,
    128: `icons/${theme}/icon128.png`,
  };
}

/**
 * Publish the resolved theme so the worker can repaint the toolbar icon.
 * Written only on change — every write wakes the service worker.
 */
export function publishResolvedTheme(resolved: ResolvedTheme): void {
  chrome.storage.local.get({ [THEME_RESOLVED_STORAGE_KEY]: null }, (stored) => {
    if (stored[THEME_RESOLVED_STORAGE_KEY] === resolved) return;
    chrome.storage.local.set({ [THEME_RESOLVED_STORAGE_KEY]: resolved });
  });
}
