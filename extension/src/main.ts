import { createApp } from 'vue';

import App from './App.vue';
import { applyTheme } from './composables/useTheme';
import type { ThemeMode } from './shared/theme';
import { DEFAULT_THEME, THEME_STORAGE_KEY } from './shared/theme';
import './styles/globals.css';

// Paint the persisted theme before the first frame so the popup never flashes
// the wrong palette; useTheme keeps it in sync from here on.
chrome.storage.sync.get({ [THEME_STORAGE_KEY]: DEFAULT_THEME }, (stored) => {
  applyTheme((stored[THEME_STORAGE_KEY] as ThemeMode) ?? DEFAULT_THEME);
  createApp(App).mount('#app');
});
