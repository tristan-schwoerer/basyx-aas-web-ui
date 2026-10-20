import type { AimcMapping, AimcMappingKind } from '../types'

export const kindLabels: Record<AimcMappingKind, string> = {
  'data': 'data',
  'delegated-action': 'operation',
}

export const kindIcons: Record<AimcMappingKind, string> = {
  'data': 'mdi-arrow-right-bold-box',
  'delegated-action': 'mdi-swap-horizontal-bold',
}

/** `3 sources → PackMLState`-style summary of a route. */
export function routeSubtitle (route: AimcMapping): string {
  const sources = route.sources.length === 1
    ? route.sources[0]!.sourceId || 'source'
    : `${route.sources.length} sources`
  const sinks = route.sinks.length === 1
    ? route.sinks[0]!.sinkId || 'sink'
    : `${route.sinks.length} sinks`
  return `${kindLabels[route.kind]} · ${sources} → ${sinks}`
}
