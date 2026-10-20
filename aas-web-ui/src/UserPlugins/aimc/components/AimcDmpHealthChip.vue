<template>
  <div class="d-inline-flex align-center">
    <v-tooltip location="bottom" max-width="360">
      <template #activator="{ props: tooltipProps }">
        <v-chip
          v-bind="tooltipProps"
          class="mr-1"
          :color="health.color"
          density="compact"
          label
          size="small"
          variant="tonal"
        >
          <v-icon density="compact" size="x-small" start>{{ health.icon }}</v-icon>
          DMP: {{ health.text }}
        </v-chip>
      </template>

      <span class="text-body-small">{{ health.detail }}</span>
    </v-tooltip>

    <v-btn
      icon="mdi-refresh"
      :loading="loading"
      size="small"
      title="Refresh the DMP status"
      @click="emit('refresh')"
    />
  </div>
</template>

<script lang="ts" setup>
  /** Whether the DMP is live and ready, and how this AIMC's routes fare in it. */
  import type { DmpStatus } from '../composables/dmpStatus'
  import { describeDmpHealth } from '../composables/dmpStatus'

  const props = defineProps<{
    status: DmpStatus
    loading?: boolean
  }>()

  const emit = defineEmits<{
    refresh: []
  }>()

  const health = computed(() => describeDmpHealth(props.status))
</script>
