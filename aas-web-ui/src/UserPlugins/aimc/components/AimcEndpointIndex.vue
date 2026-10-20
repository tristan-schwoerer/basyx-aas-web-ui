<template>
  <div>
    <div class="pa-3 pb-1">
      <v-text-field
        v-model="filter"
        clearable
        density="compact"
        hide-details
        placeholder="Filter by endpoint, interface or route"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
      />
    </div>

    <v-table density="compact">
      <thead>
        <tr>
          <th>Endpoint</th>
          <th>Read by</th>
          <th>Written by</th>
        </tr>
      </thead>

      <tbody>
        <template v-for="section in sections" :key="section.origin">
          <tr class="aimc-index__origin">
            <td class="text-caption font-weight-bold" colspan="3">{{ section.origin }}</td>
          </tr>

          <tr v-for="entry in section.entries" :key="entry.key">
            <td>
              <div class="d-flex align-center ga-2">
                <v-icon density="compact" size="small">{{ kindIcons[entry.kind] }}</v-icon>
                <span class="text-body-2">{{ entry.label }}</span>

                <v-chip
                  v-if="entry.group"
                  density="compact"
                  label
                  size="x-small"
                  variant="tonal"
                >
                  {{ entry.group }}
                </v-chip>
              </div>
            </td>

            <td v-for="role in roles" :key="role">
              <div class="d-flex flex-wrap ga-1 py-1">
                <v-chip
                  v-for="use in entry[role]"
                  :key="`${use.routeId}-${use.endpointId}-${use.phase}`"
                  :color="use.phase === 'response' ? 'secondary' : undefined"
                  density="compact"
                  label
                  size="x-small"
                  :title="`${use.routeName}: ${use.endpointId}${use.phase === 'response' ? ' (response)' : ''}`"
                  variant="tonal"
                  @click="emit('focus', use.routeId)"
                >
                  {{ use.routeName }}
                </v-chip>

                <span v-if="entry[role].length === 0" class="text-caption opacity-50">—</span>
              </div>
            </td>
          </tr>
        </template>

        <tr v-if="sections.length === 0">
          <td class="text-caption opacity-70" colspan="3">No endpoint matches.</td>
        </tr>
      </tbody>
    </v-table>
  </div>
</template>

<script lang="ts" setup>
  /**
   * Every affordance and AAS element the AIMC references, grouped by where it
   * lives, with the routes reading and writing it. A route chip opens that
   * route; response-phase uses are tinted.
   */
  import type { AimcEndpointEntry } from '../composables/endpointIndex'
  import type { AimcEndpointKind, AimcMapping } from '../types'
  import { indexEndpoints } from '../composables/endpointIndex'

  const props = defineProps<{
    routes: AimcMapping[]
  }>()

  const emit = defineEmits<{
    focus: [routeId: string]
  }>()

  const filter = ref('')

  const roles = ['readers', 'writers'] as const

  const kindIcons: Record<AimcEndpointKind, string> = {
    'affordance': 'mdi-access-point',
    'operation': 'mdi-play-box-outline',
    'aas-element': 'mdi-database-outline',
    'unknown': 'mdi-help-circle-outline',
  }

  const entries = computed(() => indexEndpoints(props.routes))

  const sections = computed(() => {
    const needle = (filter.value ?? '').trim().toLowerCase()
    const matches = entries.value.filter(entry => needle === ''
      || [entry.origin, entry.label, ...[...entry.readers, ...entry.writers].map(use => use.routeName)]
        .some(text => text.toLowerCase().includes(needle)))
    // `indexEndpoints` sorts by origin, so each origin is one contiguous run.
    const sections: Array<{ origin: string, entries: AimcEndpointEntry[] }> = []
    for (const entry of matches) {
      if (sections.at(-1)?.origin === entry.origin) {
        sections.at(-1)!.entries.push(entry)
      } else {
        sections.push({ origin: entry.origin, entries: [entry] })
      }
    }
    return sections
  })
</script>

<style scoped>
  .aimc-index__origin td {
    background: rgba(128, 128, 128, 0.08);
  }
</style>
