/**
 * The endpoint view of an AIMC: every affordance and AAS element its routes
 * reference, with the routes that read it and the routes that write it.
 * Answers "what touches PackMLState?" without opening every route.
 */
import type { AimcEndpointKind, AimcMapping, AimcReferenceKey, AimcResolvedEndpoint } from '../types'

export interface AimcEndpointUse {
  routeId: string
  routeName: string
  /** The SourceId / SinkId the route uses for it. */
  endpointId: string
  /** `response` for a ResponseSource / ResponseSink. */
  phase: 'request' | 'response'
}

export interface AimcEndpointEntry {
  key: string
  /** Where it lives: the submodel, plus the interface for an affordance. */
  origin: string
  label: string
  kind: AimcEndpointKind
  /** `properties` / `actions` / `events` for an affordance. */
  group?: string
  readers: AimcEndpointUse[]
  writers: AimcEndpointUse[]
}

interface Referenced {
  keys: AimcReferenceKey[]
  submodelId: string
  resolved?: AimcResolvedEndpoint
  protocol?: string
}

/** The last path segment of a submodel id, e.g. `Variables`. */
function submodelName (submodelId: string): string {
  return submodelId.split(/[/#]/).findLast(segment => segment !== '') ?? submodelId
}

function describe (endpoint: Referenced): Omit<AimcEndpointEntry, 'readers' | 'writers'> {
  const resolved = endpoint.resolved
  const submodel = submodelName(endpoint.submodelId)
  if (resolved?.kind === 'affordance' && resolved.affordancePath) {
    const [group] = resolved.affordancePath.split('/', 1)
    const member = resolved.selectedMember ? `.${resolved.selectedMember}` : ''
    const protocol = endpoint.protocol || endpoint.keys.find(key => /^interface[_.-]/i.test(key.value))?.value.replace(/^interface[_.-]/i, '')
    return {
      key: `${endpoint.submodelId}|${resolved.affordancePath}|${resolved.direction ?? ''}|${resolved.selectedMember ?? ''}`,
      origin: protocol ? `${submodel} · interface_${protocol}` : submodel,
      label: `${resolved.affordanceName ?? resolved.affordancePath}${member}`,
      kind: 'affordance',
      group,
    }
  }
  const path = endpoint.keys.slice(1).map(key => key.value).join('/')
  return {
    key: `${endpoint.submodelId}|${path}`,
    origin: submodel,
    label: path || submodel,
    kind: resolved?.kind ?? 'unknown',
  }
}

export function indexEndpoints (routes: AimcMapping[]): AimcEndpointEntry[] {
  const entries = new Map<string, AimcEndpointEntry>()
  const add = (endpoint: Referenced, use: AimcEndpointUse, role: 'readers' | 'writers'): void => {
    const description = describe(endpoint)
    let entry = entries.get(description.key)
    if (!entry) {
      entry = { ...description, readers: [], writers: [] }
      entries.set(description.key, entry)
    }
    entry[role].push(use)
  }

  for (const route of routes) {
    const use = (endpointId: string, phase: AimcEndpointUse['phase']): AimcEndpointUse =>
      ({ routeId: route.id, routeName: route.name, endpointId, phase })
    for (const source of route.sources) {
      add(source, use(source.sourceId, 'request'), 'readers')
    }
    for (const sink of route.sinks) {
      add(sink, use(sink.sinkId, 'request'), 'writers')
    }
    for (const source of route.responseSources) {
      add(source, use(source.id, 'response'), 'readers')
    }
    for (const sink of route.responseSinks) {
      add(sink, use(sink.id, 'response'), 'writers')
    }
  }

  return [...entries.values()].toSorted((a, b) => a.origin.localeCompare(b.origin) || a.label.localeCompare(b.label))
}
