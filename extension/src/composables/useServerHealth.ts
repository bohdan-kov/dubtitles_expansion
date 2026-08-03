import { onScopeDispose, ref } from 'vue';

export type HealthState = 'checking' | 'online' | 'offline';

/** Poll the local translation server so the popup can show a live status. */
export function useServerHealth(url: string, intervalMs = 5000) {
  const state = ref<HealthState>('checking');

  async function check(showChecking = false) {
    if (showChecking) state.value = 'checking';
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
      state.value = resp.ok ? 'online' : 'offline';
    } catch {
      state.value = 'offline';
    }
  }

  check();
  const timer = setInterval(() => check(), intervalMs);
  onScopeDispose(() => clearInterval(timer));

  return { state, check };
}
