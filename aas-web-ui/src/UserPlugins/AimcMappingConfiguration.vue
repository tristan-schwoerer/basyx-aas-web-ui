<template>
  <v-container class="pa-0" fluid>
    <VisualizationHeader
      border
      default-title="Asset Interfaces Mapping Configuration"
      :submodel-element-data="submodelElementData"
    />

    <v-card v-if="isLoading" class="mb-3">
      <v-progress-linear indeterminate />
    </v-card>

    <template v-else>
      <v-alert
        v-if="warnings.length > 0"
        class="mb-3"
        density="compact"
        type="warning"
        variant="tonal"
      >
        <ul class="ml-4">
          <li
            v-for="warning in warnings"
            :key="warning"
            class="text-body-small"
          >
            {{ warning }}
          </li>
        </ul>
      </v-alert>

      <v-card v-if="routes.length === 0" class="mb-4">
        <v-card-text class="text-body-medium">
          This AIMC submodel declares no routable mapping configuration.
        </v-card-text>
      </v-card>

      <!-- No route selected: the index doubles as the way in. It never renders
           the whole submodel as one flow. -->
      <AimcRouteIndex
        v-else-if="!focusedRoute"
        :dmp-loading="dmpLoading"
        :dmp-status="dmpStatus"
        :routes="routes"
        @focus="focusRouteById"
        @refresh-dmp="refreshDmpStatus"
      />

      <template v-else>
        <!-- Route header: keeps the single route identifiable and lets the user
             step back to the index or to the next route. -->
        <v-toolbar class="mb-3" color="cardHeader" density="compact">
          <v-btn
            icon="mdi-arrow-left"
            size="small"
            @click="focusedRouteId = ''"
          />

          <v-list-item class="mx-2">
            <v-list-item-title>
              <span class="text-subtitle-2 font-weight-bold">{{ focusedRoute.name }}</span>
            </v-list-item-title>

            <v-list-item-subtitle class="text-caption">
              Route {{ focusedRouteIndex + 1 }} of {{ routes.length }}
              · {{ kindLabels[focusedRoute.kind] }}
            </v-list-item-subtitle>
          </v-list-item>

          <v-chip
            v-if="focusedRoute.bidirectional"
            color="secondary"
            density="compact"
            label
            size="small"
            variant="tonal"
          >
            <v-icon density="compact" size="x-small" start>mdi-swap-horizontal</v-icon>
            request / reply
          </v-chip>

          <AimcDmpStatusChip
            class="ml-2"
            :redeploy="focusedRouteRedeploy"
            size="small"
            :status="focusedRouteDmpStatus"
          />

          <v-spacer />

          <AimcDmpHealthChip
            v-if="dmpStatus"
            class="mr-2"
            :loading="dmpLoading"
            :status="dmpStatus"
            @refresh="refreshDmpStatus"
          />

          <v-btn
            :disabled="focusedRouteIndex <= 0"
            icon="mdi-chevron-left"
            size="small"
            @click="stepRoute(-1)"
          />

          <v-btn
            :disabled="focusedRouteIndex >= routes.length - 1"
            icon="mdi-chevron-right"
            size="small"
            @click="stepRoute(1)"
          />
        </v-toolbar>

        <v-alert
          v-if="focusedRouteDmpProblem"
          class="mb-3"
          density="compact"
          :type="focusedRouteDmpStatus?.state === 'stale' || focusedRouteDmpStatus?.state === 'installed' ? 'warning' : 'error'"
          variant="tonal"
        >
          <span class="text-body-small">{{ focusedRouteDmpProblem }}</span>
          <div v-if="focusedRouteDmpCause" class="text-body-small mt-1">{{ focusedRouteDmpCause }}</div>

          <ul v-if="focusedRouteDmpReasons.length > 0" class="text-body-small mt-1 pl-4">
            <li v-for="reason in focusedRouteDmpReasons" :key="reason">{{ reason }}</li>
          </ul>
        </v-alert>

        <AimcMappingGraph
          class="mb-3"
          :diagnostics="focusedRouteDmpDetails?.diagnostics"
          :direction="direction"
          :mapping="focusedRoute"
          @select-direction="selectDirection"
        />

        <!-- Edge legend. -->
        <div class="d-flex flex-wrap align-center ga-4 mb-4 text-body-small">
          <span class="d-inline-flex align-center ga-2">
            <span class="aimc-dash aimc-dash--forward" /> request / data flow
          </span>

          <span v-if="focusedRoute.response.present || focusedRoute.responseSinks.length > 0" class="d-inline-flex align-center ga-2">
            <span class="aimc-dash aimc-dash--reply" /> correlated reply
          </span>

          <span class="d-inline-flex align-center ga-2">
            <span class="aimc-dash aimc-dash--context" /> request sources passed to the response
          </span>

          <v-divider class="my-1" vertical />

          <span class="opacity-70">
            the affordance group (properties / actions / events) is shown per endpoint
          </span>

          <span class="opacity-70">· click a source or sink to reveal its reference</span>
        </div>

        <AimcTransformationEditor
          ref="editor"
          v-model:direction="direction"
          :mapping="focusedRoute"
          @saved="refresh"
        />
      </template>
    </template>
  </v-container>
</template>

<script lang="ts" setup>
  /**
   * BaSyx AAS Web UI plugin for the IDTA AssetInterfacesMappingConfiguration
   * (AIMC) submodel, including the DMP `ResponseTransformation` extension.
   *
   * It visualizes **one route at a time**: a single MappingConfiguration is drawn
   * as a flow from sources (left) through the Lua transformation(s) (middle) to
   * sinks (right), and a bi-directional action contract additionally shows the
   * correlated reply flowing back from the sink through the response
   * transformation to the source. The Lua script of the focused route can be
   * edited and saved back to the Submodel Repository.
   *
   * Which route to show is chosen in the plugin's own route index, not in the
   * tree: a route is an item of the `MappingConfigurations` `SubmodelElementList`,
   * and AASd-114 makes every list item inherit the *list's* semanticId, so a
   * route carries no semanticId of its own. The BaSyx UI can therefore only
   * dispatch a plugin on the AIMC submodel, never on an individual route. The
   * whole submodel is never rendered as a single flow — only the focused route.
   */
  import type { DmpRouteDetails, DmpRouteStatus, DmpStatus } from './aimc/composables/dmpStatus'
  import type { AimcMapping } from './aimc/types'
  import { useSMHandling } from '@/composables/AAS/SMHandling'
  import { useAASStore } from '@/store/AASDataStore'
  import { useEnvStore } from '@/store/EnvironmentStore'
  import AimcDmpHealthChip from './aimc/components/AimcDmpHealthChip.vue'
  import AimcDmpStatusChip from './aimc/components/AimcDmpStatusChip.vue'
  import AimcMappingGraph from './aimc/components/AimcMappingGraph.vue'
  import AimcRouteIndex from './aimc/components/AimcRouteIndex.vue'
  import AimcTransformationEditor from './aimc/components/AimcTransformationEditor.vue'
  import { describeDmpCategory, describeDmpCause, diagnosticEndpoint, fetchDmpMappings, fetchDmpStatus } from './aimc/composables/dmpStatus'
  import { parseAimc } from './aimc/composables/parseAimc'
  import { resolveAimcMapping } from './aimc/composables/resolveAimc'
  import { kindLabels } from './aimc/composables/routeLabels'
  import { AIMC_PLUGIN_SEMANTIC_IDS } from './aimc/types/semanticIds'

  defineOptions({
    name: 'AimcMappingConfiguration',
    semanticId: AIMC_PLUGIN_SEMANTIC_IDS,
  })

  // Stores
  const aasStore = useAASStore()
  const envStore = useEnvStore()

  // Composables
  const { setData, fetchSm, fetchSmById } = useSMHandling()

  // Props
  const props = defineProps({
    submodelElementData: {
      type: Object as any,
      default: () => ({}),
    },
  })

  // State
  const isLoading = ref(false)
  const routes = ref<AimcMapping[]>([])
  const warnings = ref<string[]>([])
  const focusedRouteId = ref('')
  const direction = ref<'request' | 'response'>('request')
  const editor = ref<InstanceType<typeof AimcTransformationEditor>>()
  let visualizationUpdateId = 0
  const submodelCache = new Map<string, Promise<any>>()
  // The DMP's deployment state of each route; `undefined` while the feature is off.
  const dmpStatus = ref<DmpStatus>()
  /** Why each route does or does not run, by identity; fetched only while a route has a problem. */
  const dmpDetails = ref<Map<string, DmpRouteDetails>>()
  const dmpLoading = ref(false)
  const aimcId = ref('')
  let dmpTimer: ReturnType<typeof setInterval> | undefined
  // How often the DMP status is re-read while the plugin is open.
  const DMP_REFRESH_MS = 15_000
  // After a save, the DMP swaps the route within milliseconds and publishes no
  // intermediate state; the plugin polls briefly until the route's generation
  // rises (or its state changes), and flags it if that does not happen.
  const redeploy = ref<{ identity: string, fromGeneration: number, phase: 'pending' | 'stalled' }>()
  let redeployToken = 0
  const REDEPLOY_POLL_MS = 1000
  const REDEPLOY_TIMEOUT_MS = 30_000

  const focusedRoute = computed(() => routes.value.find(route => route.id === focusedRouteId.value))
  const focusedRouteIndex = computed(() => routes.value.findIndex(route => route.id === focusedRouteId.value))

  const focusedRouteRedeploy = computed(() =>
    redeploy.value && redeploy.value.identity === focusedRoute.value?.identity ? redeploy.value.phase : undefined)

  const focusedRouteDmpStatus = computed(() => {
    const status = dmpStatus.value
    return focusedRoute.value && status?.available && status.managesAimc
      ? status.routes.get(focusedRoute.value.identity)
      : undefined
  })

  const focusedRouteDmpDetails = computed(() =>
    focusedRoute.value ? dmpDetails.value?.get(focusedRoute.value.identity) : undefined)

  const focusedRouteDmpCause = computed(() => describeDmpCause(focusedRouteDmpDetails.value?.cause ?? ''))

  /**
   * The DMP's diagnostics of the focused route that concern the route as a
   * whole; those of an endpoint are shown on its node, and counted here.
   */
  const focusedRouteDmpReasons = computed(() => {
    const diagnostics = focusedRouteDmpDetails.value?.diagnostics ?? []
    const general = diagnostics.filter(diagnostic => !diagnosticEndpoint(diagnostic.path))
      .map(diagnostic => diagnostic.path === '' ? diagnostic.message : `${diagnostic.path}: ${diagnostic.message}`)
    const onEndpoints = diagnostics.length - general.length
    return onEndpoints > 0
      ? [...general, `${onEndpoints} more on the marked ${onEndpoints === 1 ? 'endpoint' : 'endpoints'} below.`]
      : general
  })

  /** Why the DMP is not running the focused route as authored, if it is not. */
  const focusedRouteDmpProblem = computed(() => {
    const status = focusedRouteDmpStatus.value
    if (!status) {
      return ''
    }
    if (status.state === 'installed') {
      return status.outdated ? 'The DMP still runs an older version of this route; the current one is being installed.' : ''
    }
    if (status.state === 'not-deployed') {
      return 'The DMP has no entry for this route yet.'
    }
    const prefix = status.state === 'stale'
      ? 'The DMP keeps running the last good version of this route. '
      : ''
    return `${prefix}${describeDmpCategory(status.category) || `DMP state: ${status.state}.`}`
  })

  watch(
    () => props.submodelElementData,
    () => {
      initializeVisualization()
    },
  )

  // A later poll (or a manual refresh) that sees the reinstall clears the flag.
  watch(focusedRouteDmpStatus, status => {
    if (redeploy.value?.phase === 'stalled' && status && status.generation > redeploy.value.fromGeneration) {
      redeploy.value = undefined
    }
  })

  onMounted(() => {
    initializeVisualization()
    dmpTimer = setInterval(() => {
      // Only poll while the tab is visible; the next refresh catches up.
      if (document.visibilityState === 'visible') {
        void refreshDmpStatus()
      }
    }, DMP_REFRESH_MS)
  })

  onBeforeUnmount(() => {
    clearInterval(dmpTimer)
    // Ends a redeploy follow-up still in flight.
    redeployToken++
  })

  /**
   * Parses and resolves the AIMC.
   *
   * @param reload re-read the submodel from the repository instead of using
   * the copy the host handed in when the page opened — needed after the
   * editor saved a blob, or the old script would be shown again.
   */
  async function initializeVisualization (reload = false): Promise<void> {
    const updateId = ++visualizationUpdateId
    if (!props.submodelElementData || Object.keys(props.submodelElementData).length === 0) {
      return
    }

    // A reload after a save runs in the background, so the editor stays
    // mounted (and in edit mode) instead of giving way to the progress bar.
    isLoading.value = !reload
    try {
      // `setData` annotates every element with its repository `path`; the
      // editor needs the blob's path in order to persist an edit.
      // It yields an empty object when there is no path to start from.
      const submodelData = reload && aasStore.getSelectedNode.path
        ? await fetchSm(aasStore.getSelectedNode.path, false, true)
        : await setData(
          { ...props.submodelElementData },
          aasStore.getSelectedNode.path,
          false,
          aasStore.getSelectedNode.timestamp,
        )
      if (updateId !== visualizationUpdateId) return
      if (!submodelData || Object.keys(submodelData).length === 0) {
        routes.value = []
        focusedRouteId.value = ''
        warnings.value = ['The submodel could not be read: the Web UI has no repository path for it yet.']
        return
      }

      const parsed = parseAimc(submodelData)
      aimcId.value = typeof submodelData.id === 'string' ? submodelData.id : ''
      const references = parsed.mappings.flatMap(route => [
        ...route.sources.map(endpoint => endpoint.submodelId),
        ...route.sinks.map(endpoint => endpoint.submodelId),
        ...route.responseSources.map(endpoint => endpoint.submodelId),
        ...route.responseSinks.map(endpoint => endpoint.submodelId),
      ]).filter(Boolean)
      await Promise.all([...new Set(references)].map(id => {
        if (!submodelCache.has(id)) {
          submodelCache.set(id, fetchSmById(id).catch(() => ({})))
        }
        return submodelCache.get(id)
      }))
      if (updateId !== visualizationUpdateId) return
      const loadedSubmodels = new Map<string, any>()
      const fetchedSubmodels = await Promise.all([...new Set(references)].map(async id => [id, await submodelCache.get(id)] as const))
      for (const [id, loaded] of fetchedSubmodels) {
        if (loaded && Object.keys(loaded).length > 0) loadedSubmodels.set(id, loaded)
      }
      routes.value = parsed.mappings.map(route => resolveAimcMapping(route, loadedSubmodels))
      void refreshDmpStatus()
      warnings.value = [
        ...parsed.warnings,
        ...routes.value.flatMap(route => (route.warnings ?? []).map(message => `${route.name}: ${message}`)),
      ]
      // Keep the focused route while it still exists in the submodel.
      if (routes.value.some(route => route.id === focusedRouteId.value)) {
        return
      }
      focusedRouteId.value = ''
    } catch (error) {
      if (updateId !== visualizationUpdateId) return
      routes.value = []
      focusedRouteId.value = ''
      warnings.value = [`Unable to read this submodel: ${error instanceof Error ? error.message : String(error)}`]
    } finally {
      if (updateId === visualizationUpdateId) {
        isLoading.value = false
      }
    }
  }

  /** After a saved edit: show what the repository now holds, and follow the DMP's redeploy. */
  async function refresh (): Promise<void> {
    const identity = focusedRoute.value?.identity
    const before = focusedRouteDmpStatus.value
    await initializeVisualization(true)
    if (identity && before) {
      void followRedeploy(identity, before)
    }
  }

  /**
   * Polls the DMP until the saved route is reinstalled — its generation rises —
   * or its state changes (e.g. to `stale` when the new script does not
   * compile). Marks the route `stalled` if neither happens in time.
   */
  async function followRedeploy (identity: string, before: DmpRouteStatus): Promise<void> {
    const token = ++redeployToken
    redeploy.value = { identity, fromGeneration: before.generation, phase: 'pending' }
    const deadline = Date.now() + REDEPLOY_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, REDEPLOY_POLL_MS))
      if (token !== redeployToken) {
        return
      }
      await refreshDmpStatus()
      const status = dmpStatus.value?.available ? dmpStatus.value.routes.get(identity) : undefined
      if (status && (status.generation > before.generation || status.state !== before.state || status.category !== before.category)) {
        redeploy.value = undefined
        return
      }
    }
    if (token === redeployToken) {
      redeploy.value = { identity, fromGeneration: before.generation, phase: 'stalled' }
    }
  }

  /** Re-reads the DMP's deployment state of this AIMC's routes. */
  async function refreshDmpStatus (): Promise<void> {
    if (aimcId.value === '' || routes.value.length === 0 || dmpLoading.value) {
      return
    }
    dmpLoading.value = true
    try {
      const basePath = envStore.getEnvBasePath.trim()
      const prefix = basePath === '' || basePath.includes('PLACEHOLDER') ? '/' : basePath.replace(/\/?$/, '/')
      const status = await fetchDmpStatus(`${prefix}api/dmp/status`, aimcId.value, routes.value.map(route => route.identity))
      dmpStatus.value = status
      const troubled = status?.available && [...status.routes.values()].some(route => route.state !== 'installed' || route.outdated)
      dmpDetails.value = troubled ? await fetchDmpMappings(`${prefix}api/dmp/mappings`, aimcId.value) : undefined
    } finally {
      dmpLoading.value = false
    }
  }

  function focusRouteById (routeId: string): void {
    const route = routes.value.find(candidate => candidate.id === routeId)
    if (route) {
      focusRoute(route)
    }
  }

  function focusRoute (route: AimcMapping): void {
    focusedRouteId.value = route.id
    direction.value = 'request'
  }

  function stepRoute (offset: number): void {
    const next = routes.value[focusedRouteIndex.value + offset]
    if (next) {
      focusRoute(next)
    }
  }

  function selectDirection (next: 'request' | 'response'): void {
    direction.value = next
    void editor.value?.reveal()
  }
</script>

<style scoped>
  .aimc-dash {
    display: inline-block;
    width: 26px;
    height: 0;
    border-top: 2px dashed currentColor;
  }

  .aimc-dash--reply {
    border-top-style: dotted;
    opacity: 0.7;
  }

  .aimc-dash--context {
    border-top-style: dotted;
    border-top-width: 1px;
    opacity: 0.8;
  }
</style>
