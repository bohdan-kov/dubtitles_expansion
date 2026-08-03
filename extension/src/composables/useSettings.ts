import { reactive, ref } from 'vue';

import type { Settings, SettingsMessage } from '@/shared/types';
import { DEFAULT_SETTINGS } from '@/shared/types';

export type { Settings, SubtitleLayout, SubtitleMode } from '@/shared/types';
export { DEFAULT_SETTINGS } from '@/shared/types';

/**
 * Settings live in chrome.storage.sync; every change is also pushed to the
 * active tab so the overlay reacts without a reload.
 */
export function useSettings() {
  const settings = reactive<Settings>({ ...DEFAULT_SETTINGS });
  const loaded = ref(false);

  chrome.storage.sync.get({ ...DEFAULT_SETTINGS } as Record<string, unknown>, (stored) => {
    Object.assign(settings, stored as Partial<Settings>);
    loaded.value = true;
  });

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    if (settings[key] === value) return;
    settings[key] = value;

    const patch = { [key]: value } as Partial<Settings>;
    chrome.storage.sync.set(patch);
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id) {
        const message: SettingsMessage = { type: 'SETTINGS', ...patch };
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    });
  }

  return { settings, loaded, update };
}
