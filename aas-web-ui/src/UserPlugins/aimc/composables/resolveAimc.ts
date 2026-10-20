import type { AimcAffordanceGroup, AimcMapping, AimcReferenceKey, AimcResolvedEndpoint, AimcResponseEndpoint } from '../types'

/**
 * Semantic ids of the AID `InteractionMetadata` group containers
 * (`properties`, `actions`, `events`); the affordances are their children.
 */
const affordanceIds = [
  'td#PropertyAffordance',
  'td#EventAffordance',
  'td#ActionAffordance',
]

function semanticValues (element: any): string[] {
  const keys = element?.semanticId?.keys ?? element?.semanticId?.key
  return Array.isArray(keys)
    ? keys.map((key: any) => typeof key === 'string' ? key : key?.value).filter((value: any) => typeof value === 'string')
    : []
}

function children (element: any): any[] {
  return Array.isArray(element?.submodelElements)
    ? element.submodelElements
    : (Array.isArray(element?.value) ? element.value : [])
}

function findPath (submodel: any, values: string[]): any[] | undefined {
  const visit = (element: any, index: number, ancestors: any[]): any[] | undefined => {
    if (index >= values.length || element?.idShort !== values[index]) {
      return undefined
    }
    const path = [...ancestors, element]
    if (index === values.length - 1) {
      return path
    }
    for (const child of children(element)) {
      const found = visit(child, index + 1, path)
      if (found) {
        return found
      }
    }
    return undefined
  }

  for (const root of children(submodel)) {
    const found = visit(root, 0, [])
    if (found) {
      return found
    }
  }
  return undefined
}

function findDescendant (root: any, idShort: string): any[] | undefined {
  for (const child of children(root)) {
    if (child?.idShort === idShort) {
      return [child]
    }
    const nested = findDescendant(child, idShort)
    if (nested) {
      return [child, ...nested]
    }
  }
  return undefined
}

function findSchemaPointerPath (submodel: any, values: string[]): any[] | undefined {
  const directionIndex = values.findIndex(value => value === 'input' || value === 'output')
  if (directionIndex === -1 || directionIndex === values.length - 1) {
    return undefined
  }
  const affordancePath = findPath(submodel, values.slice(0, directionIndex))
  const affordance = affordancePath?.at(-1)
  if (!affordance) {
    return undefined
  }
  const directionId = values[directionIndex] === 'input' ? 'hasInputSchema' : 'hasOutputSchema'
  const schema = findDescendant(affordance, values[directionIndex]!)
    ?? findSemanticDescendant(affordance, `td#${directionId}`)
  if (!schema) {
    return undefined
  }
  const memberPath = findDescendant(schema.at(-1), values.at(-1)!)
  return memberPath ? [...affordancePath!, ...schema, ...memberPath] : undefined
}

function findSemanticDescendant (root: any, suffix: string): any[] | undefined {
  for (const child of children(root)) {
    if (semanticValues(child).some(value => value.endsWith(suffix))) {
      return [child]
    }
    const nested = findSemanticDescendant(child, suffix)
    if (nested) {
      return [child, ...nested]
    }
  }
  return undefined
}

function isHref (element: any): boolean {
  return element?.idShort === 'href'
    || semanticValues(element).some(value => value.endsWith('hypermedia#hasTarget') || value.endsWith('td#href'))
}

/**
 * The target of an affordance's form. The AID `forms` collection holds the
 * form's fields directly; a list of forms (one collection per form) is also
 * accepted, in which case the first form is shown.
 */
function formHref (affordance: any): string {
  const forms = children(affordance).find(child => child?.idShort === 'forms')
  const href = children(forms).find(child => isHref(child))
    ?? children(children(forms)[0]).find(child => isHref(child))
  return typeof href?.value === 'string' ? href.value : ''
}

export function resolveAimcReference (
  keys: AimcReferenceKey[],
  submodels: Map<string, any>,
): AimcResolvedEndpoint {
  const submodelId = keys[0]?.value
  if (!submodelId) {
    // e.g. the IDTA template, whose example Source/Sink references are empty.
    return { kind: 'unknown', warning: 'A Source or Sink has no reference set.' }
  }
  const submodel = submodels.get(submodelId)
  if (!submodel) {
    return { kind: 'unknown', warning: `Referenced submodel could not be loaded: ${submodelId}` }
  }

  const pathKeys = keys.slice(1).map(key => key.value)
  const path = findPath(submodel, pathKeys) ?? findSchemaPointerPath(submodel, pathKeys)
  if (!path) {
    return { kind: 'unknown', warning: `Reference could not be resolved: ${keys.map(key => key.value).join('/')}` }
  }

  const groupIndex = path.findLastIndex(element => {
    const values = semanticValues(element)
    return affordanceIds.some(id => values.some(value => value.endsWith(id)))
  })
  const affordanceIndex = groupIndex + 1
  if (groupIndex === -1 || affordanceIndex >= path.length) {
    const target = path.at(-1)
    const isOperation = target?.modelType === 'Operation' || keys.at(-1)?.type === 'Operation'
    return { kind: isOperation ? 'operation' : 'aas-element' }
  }

  const affordance = path[affordanceIndex]
  const semanticId = semanticValues(path[groupIndex]).find(value => affordanceIds.some(id => value.endsWith(id)))!
  const group = semanticId.endsWith('PropertyAffordance')
    ? 'properties'
    : (semanticId.endsWith('EventAffordance') ? 'events' : 'actions')
  const affordanceName = affordance.idShort ?? 'affordance'
  const remaining = path.slice(affordanceIndex + 1)
  const directionKey = keys.slice(1).find(key => key.value === 'input' || key.value === 'output')?.value
  const direction = directionKey === 'output' ? 'output' : (directionKey === 'input' ? 'input' : undefined)
  const directionIndex = keys.findIndex(key => key.value === 'input' || key.value === 'output')
  const hasMemberPointer = directionIndex !== -1 && directionIndex < keys.length - 1
  const selectedMember = hasMemberPointer ? remaining.at(-1)?.idShort ?? keys.at(-1)?.value : undefined
  const isAction = group === 'actions'

  return {
    kind: 'affordance',
    affordanceId: `${submodelId}/${affordanceName}`,
    affordancePath: `${group}/${affordanceName}`,
    affordanceName,
    direction: direction ?? (isAction ? 'input' : undefined),
    selectedMember: remaining.length > 0 ? selectedMember : undefined,
    form: formHref(affordance),
  }
}

export function resolveAimcMapping (mapping: AimcMapping, submodels: Map<string, any>): AimcMapping {
  const sources = mapping.sources.map(source => {
    const resolved = resolveAimcReference(source.keys, submodels)
    return { ...source, kind: resolved.kind, group: affordanceGroup(resolved), resolved }
  })
  const sinks = mapping.sinks.map(sink => {
    const resolved = resolveAimcReference(sink.keys, submodels)
    return { ...sink, kind: resolved.kind, group: affordanceGroup(resolved), resolved }
  })
  const responseSources = mapping.responseSources.map(endpoint => ({
    ...endpoint,
    ...resolveResponse(endpoint, submodels),
  }))
  const responseSinks = mapping.responseSinks.map(endpoint => ({
    ...endpoint,
    ...resolveResponse(endpoint, submodels),
  }))
  const delegated = sources.some(source => source.resolved?.kind === 'operation')
    && sinks.some(sink => sink.resolved?.kind === 'affordance')
  const kind = delegated ? 'delegated-action' : 'data'
  const hasResponseElements = mapping.response.present
    || mapping.responseSources.length > 0
    || mapping.responseSinks.length > 0
  const warnings = [
    ...(mapping.warnings ?? []),
    ...[...sources, ...sinks, ...responseSources, ...responseSinks]
      .flatMap(endpoint => endpoint.resolved?.warning ? [endpoint.resolved.warning] : []),
    ...(hasResponseElements && !delegated
      ? ['Response elements are only valid on an operation mapping (an AAS Operation source bound to an AID affordance); the DMP rejects them on a data mapping.']
      : []),
  ]

  return {
    ...mapping,
    sources,
    sinks,
    responseSources,
    responseSinks,
    kind,
    bidirectional: delegated || mapping.response.present,
    warnings,
  }
}

const affordanceGroups = ['properties', 'actions', 'events'] as const

function affordanceGroup (endpoint: AimcResolvedEndpoint): AimcAffordanceGroup | undefined {
  const group = endpoint.affordancePath?.split('/', 1)[0]
  return affordanceGroups.find(candidate => candidate === group)
}

function resolveResponse (endpoint: AimcResponseEndpoint, submodels: Map<string, any>): { resolved: AimcResolvedEndpoint } {
  return { resolved: resolveAimcReference(endpoint.keys, submodels) }
}
