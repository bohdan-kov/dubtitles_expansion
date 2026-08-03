<script setup lang="ts">
import { computed } from 'vue';
import {
  Captions,
  Download,
  Gauge,
  Languages,
  Loader2,
  MicVocal,
  Rows3,
  ServerCog,
  Trash2,
  Volume2,
} from '@lucide/vue';

import JobItem from '@/components/JobItem.vue';
import SettingRow from '@/components/SettingRow.vue';
import ThemeToggle from '@/components/ThemeToggle.vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { useJobs } from '@/composables/useJobs';
import { useServerHealth } from '@/composables/useServerHealth';
import { useSettings } from '@/composables/useSettings';
import { useTheme } from '@/composables/useTheme';
import type { SubtitleLayout, SubtitleMode } from '@/shared/types';
import { SERVER_ORIGIN } from '@/shared/types';

const SERVER_HEALTH = `${SERVER_ORIGIN}/health`;

const MODE_OPTIONS = [
  { value: 'ua', label: 'Лише UA' },
  { value: 'bilingual', label: 'EN + UA' },
] as const;

const LAYOUT_OPTIONS = [
  { value: 'triple', label: '3 рівні' },
  { value: 'single', label: '1 рядок' },
] as const;

const VOICE_OPTIONS = [
  { value: 'uk-UA-OstapNeural', label: 'Остап (чол.)' },
  { value: 'uk-UA-PolinaNeural', label: 'Поліна (жін.)' },
] as const;

const SPEED_OPTIONS = [
  { value: 'auto', label: 'Авто' },
  { value: '0.75', label: '0.75×' },
  { value: '1', label: '1×' },
  { value: '1.25', label: '1.25×' },
  { value: '1.5', label: '1.5×' },
  { value: '1.75', label: '1.75×' },
  { value: '2', label: '2×' },
] as const;

const { settings, update } = useSettings();
const { state: health, check: recheckServer } = useServerHealth(SERVER_HEALTH);
const { jobs, activeCount, hasFinished, clearFinished } = useJobs();
const { theme, setTheme } = useTheme();

const version = chrome.runtime.getManifest().version;
const serverLabel = SERVER_ORIGIN.replace(/^https?:\/\//, '').replace('127.0.0.1', 'localhost');

const healthLabel = computed(
  () => ({ checking: 'перевірка', online: 'онлайн', offline: 'офлайн' })[health.value]
);

// Give the list a fixed height only once it can actually overflow — a short
// list should hug its content instead of leaving a hole in the popup.
const jobsListClass = computed(() => (jobs.value.length > 3 ? 'h-[168px]' : ''));
</script>

<template>
  <div class="bg-background text-foreground w-[360px] antialiased">
    <header class="flex items-start gap-2.5 px-3.5 pt-3.5 pb-2.5">
      <div
        class="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg shadow-sm"
      >
        <Languages class="size-4" />
      </div>

      <div class="min-w-0 flex-1">
        <h1 class="truncate text-sm leading-tight font-semibold">Dubtitles</h1>
        <p class="text-muted-foreground text-[0.7rem] leading-snug">
          Субтитри та озвучення відеокурсів
        </p>
      </div>

      <div class="flex shrink-0 items-center gap-1">
        <Badge
          as="button"
          type="button"
          :variant="health === 'offline' ? 'destructive' : 'secondary'"
          class="cursor-pointer px-1.5 py-0 text-[0.65rem] select-none"
          title="Локальний сервер перекладу — натисніть, щоб перевірити ще раз"
          @click="recheckServer(true)"
        >
          <Loader2 v-if="health === 'checking'" class="size-2.5 animate-spin" />
          <span v-else-if="health === 'online'" class="size-1.5 rounded-full bg-emerald-500" />
          {{ healthLabel }}
        </Badge>

        <ThemeToggle :model-value="theme" @update:model-value="setTheme" />
      </div>
    </header>

    <Separator />

    <!-- ── Subtitles ───────────────────────────────────────────────────── -->
    <section class="space-y-2.5 px-3.5 py-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="flex items-center gap-1.5 text-[0.8125rem] font-semibold">
            <Captions class="text-muted-foreground size-3.5" />
            Субтитри
          </h2>
          <p class="text-muted-foreground text-[0.7rem] leading-snug">
            Переклад поверх плеєра в реальному часі
          </p>
        </div>
        <Switch
          :model-value="settings.enabled"
          aria-label="Увімкнути субтитри"
          @update:model-value="(v) => update('enabled', v)"
        />
      </div>

      <SettingRow label="Режим" description="Мова рядків" :muted="!settings.enabled">
        <Select
          :model-value="settings.mode"
          :disabled="!settings.enabled"
          @update:model-value="(v) => update('mode', v as SubtitleMode)"
        >
          <SelectTrigger size="sm" class="w-[124px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in MODE_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow
        label="Відображення"
        description="Скільки реплік видно"
        :muted="!settings.enabled"
      >
        <Select
          :model-value="settings.layout"
          :disabled="!settings.enabled"
          @update:model-value="(v) => update('layout', v as SubtitleLayout)"
        >
          <SelectTrigger size="sm" class="w-[130px] text-xs">
            <Rows3 class="text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in LAYOUT_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
    </section>

    <Separator />

    <!-- ── Voice-over ──────────────────────────────────────────────────── -->
    <section class="space-y-2.5 px-3.5 py-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="flex items-center gap-1.5 text-[0.8125rem] font-semibold">
            <Volume2 class="text-muted-foreground size-3.5" />
            Озвучення
          </h2>
          <p class="text-muted-foreground text-[0.7rem] leading-snug">
            Нейронна озвучка Microsoft Edge
          </p>
        </div>
        <Switch
          :model-value="settings.dub"
          aria-label="Увімкнути озвучення"
          @update:model-value="(v) => update('dub', v)"
        />
      </div>

      <SettingRow label="Голос" :muted="!settings.dub">
        <Select
          :model-value="settings.voice"
          :disabled="!settings.dub"
          @update:model-value="(v) => update('voice', v as string)"
        >
          <SelectTrigger size="sm" class="w-[152px] text-xs">
            <MicVocal class="text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in VOICE_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow label="Швидкість" :muted="!settings.dub">
        <Select
          :model-value="settings.dubSpeed"
          :disabled="!settings.dub"
          @update:model-value="(v) => update('dubSpeed', v as string)"
        >
          <SelectTrigger size="sm" class="w-[106px] text-xs">
            <Gauge class="text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="option in SPEED_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      <p class="text-muted-foreground text-[0.7rem] leading-snug">
        Оригінал приглушується під час реплік. «Авто» підлаштовує темп під тривалість репліки.
      </p>
    </section>

    <Separator />

    <!-- ── Download queue ──────────────────────────────────────────────── -->
    <section class="space-y-2 px-3.5 py-3">
      <div class="flex items-center justify-between gap-3">
        <h2 class="flex items-center gap-1.5 text-[0.8125rem] font-semibold">
          <Download class="text-muted-foreground size-3.5" />
          Завантаження
          <Badge v-if="activeCount" variant="secondary" class="px-1.5 py-0 text-[0.65rem]">
            {{ activeCount }}
          </Badge>
        </h2>
        <Button
          v-if="hasFinished"
          variant="ghost"
          size="xs"
          class="text-muted-foreground hover:text-foreground -mr-1.5 text-[0.7rem]"
          @click="clearFinished"
        >
          <Trash2 />
          Очистити
        </Button>
      </div>

      <ScrollArea v-if="jobs.length" :class="jobsListClass">
        <div class="flex flex-col gap-1.5 pr-2.5">
          <JobItem v-for="job in jobs" :key="job.url" :job="job" />
        </div>
      </ScrollArea>
      <p v-else class="text-muted-foreground py-3 text-center text-xs">
        Немає активних завантажень
      </p>
    </section>

    <Separator />

    <footer
      class="text-muted-foreground flex items-center justify-between px-3.5 py-2 text-[0.7rem]"
    >
      <span class="inline-flex items-center gap-1.5">
        <ServerCog class="size-3" />
        {{ serverLabel }}
      </span>
      <span class="tabular-nums">v{{ version }}</span>
    </footer>
  </div>
</template>
