<script setup lang="ts">
import { computed } from 'vue';
import { CircleAlert, CircleCheck, Loader2 } from '@lucide/vue';

import { Progress } from '@/components/ui/progress';
import type { Job } from '@/composables/useJobs';

const props = defineProps<{ job: Job }>();

const meta = computed(() => {
  if (props.job.status === 'translating') return `${props.job.pct}%`;
  if (props.job.status === 'done') return props.job.cues ? `${props.job.cues} рядків` : 'Готово';
  return 'Помилка';
});

const detail = computed(() =>
  props.job.status === 'error'
    ? props.job.error || 'Не вдалося перекласти'
    : props.job.tabTitle || '—'
);
</script>

<template>
  <div
    class="bg-muted/50 animate-in fade-in slide-in-from-top-1 rounded-md p-2 duration-200"
  >
    <div class="flex items-center gap-2">
      <Loader2
        v-if="job.status === 'translating'"
        class="text-muted-foreground size-3 shrink-0 animate-spin"
      />
      <CircleCheck
        v-else-if="job.status === 'done'"
        class="size-3 shrink-0 text-emerald-600 dark:text-emerald-500"
      />
      <CircleAlert v-else class="text-destructive size-3 shrink-0" />

      <span class="min-w-0 flex-1 truncate text-xs font-medium" :title="job.name">
        {{ job.name }}
      </span>

      <span
        class="shrink-0 text-xs font-medium tabular-nums"
        :class="{
          'text-muted-foreground': job.status === 'translating',
          'text-emerald-600 dark:text-emerald-500': job.status === 'done',
          'text-destructive': job.status === 'error',
        }"
      >
        {{ meta }}
      </span>
    </div>

    <p
      class="mt-0.5 truncate text-[0.7rem]"
      :class="job.status === 'error' ? 'text-destructive/80' : 'text-muted-foreground'"
      :title="detail"
    >
      {{ detail }}
    </p>

    <Progress v-if="job.status === 'translating'" :model-value="job.pct" class="mt-2 h-1" />
  </div>
</template>
