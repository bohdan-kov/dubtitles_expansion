import { onScopeDispose, ref } from 'vue';

import type { ThemeMode } from '@/shared/theme';
import { DEFAULT_THEME, publishResolvedTheme, THEME_STORAGE_KEY } from '@/shared/theme';

export type { ThemeMode } from '@/shared/theme';

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

/**
 * shadcn's dark palette hangs off a `.dark` class on <html>. The resolved value
 * is published so the worker can swap the toolbar icon to match.
 */
export function applyTheme(mode: ThemeMode): void {
  const dark = mode === 'dark' || (mode === 'system' && darkQuery.matches);
  document.documentElement.classList.toggle('dark', dark);
  publishResolvedTheme(dark ? 'dark' : 'light');
}

/**
 * Theme preference, persisted in chrome.storage.sync so it follows the user
 * across their Chrome profile. `'system'` keeps tracking the OS setting live.
 */
export function useTheme() {
  const theme = ref<ThemeMode>(DEFAULT_THEME);

  chrome.storage.sync.get({ [THEME_STORAGE_KEY]: DEFAULT_THEME }, (stored) => {
    theme.value = (stored[THEME_STORAGE_KEY] as ThemeMode) ?? DEFAULT_THEME;
    applyTheme(theme.value);
  });

  const onSystemChange = () => {
    if (theme.value === 'system') applyTheme('system');
  };
  darkQuery.addEventListener('change', onSystemChange);
  onScopeDispose(() => darkQuery.removeEventListener('change', onSystemChange));

  function setTheme(mode: ThemeMode) {
    if (theme.value === mode) return;
    theme.value = mode;
    applyTheme(mode);
    chrome.storage.sync.set({ [THEME_STORAGE_KEY]: mode });
  }

  return { theme, setTheme };
}
