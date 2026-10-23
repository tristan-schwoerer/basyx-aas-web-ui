/**
 * Parses an IDTA AIMC submodel (as returned by the BaSyx Submodel Repository)
 * into the flat mapping model the visualization renders.
 *
 * The mapping is intentionally tolerant: the wire format is produced by several
 * tools and the `MappingConfiguration` collection loses its `idShort` when it is
 * serialised as a `SubmodelElementList` item, so the authored name is recovered
 * from the IEC 61360 `class` preferred name where possible.
 */
import type {
  AimcEvaluationMode,
  AimcMapping,
  AimcMappingKind,
  AimcReferenceKey,
  AimcSink,
  AimcSource,
  AimcTransformation,
} from '../types'
import { AIMC_EVALUATION_MODES } from '../types'
import {
  AIMC_EVALUATION,
  AIMC_RESPONSE_SINKS,
  AIMC_RESPONSE_SOURCES,
  AIMC_RESPONSE_TRANSFORMATION,
  AIMC_SINKS,
  AIMC_SOURCES,
  AIMC_TRANSFORMATION,
} from '../types/semanticIds'
import { dmpMappingIdentity } from './dmpStatus'

/** idShort values that carry no author intent for a list item. */
const PLACEHOLDER_NAMES = new Set([
  'SubmodelElementCollection',
  'SubmodelElementList',
  'MappingConfiguration',
  'MappingConfigurations',
  'mapping',
  'Blob',
])

/** Blob placeholders written by tooling that serialised python `None`/`b''`. */
const EMPTY_BLOB_PLACEHOLDERS = new Set(['None', 'null', 'b\'\''])

/** Decodes a Blob value (base64) into text, tolerating empty/placeholder values. */
function blobText (value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    return ''
  }
  const trimmed = value.trim()
  if (EMPTY_BLOB_PLACEHOLDERS.has(trimmed)) {
    return ''
  }
  try {
    const normalised = trimmed.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4)
    return decodeURIComponent(escape(atob(padded)))
  } catch {
    return ''
  }
}

/** Normalises a semanticId of a SubmodelElement to its plain key value. */
function semanticIdValue (element: any): string {
  const keys = element?.semanticId?.keys ?? element?.semanticId?.key
  if (!Array.isArray(keys) || keys.length === 0) {
    return ''
  }
  for (const key of keys) {
    const value = typeof key === 'string' ? key : key?.value
    if (typeof value === 'string' && value !== '') {
      return value
    }
  }
  return ''
}

function hasSemanticId (element: any, semanticId: string): boolean {
  const value = semanticIdValue(element)
  return value === semanticId || value.endsWith(semanticId)
}

function children (collection: any): any[] {
  return Array.isArray(collection?.value) ? collection.value : []
}

function findByIdShortOrSemanticId (collection: any, idShort: string, semanticId?: string): any {
  return children(collection).find(
    element => element?.idShort === idShort || (semanticId ? hasSemanticId(element, semanticId) : false),
  )
}

/** Reads the reference keys of a ReferenceElement, in wire (`keys`) or model (`key`) form. */
function referenceKeys (element: any): AimcReferenceKey[] {
  const reference = element?.value
  const raw = reference?.keys ?? reference?.key
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .map((key: any) => ({ type: typeof key?.type === 'string' ? key.type : '', value: typeof key?.value === 'string' ? key.value : '' }))
    .filter((key: AimcReferenceKey) => key.value !== '')
}

function isPropertyValue (element: any): string {
  return element?.modelType === 'Property' && typeof element.value === 'string' ? element.value : ''
}

function isDouble (element: any): number | undefined {
  const raw = isPropertyValue(element)
  if (raw === '') {
    return undefined
  }
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Extracts the `interface_<protocol>` segment of a reference, if present. */
export function protocolOf (keys: AimcReferenceKey[]): string {
  const interfaceKey = keys.find(key => /^interface[_.-]/i.test(key.value))
  return interfaceKey ? interfaceKey.value.replace(/^interface[_.-]/i, '') : ''
}

function referencePath (keys: AimcReferenceKey[]): string {
  return keys.map(key => key.value).join('/')
}

/** Recovers the authored MappingConfiguration name from IEC 61360 metadata. */
function mappingName (mapping: any, index: number): string {
  const specs = Array.isArray(mapping?.embeddedDataSpecifications) ? mapping.embeddedDataSpecifications : []
  for (const spec of specs) {
    const content = spec?.dataSpecificationContent
    if (content?.modelType !== 'DataSpecificationIec61360') {
      continue
    }
    const preferredNames = Array.isArray(content.preferredName) ? content.preferredName : []
    const isClass = preferredNames.some((entry: any) => entry?.text === 'class')
    if (!isClass) {
      continue
    }
    const keyValue = spec?.dataSpecification?.keys?.[0]?.value
    if (typeof keyValue === 'string' && keyValue !== '' && !PLACEHOLDER_NAMES.has(keyValue)) {
      return keyValue
    }
  }
  const idShort = mapping?.idShort
  if (typeof idShort === 'string' && idShort !== '' && !PLACEHOLDER_NAMES.has(idShort)) {
    return idShort
  }
  return `mapping_${index}`
}

/** A Source's `Evaluation/Mode`: the authored mode, or a warning for one the DMP does not know. */
function parseEvaluation (source: any): { mode?: AimcEvaluationMode, warning?: string } {
  const evaluation = findByIdShortOrSemanticId(source, 'Evaluation', AIMC_EVALUATION)
  if (evaluation === undefined) {
    return {}
  }
  const mode = isPropertyValue(findByIdShortOrSemanticId(evaluation, 'Mode'))
  return AIMC_EVALUATION_MODES.includes(mode as AimcEvaluationMode)
    ? { mode: mode as AimcEvaluationMode }
    : { warning: `Evaluation/Mode "${mode}" is not one of ${AIMC_EVALUATION_MODES.join(', ')}; the DMP rejects the mapping.` }
}

function parseSource (source: any): AimcSource {
  const keys = referenceKeys(findByIdShortOrSemanticId(source, 'Source'))
  const evaluation = parseEvaluation(source).mode
  return {
    sourceId: isPropertyValue(findByIdShortOrSemanticId(source, 'SourceId')) || source?.idShort || '',
    keys,
    kind: 'unknown',
    refPath: referencePath(keys),
    protocol: protocolOf(keys),
    submodelId: keys[0]?.value ?? '',
    pollingInterval: isDouble(findByIdShortOrSemanticId(source, 'PollingInterval')),
    evaluation,
    // Settled once the targets are resolved (an Operation, or an Operation mapping's further Sources).
    effectiveEvaluation: evaluation ?? 'OnUpdate',
    triggers: [undefined, 'OnUpdate', 'OnChange'].includes(evaluation),
  }
}

function parseSink (sink: any): AimcSink {
  const keys = referenceKeys(findByIdShortOrSemanticId(sink, 'Sink'))
  return {
    sinkId: isPropertyValue(findByIdShortOrSemanticId(sink, 'SinkId')) || sink?.idShort || '',
    keys,
    kind: 'unknown',
    refPath: referencePath(keys),
    protocol: protocolOf(keys),
    submodelId: keys[0]?.value ?? '',
  }
}

function parseResponseEndpoints (mapping: any, idShort: string, semanticId: string): AimcMapping['responseSources'] {
  const list = findByIdShortOrSemanticId(mapping, idShort, semanticId)
  return children(list).map(element => {
    const ref = findByIdShortOrSemanticId(element, idShort === 'ResponseSources' ? 'Source' : 'Sink')
    const keys = referenceKeys(ref)
    return {
      id: isPropertyValue(findByIdShortOrSemanticId(element, idShort === 'ResponseSources' ? 'SourceId' : 'SinkId'))
        || element?.idShort || '',
      keys,
      refPath: referencePath(keys),
      submodelId: keys[0]?.value ?? '',
    }
  })
}

function parseTransformation (
  mapping: any,
  idShort: string,
  semanticId: string,
  direction: 'request' | 'response',
): AimcTransformation {
  const blob = findByIdShortOrSemanticId(mapping, idShort, semanticId)
  return {
    direction,
    code: blobText(blob?.value),
    present: blob !== undefined,
    path: blob?.path ?? '',
    element: blob,
  }
}

/** Locates the MappingConfigurations list inside a submodel. */
function findMappingConfigurations (submodel: any): any {
  const elements = Array.isArray(submodel?.submodelElements) ? submodel.submodelElements : []
  return elements.find(
    (element: any) => element?.idShort === 'MappingConfigurations' || hasSemanticId(element, '/MappingConfigurations'),
  )
}

/**
 * Parses a single `MappingConfiguration`.
 *
 * The plugin visualises one route at a time, so this is the unit of work; a
 * route is an item of the `MappingConfigurations` `SubmodelElementList`, which
 * is why it carries neither `idShort` nor (in practice) a `semanticId`.
 *
 * @param mapping the `SubmodelElementCollection` of one route.
 * @param index its position in the list, used for the fallback name and node ids.
 */
export function parseAimcRoute (mapping: any, index: number): AimcMapping {
  const sourcesList = findByIdShortOrSemanticId(mapping, 'Sources', AIMC_SOURCES)
  const sinksList = findByIdShortOrSemanticId(mapping, 'Sinks', AIMC_SINKS)
  const sources = children(sourcesList).map(element => parseSource(element))
  const sinks = children(sinksList).map(element => parseSink(element))
  const request = parseTransformation(mapping, 'Transformation', AIMC_TRANSFORMATION, 'request')
  const response = parseTransformation(mapping, 'ResponseTransformation', AIMC_RESPONSE_TRANSFORMATION, 'response')
  const responseSources = parseResponseEndpoints(mapping, 'ResponseSources', AIMC_RESPONSE_SOURCES)
  const responseSinks = parseResponseEndpoints(mapping, 'ResponseSinks', AIMC_RESPONSE_SINKS)
  const kind: AimcMappingKind = 'data'
  const warnings = children(sourcesList).flatMap(element => {
    const warning = parseEvaluation(element).warning
    return warning ? [warning] : []
  })

  return {
    id: `mapping_${index}`,
    name: mappingName(mapping, index),
    index,
    identity: dmpMappingIdentity(mapping?.idShort, index),
    kind,
    sources,
    sinks,
    defaultPollingInterval: isDouble(findByIdShortOrSemanticId(mapping, 'DefaultPollingInterval')),
    request,
    response,
    responseSources,
    responseSinks,
    warnings,
    path: mapping?.path ?? '',
    bidirectional: response.present,
  }
}

/** True when the route declares neither sources nor sinks and cannot be routed. */
function isRoutable (mapping: any): boolean {
  return Boolean(
    findByIdShortOrSemanticId(mapping, 'Sources', AIMC_SOURCES)
    || findByIdShortOrSemanticId(mapping, 'Sinks', AIMC_SINKS),
  )
}

export interface ParseAimcResult {
  mappings: AimcMapping[]
  /** Non-fatal problems encountered while parsing, surfaced as warnings in the UI. */
  warnings: string[]
}

/**
 * Parses an AIMC submodel into its routes.
 *
 * Only used to populate the route index and to resolve which route the tree
 * selection points at; the visualization itself always renders a single route.
 *
 * @param submodel the submodel object; must already have been enriched with
 * `path` per element (see `useSMHandling().setData`).
 */
export function parseAimc (submodel: any): ParseAimcResult {
  const warnings: string[] = []
  const list = findMappingConfigurations(submodel)
  if (!list) {
    return { mappings: [], warnings: ['No MappingConfigurations element found in this submodel.'] }
  }

  const mappings: AimcMapping[] = []
  const items: any[] = Array.isArray(list.value) ? list.value : []

  for (const [index, mapping] of items.entries()) {
    if (!isRoutable(mapping)) {
      warnings.push(`Mapping ${index} has neither Sources nor Sinks and was skipped.`)
      continue
    }
    mappings.push(parseAimcRoute(mapping, index))
  }

  if (mappings.length === 0) {
    warnings.push('The MappingConfigurations list is empty.')
  }

  // The DMP keys a route by its idShort and rejects every route that shares one.
  const identities = mappings.map(mapping => mapping.identity)
  for (const identity of new Set(identities.filter((identity, index) => identities.indexOf(identity) !== index))) {
    warnings.push(`Several routes share the idShort "${identity}"; the DMP rejects duplicate mapping identities.`)
  }

  return { mappings, warnings }
}
