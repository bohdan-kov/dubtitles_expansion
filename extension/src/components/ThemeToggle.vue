<script setup lang="ts">
import { computed } from 'vue';
import { Check, Monitor, Moon, Sun } from '@lucide/vue';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ThemeMode } from '@/shared/theme';

const props = defineProps<{ modelValue: ThemeMode }>();
const emit = defineEmits<{ 'update:modelValue': [ThemeMode] }>();

const OPTIONS = [
  { value: 'light', label: 'Світла', icon: Sun },
  { value: 'dark', label: 'Темна', icon: Moon },
  { value: 'system', label: 'Системна', icon: Monitor },
] as const satisfies ReadonlyArray<{ value: ThemeMode; label: string; icon: unknown }>;

const current = computed(
  () => OPTIONS.find((option) => option.value === props.modelValue) ?? OPTIONS[2]
);
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-muted-foreground hover:text-foreground"
        :title="`Тема: ${current.label.toLowerCase()}`"
        aria-label="Тема оформлення"
      >
        <component :is="current.icon" />
      </Button>
    </DropdownMenuTrigger>

    <DropdownMenuContent align="end" class="min-w-[132px]">
      <DropdownMenuItem
        v-for="option in OPTIONS"
        :key="option.value"
        class="text-xs"
        @click="emit('update:modelValue', option.value)"
      >
        <component :is="option.icon" class="text-muted-foreground" />
        {{ option.label }}
        <Check v-if="option.value === modelValue" class="ml-auto size-3.5" />
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
