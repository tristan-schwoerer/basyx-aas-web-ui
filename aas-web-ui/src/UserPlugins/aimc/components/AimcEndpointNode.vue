<template>
  <div
    class="aimc-node aimc-node--endpoint"
    :class="[
      `aimc-node--${data.deliveryKind}`,
      { 'aimc-node--expanded': expanded, 'aimc-node--problem': (data.problems ?? []).length > 0 },
    ]"
  >
    <!-- Every edge meets this node on the transformation side (the request
         leaves a source / enters a sink, a reply comes back the other way).
         Only the connected points are drawn, evenly spaced. -->
    <Handle
      v-for="handle in handles"
      :id="handle.id"
      :key="handle.id"
      class="aimc-handle"
      :class="handle.outgoing ? 'aimc-handle--out' : 'aimc-handle--in'"
      :position="flowSide"
      :style="{ top: handle.top }"
      :type="handle.outgoing ? 'source' : 'target'"
    />

    <div class="aimc-node__header">
      <v-icon density="compact" size="small">{{ icon }}</v-icon>
      <span class="text-body-2 font-weight-bold">{{ data.label }}</span>
    </div>

    <div class="aimc-node__meta">
      <v-chip
        v-for="badge in data.badges"
        :key="badge.text"
        :color="badge.color"
        density="compact"
        label
        size="x-small"
        variant="tonal"
      >
        {{ badge.text }}
      </v-chip>
    </div>

    <div v-if="data.member" class="aimc-node__path">{{ data.member }}</div>

    <ul v-if="data.problems?.length" class="aimc-node__problems text-error">
      <li v-for="problem in data.problems" :key="problem">{{ problem }}</li>
    </ul>

    <div v-if="expanded" class="aimc-node__detail">
      <div class="aimc-node__detail-label">reference</div>

      <ol class="aimc-node__keys">
        <li
          v-for="(key, index) in data.keys"
          :key="index"
          class="aimc-node__key"
        >
          <span class="aimc-node__key-type">{{ key.type || 'Key' }}</span>
          <span class="aimc-node__key-value">{{ key.value }}</span>
        </li>
      </ol>
    </div>
  </div>
</template>

<script lang="ts" setup>
  /**
   * A source or sink of an AIMC route, as a Vue Flow node. Clicking it (handled
   * by the graph) expands the raw reference keys.
   */
  import type { AimcEndpointKind, AimcReferenceKey } from '../types'
  import { Handle, Position } from '@vue-flow/core'
  import { handleShare } from '../composables/layoutAimcGraph'

  export interface AimcEndpointNodeData {
    nodeId: string
    role: 'source' | 'sink'
    label: string
    kind: AimcEndpointKind
    deliveryKind: string
    badges: Array<{ text: string, color?: string }>
    member?: string
    keys: AimcReferenceKey[]
    /** Why the DMP does not run this endpoint as authored (its diagnostics). */
    problems?: string[]
    /** The connected points, top to bottom: the request (`forward`) and/or the `reply`. */
    handles: Array<'forward' | 'reply'>
  }

  const props = defineProps<{
    data: AimcEndpointNodeData
    expanded: boolean
  }>()

  const isSource = computed(() => props.data.role === 'source')

  // A share of the height, so the points stay evenly spaced when the node is
  // expanded to show its reference. The request leaves a source and enters a
  // sink; a reply goes the other way.
  const handles = computed(() => props.data.handles.map((id, rank, all) => ({
    id,
    outgoing: (id === 'forward') === isSource.value,
    top: `${handleShare(rank, all.length) * 100}%`,
  })))
  const flowSide = computed(() => (isSource.value ? Position.Right : Position.Left))

  const icon = computed(() => {
    const icons: Record<AimcEndpointKind, string> = {
      'affordance': isSource.value ? 'mdi-broadcast' : 'mdi-access-point',
      'operation': 'mdi-play-box-outline',
      'aas-element': 'mdi-database-outline',
      'unknown': 'mdi-help-circle-outline',
    }
    return icons[props.data.kind] ?? icons.unknown
  })
</script>

<style scoped>
  .aimc-node {
    border-radius: 14px;
    border: 1px solid rgba(128, 128, 128, 0.5);
    background: rgb(var(--v-theme-surface));
    padding: 6px 10px;
    width: 250px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  }

  .aimc-node--expanded {
    z-index: 5;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.24);
  }

  /* Delivery mode tints the left accent of a source node. */
  .aimc-node--polling {
    border-left: 3px solid rgb(var(--v-theme-info));
  }

  .aimc-node--pushed {
    border-left: 3px solid rgb(var(--v-theme-success));
  }

  .aimc-node--problem {
    border-color: rgb(var(--v-theme-error));
  }

  .aimc-node__problems {
    margin: 4px 0 0;
    padding-left: 16px;
    font-size: 0.75rem;
    overflow-wrap: anywhere;
  }

  .aimc-node--response {
    border-style: dashed;
    border-color: rgb(var(--v-theme-secondary));
  }

  /* Input and output connection points, split vertically on the flow side. */
  .aimc-handle {
    border: 2px solid rgb(var(--v-theme-surface));
  }

  .aimc-handle--in {
    background: rgb(var(--v-theme-secondary));
  }

  .aimc-handle--out {
    background: rgb(var(--v-theme-primary));
  }

  .aimc-node__header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .aimc-node__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }

  .aimc-node__path {
    margin-top: 4px;
    font-family: monospace;
    font-size: 11px;
    opacity: 0.7;
    overflow-wrap: anywhere;
  }

  .aimc-node__detail {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px dashed rgba(128, 128, 128, 0.4);
  }

  .aimc-node__detail-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.6;
    margin-bottom: 2px;
  }

  .aimc-node__keys {
    list-style: none;
    margin: 0;
    padding: 0;
    font-family: monospace;
    font-size: 11px;
  }

  .aimc-node__key {
    display: flex;
    flex-direction: column;
    padding: 2px 0;
    border-bottom: 1px dotted rgba(128, 128, 128, 0.25);
    word-break: break-all;
  }

  .aimc-node__key:last-child {
    border-bottom: none;
  }

  .aimc-node__key-type {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.55;
  }
</style>
