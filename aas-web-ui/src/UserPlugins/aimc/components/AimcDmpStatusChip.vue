<template>
  <v-tooltip v-if="status" location="top" max-width="360">
    <template #activator="{ props: tooltipProps }">
      <v-chip
        v-bind="tooltipProps"
        :color="presentation.color"
        density="compact"
        label
        :size="size"
        variant="tonal"
      >
        <v-icon density="compact" size="x-small" start>{{ presentation.icon }}</v-icon>
        {{ presentation.text }}
      </v-chip>
    </template>

    <div class="text-body-small">
      <div class="font-weight-bold">{{ presentation.title }}</div>
      <div v-if="explanation">{{ explanation }}</div>
      <div v-if="status.outdated">The DMP still runs an older version of this route.</div>
      <div v-if="status.category" class="opacity-70 mt-1">category: {{ status.category }}</div>
      <div v-if="status.revision" class="opacity-70">revision {{ status.revision }}: installed {{ status.revision === 1 ? 'once' : `${status.revision} times` }} since the DMP started</div>
    </div>
  </v-tooltip>
</template>

<script lang="ts" setup>
  /** The DMP's deployment state of one route, with the reason in a tooltip. */
  import type { DmpRouteState, DmpRouteStatus } from '../composables/dmpStatus'
  import { describeDmpCategory } from '../composables/dmpStatus'

  const props = withDefaults(defineProps<{
    status?: DmpRouteStatus
    size?: string
    /**
     * After a save: `pending` while waiting for the DMP to reinstall the
     * route, `stalled` when it has not done so in time.
     */
    redeploy?: 'pending' | 'stalled'
  }>(), {
    status: undefined,
    size: 'x-small',
    redeploy: undefined,
  })

  const presentations: Record<DmpRouteState, { text: string, title: string, color: string, icon: string }> = {
    'installed': { text: 'running', title: 'Compiled and running in the DMP.', color: 'success', icon: 'mdi-check-circle-outline' },
    'blocked': { text: 'blocked', title: 'Not running: the DMP could not compile this route.', color: 'error', icon: 'mdi-cancel' },
    'stale': { text: 'stale', title: 'The DMP keeps running the last good version; the current one could not be compiled.', color: 'warning', icon: 'mdi-history' },
    'failed': { text: 'failed', title: 'The DMP failed to install this route.', color: 'error', icon: 'mdi-alert-circle-outline' },
    'removed': { text: 'removed', title: 'The DMP has removed this route.', color: 'grey', icon: 'mdi-minus-circle-outline' },
    'not-deployed': { text: 'not deployed', title: 'The DMP has no entry for this route.', color: 'grey', icon: 'mdi-help-circle-outline' },
  }

  const presentation = computed(() => {
    if (props.redeploy === 'pending') {
      return { text: 'redeploying…', title: 'Saved; waiting for the DMP to reinstall this route.', color: 'info', icon: 'mdi-sync' }
    }
    if (props.redeploy === 'stalled') {
      return {
        text: 'not redeployed',
        title: 'The DMP has not reinstalled this route since the save; it may have missed the repository event. Refresh the DMP status, or check the DMP log.',
        color: 'warning',
        icon: 'mdi-sync-alert',
      }
    }
    const base = presentations[props.status?.state ?? 'not-deployed']
    // An installed route that lags behind the repository is worth a warning.
    return props.status?.state === 'installed' && props.status.outdated
      ? { ...base, text: 'running (old)', color: 'warning' }
      : base
  })

  const explanation = computed(() => describeDmpCategory(props.status?.category ?? ''))
</script>
