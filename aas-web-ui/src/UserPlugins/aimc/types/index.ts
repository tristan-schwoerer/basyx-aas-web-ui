/**
 * Types for the AIMC (AssetInterfacesMappingConfiguration) visualization plugin.
 *
 * Mirrors `aas_model.submodel_templates.aimc` (DMP extension) and the pristine
 * IDTA template `aas_pydantic.submodel_templates.asset_interfaces_mapping_configuration`.
 */

/** A single key of a ModelReference: `{ type, value }`. */
export interface AimcReferenceKey {
  type: string
  value: string
}

/** How a source or sink endpoint is addressed, derived from its reference keys. */
export type AimcEndpointKind
  = | 'affordance' // AID InteractionMetadata properties/actions/events data point
    | 'operation' // CCI Skills/<name>/operation
    | 'aas-element' // plain AAS SubmodelElement (e.g. Variables/PackMLState)
    | 'unknown'

/** The affordance group an AID data point lives in. */
export type AimcAffordanceGroup = 'properties' | 'actions' | 'events'

/** Classification of a whole MappingConfiguration, mirroring the DMP resolver. */
export type AimcMappingKind
  = | 'data' // plain data mapping
    | 'delegated-action' // Operation source -> AID affordance sink (request/reply)

/** A Lua transformation blob (request- or response-direction). */
export interface AimcTransformation {
  /** Which direction of the action contract this blob implements. */
  direction: 'request' | 'response'
  /** Decoded Lua source, or `''` when the blob is absent/empty (passthrough). */
  code: string
  /** `true` when a blob element exists, even if it decodes to an empty string. */
  present: boolean
  /** Repository path of the blob, needed to persist edits. */
  path: string
  /**
   * The blob element exactly as it was read from the repository. Persisting an
   * edit must not drop `semanticId` (or qualifiers/category), because the DMP
   * resolver classifies `ResponseTransformation` by its semanticId.
   */
  element?: Record<string, unknown>
}

/** A source (input) of a mapping. */
export interface AimcSource {
  sourceId: string
  keys: AimcReferenceKey[]
  kind: AimcEndpointKind
  /** Human readable reference path, e.g. `.../InteractionMetadata/properties/StationState`. */
  refPath: string
  /** Protocol inferred from the `interface_*` segment, e.g. `mqtt`. */
  protocol: string
  /** Affordance group when `kind === 'affordance'`. */
  group?: AimcAffordanceGroup
  /** Owning submodel id (first reference key value). */
  submodelId: string
  /** Per-source polling interval in seconds, if declared. */
  pollingInterval?: number
  /**
   * `false` when the route declares `ExecutionSemantics.TriggerSourceIds` and
   * this source is not among them: its value is read, but its updates do not
   * execute the mapping.
   */
  triggers: boolean
  /** Semantic resolution of the physical AAS/AID target. */
  resolved?: AimcResolvedEndpoint
}

/** A sink (output) of a mapping. */
export interface AimcSink {
  sinkId: string
  keys: AimcReferenceKey[]
  kind: AimcEndpointKind
  refPath: string
  protocol: string
  group?: AimcAffordanceGroup
  submodelId: string
  resolved?: AimcResolvedEndpoint
}

export interface AimcResolvedEndpoint {
  kind: AimcEndpointKind
  operationId?: string
  operationPath?: string
  affordanceId?: string
  affordancePath?: string
  affordanceName?: string
  direction?: 'input' | 'inoutput' | 'output'
  selectedMember?: string
  form?: string
  warning?: string
}

export interface AimcResponseEndpoint {
  id: string
  keys: AimcReferenceKey[]
  refPath: string
  submodelId: string
  resolved?: AimcResolvedEndpoint
}

/** One parsed MappingConfiguration. */
export interface AimcMapping {
  /** Stable id for graph nodes: `mapping_<index>`. */
  id: string
  /** Authored name, recovered from IEC 61360 metadata or `idShort`. */
  name: string
  /** Index within the MappingConfigurations list. */
  index: number
  /** The identity the DMP keys this route by: the item's idShort, or `mapping_<index>`. */
  identity: string
  kind: AimcMappingKind
  sources: AimcSource[]
  sinks: AimcSink[]
  /** Default polling interval of the MappingConfiguration, if declared. */
  defaultPollingInterval?: number
  /**
   * `ExecutionSemantics.TriggerSourceIds`: the SourceIds whose updates execute
   * the mapping. Empty when not declared, in which case every source triggers.
   */
  triggerSourceIds: string[]
  request: AimcTransformation
  response: AimcTransformation
  responseSources: AimcResponseEndpoint[]
  responseSinks: AimcResponseEndpoint[]
  warnings?: string[]
  /** Repository path of the MappingConfiguration collection. */
  path: string
  /**
   * `true` when the mapping is a correlated request/reply action: either a
   * response transformation is authored, or the mapping is classified as an
   * operation delegation. The reply then flows sink -> response -> source.
   */
  bidirectional: boolean
}
