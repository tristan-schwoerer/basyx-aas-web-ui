/**
 * Semantic IDs the AIMC plugin relies on. Kept in sync with
 * `aas_model.constants` and `ARSO_Ontology_AAS_Generation/ui/src/aas/semanticIds.ts`.
 *
 * Only the ids that are actually matched are declared here: the parser resolves
 * the remaining children of a route (`Source`, `Sink`, `SourceId`, …) by
 * `idShort`, which survives the AAS round trip, while `semanticId` on
 * `SubmodelElementList` items is stripped by AASd-114.
 */

const BASE = 'https://admin-shell.io/idta/AssetInterfacesMappingConfiguration'

/**
 * AIMC 2.x submodel — what this repository's templates generate. The 2.1
 * template still carries the 2/0 semantic ids.
 */
export const AIMC_SUBMODEL = `${BASE}/2/0/Submodel`

export const AIMC_TRANSFORMATION = `${BASE}/2/0/MappingConfiguration/Transformation`
export const AIMC_SOURCES = `${BASE}/2/0/MappingConfiguration/Sources`
export const AIMC_SINKS = `${BASE}/2/0/MappingConfiguration/Sinks`

/**
 * DMP extensions of the MappingConfiguration, in the project namespace
 * (`aas_model.constants.AIMC_*`) so a plain IDTA consumer can tell them apart.
 */
const DMP_BASE = 'https://smartproductionlab.aau.dk/aimc'

/** The response direction of an operation mapping: the action's output → the caller's reply. */
export const AIMC_RESPONSE_TRANSFORMATION = `${DMP_BASE}/ResponseTransformation/1/0`
export const AIMC_RESPONSE_SOURCES = `${DMP_BASE}/ResponseSources/1/0`
export const AIMC_RESPONSE_SINKS = `${DMP_BASE}/ResponseSinks/1/0`

/** Which source updates execute an ordinary mapping. */
export const AIMC_EXECUTION_SEMANTICS = `${DMP_BASE}/ExecutionSemantics/1/0`
export const AIMC_TRIGGER_SOURCE_IDS = `${DMP_BASE}/ExecutionSemantics/TriggerSourceIds/1/0`

/**
 * Semantic IDs the plugin registers for: AIMC 2.x only, the version the DMP
 * executes. AIMC 1.0 is a different model (an InterfaceReference plus
 * source/sink RelationshipElements, no transformation) and is not supported.
 *
 * Note that a route cannot be registered for: AASd-114 makes every
 * `SubmodelElementList` item inherit the list's `semanticId`, so
 * `aas_pydantic` strips the per-item one and the BaSyx UI cannot dispatch a
 * plugin on an individual route.
 */
export const AIMC_PLUGIN_SEMANTIC_IDS = [AIMC_SUBMODEL]
