<script setup lang="ts">
import { Label } from '@/components/ui/label';

defineProps<{
  label: string;
  description?: string;
  for?: string;
  muted?: boolean;
}>();
</script>

<template>
  <div
    class="flex items-center justify-between gap-3 transition-opacity"
    :class="muted && 'pointer-events-none opacity-50'"
  >
    <div class="min-w-0 space-y-0.5">
      <Label :for="$props.for" class="text-xs font-medium">{{ label }}</Label>
      <p v-if="description" class="text-muted-foreground text-[0.7rem] leading-snug">
        {{ description }}
      </p>
    </div>
    <div class="shrink-0">
      <slot />
    </div>
  </div>
</template>
