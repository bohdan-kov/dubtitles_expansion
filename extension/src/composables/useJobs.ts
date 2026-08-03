import { computed, onScopeDispose, ref } from 'vue';

import type { Job, JobsResponse, RequestMessage } from '@/shared/types';

export type { Job, JobStatus } from '@/shared/types';

/**
 * Mirror the background worker's job map. The worker already sorts (active
 * first, then errors, then finished), so the list is rendered as-is and keyed
 * by URL — Vue patches rows in place instead of rebuilding the list.
 */
export function useJobs(intervalMs = 800) {
  const jobs = ref<Job[]>([]);

  const activeCount = computed(() => jobs.value.filter((j) => j.status === 'translating').length);
  const hasFinished = computed(() => jobs.value.some((j) => j.status !== 'translating'));

  function refresh() {
    const message: RequestMessage = { type: 'GET_JOBS' };
    chrome.runtime.sendMessage(message, (resp?: JobsResponse) => {
      if (chrome.runtime.lastError || !resp) return;
      jobs.value = resp.jobs ?? [];
    });
  }

  function clearFinished() {
    const message: RequestMessage = { type: 'CLEAR_FINISHED_JOBS' };
    chrome.runtime.sendMessage(message, () => {
      if (chrome.runtime.lastError) return;
      refresh();
    });
  }

  refresh();
  const timer = setInterval(refresh, intervalMs);
  onScopeDispose(() => clearInterval(timer));

  return { jobs, activeCount, hasFinished, refresh, clearFinished };
}
