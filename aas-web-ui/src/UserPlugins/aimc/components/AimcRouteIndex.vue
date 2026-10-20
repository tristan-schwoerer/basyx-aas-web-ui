<template>
  <v-card class="mb-4">
    <v-toolbar color="cardHeader" density="compact">
      <v-tabs v-model="tab" density="compact">
        <v-tab value="routes">Routes ({{ routes.length }})</v-tab>
        <v-tab value="endpoints">Endpoints</v-tab>
      </v-tabs>

      <v-spacer />

      <AimcDmpHealthChip
        v-if="dmpStatus"
        :loading="dmpLoading"
        :status="dmpStatus"
        @refresh="emit('refresh-dmp')"
      />
    </v-toolbar>

    <v-divider />

    <v-window v-model="tab">
      <v-window-item value="routes">
        <v-list density="compact">
          <v-list-subheader>Select a route to visualize its flow</v-list-subheader>

          <v-list-item
            v-for="route in routes"
            :key="route.id"
            :subtitle="routeSubtitle(route)"
            :title="route.name"
            @click="emit('focus', route.id)"
          >
            <template #prepend>
              <v-icon density="compact" size="small">{{ kindIcons[route.kind] }}</v-icon>
            </template>

            <template #append>
              <div class="d-flex align-center ga-2">
                <AimcDmpStatusChip :status="routeStatus(route)" />

                <v-chip
                  density="compact"
                  label
                  size="x-small"
                  variant="tonal"
                >
                  {{ kindLabels[route.kind] }}
                </v-chip>

                <v-chip
                  v-if="route.bidirectional"
                  color="secondary"
                  density="compact"
                  label
                  size="x-small"
                  variant="tonal"
                >
                  <v-icon density="compact" size="x-small">mdi-swap-horizontal</v-icon>
                  request / reply
                </v-chip>

                <v-icon density="compact" size="small">mdi-chevron-right</v-icon>
              </div>
            </template>
          </v-list-item>
        </v-list>
      </v-window-item>

      <v-window-item value="endpoints">
        <AimcEndpointIndex :routes="routes" @focus="routeId => emit('focus', routeId)" />
      </v-window-item>
    </v-window>
  </v-card>
</template>

<script lang="ts" setup>
  /**
   * The way into an AIMC: its routes (with their DMP deployment state) and,
   * on a second tab, the endpoints they read and write.
   */
  import type { DmpRouteStatus, DmpStatus } from '../composables/dmpStatus'
  import type { AimcMapping } from '../types'
  import { kindIcons, kindLabels, routeSubtitle } from '../composables/routeLabels'
  import AimcDmpHealthChip from './AimcDmpHealthChip.vue'
  import AimcDmpStatusChip from './AimcDmpStatusChip.vue'
  import AimcEndpointIndex from './AimcEndpointIndex.vue'

  const props = defineProps<{
    routes: AimcMapping[]
    /** `undefined` while the DMP status feature is off or not loaded yet. */
    dmpStatus?: DmpStatus
    dmpLoading?: boolean
  }>()

  const emit = defineEmits<{
    'focus': [routeId: string]
    'refresh-dmp': []
  }>()

  const tab = ref<'routes' | 'endpoints'>('routes')

  function routeStatus (route: AimcMapping): DmpRouteStatus | undefined {
    return props.dmpStatus?.available && props.dmpStatus.managesAimc
      ? props.dmpStatus.routes.get(route.identity)
      : undefined
  }
</script>
