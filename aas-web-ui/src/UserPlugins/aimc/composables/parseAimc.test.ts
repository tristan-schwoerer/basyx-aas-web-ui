/**
 * Parser and resolver tests for the AIMC visualization plugin.
 *
 * The fixtures are the DMP runtime-model contract fixtures of the AP2030-UNS
 * repository (generated from aas-model by `scripts/dmp_contract_fixtures.py`):
 * plain Submodel JSON, the exact wire format the BaSyx Submodel Repository
 * returns, together with the AID and every other submodel a route references.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { indexEndpoints } from './endpointIndex'
import { parseAimc, parseAimcRoute } from './parseAimc'
import { resolveAimcMapping, resolveAimcReference } from './resolveAimc'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * The fixtures live in the AP2030-UNS repository, which is not vendored here.
 * Point the suite at a checkout with `AIMC_FIXTURE_ROOT=/path/to/AP2030-UNS`;
 * without it the fixture-driven suites skip rather than fail, so this fork's
 * own `pnpm test` (and the Docker build) stays green.
 */
const fixtureRoot = process.env.AIMC_FIXTURE_ROOT ?? resolve(here, '../../../../../..')
const contractRoot = resolve(fixtureRoot, 'aas-camel-dmp/dmp.component/src/test/resources/runtime-model-contracts')
const hasFixtures = existsSync(resolve(contractRoot, 'manifest.json'))
const describeFixtures = hasFixtures ? describe : describe.skip

interface ContractCase {
  name: string
  aimc: string
  aid: string
  dependencies: Array<{ id: string, path: string }>
}

/**
 * `describe.skip` still runs the suite body while collecting, so a suite that
 * loads fixtures at the top has to bail out explicitly instead of relying on
 * the skip alone.
 */
function skipWithoutFixtures (): boolean {
  if (!hasFixtures) {
    it.skip('needs an AP2030-UNS checkout; set AIMC_FIXTURE_ROOT', () => {})
    return true
  }
  return false
}

function loadJson (path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** Accepts a plain submodel or a Submodel Repository event envelope. */
function unwrapSubmodel (payload: any): any {
  return payload.modelType === 'Submodel' ? payload : payload.submodel
}

/**
 * Mirrors the `path` annotation that `useSMHandling().setData` applies, which
 * is what the visualization hands to the parser and the editor persists to.
 */
function annotatePaths (node: any, path: string): any {
  node.path = path
  if (node.modelType === 'Submodel' && Array.isArray(node.submodelElements)) {
    for (const element of node.submodelElements) {
      annotatePaths(element, `${path}/submodel-elements/${element.idShort}`)
    }
  } else if (
    (node.modelType === 'SubmodelElementCollection' || node.modelType === 'SubmodelElementList')
    && Array.isArray(node.value)
  ) {
    for (const [index, element] of node.value.entries()) {
      const childPath = node.modelType === 'SubmodelElementList'
        ? `${path}[${index}]`
        : `${path}.${element.idShort}`
      annotatePaths(element, childPath)
    }
  }
  return node
}

/** One contract case: its annotated AIMC and every submodel its routes reference. */
function loadCase (name: string): { aimc: any, submodels: Map<string, any> } {
  const manifest = loadJson(resolve(contractRoot, 'manifest.json'))
  const entry: ContractCase = manifest.cases.find((candidate: ContractCase) => candidate.name === name)
  const aimc = annotatePaths(unwrapSubmodel(loadJson(resolve(contractRoot, entry.aimc))), 'http://aas-env:8081/submodels/aimc')
  const aid = unwrapSubmodel(loadJson(resolve(contractRoot, entry.aid)))
  const submodels = new Map<string, any>([[aid.id, aid]])
  for (const dependency of entry.dependencies) {
    submodels.set(dependency.id, unwrapSubmodel(loadJson(resolve(contractRoot, name, dependency.path))))
  }
  return { aimc, submodels }
}

/** Returns the raw (annotated) list items of an AIMC's MappingConfigurations. */
function routeItems (aimc: any): any[] {
  return aimc.submodelElements.find((element: any) => element.idShort === 'MappingConfigurations').value
}

describe('parseAimc without fixtures', () => {
  it('reports a warning for a submodel without mappings', () => {
    expect(parseAimc({ modelType: 'Submodel', submodelElements: [] }).warnings[0])
      .toContain('No MappingConfigurations')
  })

  it('reads each Source\'s Evaluation/Mode and flags an unknown one', () => {
    const evaluated = (id: string, mode?: string) => ({
      modelType: 'SubmodelElementCollection',
      value: [
        { idShort: 'SourceId', modelType: 'Property', value: id },
        ...(mode === undefined
          ? []
          : [{ idShort: 'Evaluation', modelType: 'SubmodelElementCollection', value: [{ idShort: 'Mode', modelType: 'Property', value: mode }] }]),
      ],
    })
    const route = parseAimcRoute({
      modelType: 'SubmodelElementCollection',
      value: [{
        idShort: 'Sources',
        modelType: 'SubmodelElementList',
        value: [evaluated('A'), evaluated('B', 'OnChange'), evaluated('C', 'Cached'), evaluated('D', 'ReadAtEvaluation'), evaluated('E', 'Sometimes')],
      }],
    }, 0)
    expect(route.sources.map(source => source.evaluation)).toEqual([undefined, 'OnChange', 'Cached', 'ReadAtEvaluation', undefined])
    expect(route.sources.map(source => source.effectiveEvaluation)).toEqual(['OnUpdate', 'OnChange', 'Cached', 'ReadAtEvaluation', 'OnUpdate'])
    expect(route.sources.map(source => source.triggers)).toEqual([true, true, false, false, true])
    expect(route.warnings).toEqual([expect.stringContaining('Evaluation/Mode "Sometimes"')])
  })

  it('warns about a mapping no Source triggers', () => {
    const cached = parseAimcRoute({
      modelType: 'SubmodelElementCollection',
      value: [{
        idShort: 'Sources',
        modelType: 'SubmodelElementList',
        value: [{ modelType: 'SubmodelElementCollection', value: [
          { idShort: 'SourceId', modelType: 'Property', value: 'A' },
          { idShort: 'Evaluation', modelType: 'SubmodelElementCollection', value: [{ idShort: 'Mode', modelType: 'Property', value: 'Cached' }] },
        ] }],
      }],
    }, 0)
    expect(resolveAimcMapping(cached, new Map()).warnings).toContain(
      'No Source triggers this mapping; one needs the Evaluation OnUpdate (the default) or OnChange.')
  })

  it('warns about routes sharing an idShort, which the DMP rejects', () => {
    const route = (idShort: string) => ({
      idShort,
      modelType: 'SubmodelElementCollection',
      value: [{ idShort: 'Sources', modelType: 'SubmodelElementList', value: [] }],
    })
    const { warnings } = parseAimc({
      modelType: 'Submodel',
      submodelElements: [{ idShort: 'MappingConfigurations', modelType: 'SubmodelElementList', value: [route('A'), route('A'), route('B')] }],
    })
    expect(warnings).toEqual(['Several routes share the idShort "A"; the DMP rejects duplicate mapping identities.'])
  })

  it('lets every source trigger when no selection is declared', () => {
    const route = parseAimcRoute({
      modelType: 'SubmodelElementCollection',
      value: [{
        idShort: 'Sources',
        modelType: 'SubmodelElementList',
        value: [{ modelType: 'SubmodelElementCollection', value: [{ idShort: 'SourceId', modelType: 'Property', value: 'A' }] }],
      }],
    }, 0)
    expect(route.sources[0]!.effectiveEvaluation).toBe('OnUpdate')
    expect(route.sources[0]!.triggers).toBe(true)
  })
})

const idtaTemplateRoot = resolve(fixtureRoot, 'aas-model/submodel-templates/published/Asset Interfaces Mapping Configuration')

describeFixtures('plain IDTA AIMC templates, without the DMP extensions', () => {
  if (skipWithoutFixtures()) {
    return
  }

  it.each(['2/0', '2/1'])('parses and resolves the published %s example', version => {
    const environment = loadJson(resolve(idtaTemplateRoot, version, 'IDTA 02027_Template_AIMC.json'))
    const submodel = annotatePaths(environment.submodels[0], 'http://aas-env:8081/submodels/aimc')
    const { mappings, warnings } = parseAimc(submodel)
    expect(warnings).toEqual([])
    expect(mappings).toHaveLength(1)

    const [route] = mappings
    expect(route!.sources).toHaveLength(1)
    expect(route!.sinks).toHaveLength(1)
    expect(route!.sources[0]!.pollingInterval).toBe(1)
    expect(route!.defaultPollingInterval).toBe(1)
    // None of the DMP extensions are present, and none are required.
    expect(route!.response.present).toBe(false)
    expect(route!.sources[0]!.evaluation).toBeUndefined()
    expect(route!.bidirectional).toBe(false)

    // The template's example references are empty: reported, not thrown.
    const resolved = resolveAimcMapping(route!, new Map())
    expect(resolved.kind).toBe('data')
    expect(resolved.warnings).toEqual(['A Source or Sink has no reference set.', 'A Source or Sink has no reference set.'])
  })
})

describeFixtures('parseAimc (stoppering)', () => {
  if (skipWithoutFixtures()) {
    return
  }
  const { aimc } = loadCase('stoppering')
  const result = parseAimc(aimc)

  it('finds the MappingConfigurations list despite its 1/0 semantic id', () => {
    expect(result.warnings).toEqual([])
    expect(result.mappings).toHaveLength(5)
  })

  it('names each route by its display name', () => {
    expect(result.mappings.map(mapping => mapping.name)).toEqual([
      'StationState',
      'Halt',
      'Occupy',
      'Release',
      'Stoppering',
    ])
  })

  it('gives every route and its transformation blob a repository path under the list', () => {
    for (const mapping of result.mappings) {
      expect(mapping.path).toMatch(/MappingConfigurations\[\d+\]$/)
      expect(mapping.request.path).toMatch(/MappingConfigurations\[\d+\]\.Transformation$/)
    }
  })
})

describeFixtures('parseAimcRoute (stoppering)', () => {
  if (skipWithoutFixtures()) {
    return
  }
  const items = routeItems(loadCase('stoppering').aimc)
  const haltIndex = parseAimc(loadCase('stoppering').aimc).mappings.findIndex(mapping => mapping.name === 'Halt')

  it('parses a single route on its own, without the surrounding submodel', () => {
    const mqtt = parseAimcRoute(items[0], 0)
    expect(mqtt.name).toBe('StationState')
    expect(mqtt.sources.map(source => source.sourceId)).toEqual(['StationState'])
    expect(mqtt.sinks.map(sink => sink.sinkId)).toEqual(['Live'])
  })

  it('decodes the request transformation blob into Lua', () => {
    const mqtt = parseAimcRoute(items[0], 0)
    expect(mqtt.request.present).toBe(true)
    expect(mqtt.request.code).toContain('function aimc_main(sources)')
  })

  it('takes the protocol from the interface the reference names', () => {
    const [source] = parseAimcRoute(items[0], 0).sources
    expect(source!.protocol).toBe('mqtt')
    expect(source!.kind).toBe('unknown')
    expect(source!.refPath).toContain('InteractionMetadata')
  })

  it('does not mark a unidirectional data route as bi-directional', () => {
    const mqtt = parseAimcRoute(items[0], 0)
    expect(mqtt.bidirectional).toBe(false)
    expect(mqtt.response.present).toBe(false)
  })

  it('carries the raw blob element so an edit cannot drop its semanticId', () => {
    expect(parseAimcRoute(items[0], 0).request.element?.semanticId).toBeDefined()
  })

  it('defers route classification until the Operation and action targets resolve', () => {
    const halt = parseAimcRoute(items[haltIndex], haltIndex)
    expect(halt.name).toBe('Halt')
    expect(halt.kind).toBe('data')
    expect(halt.sources[0]!.refPath).toContain('Skills/Halt/operation')
    expect(halt.sinks[0]!.kind).toBe('unknown')
  })
})

describeFixtures('semantic AID reference resolution (stoppering)', () => {
  if (skipWithoutFixtures()) {
    return
  }
  const { aimc, submodels } = loadCase('stoppering')
  const items = routeItems(aimc)
  const haltIndex = parseAimc(aimc).mappings.findIndex(mapping => mapping.name === 'Halt')

  it('resolves the action ancestor and its input schema from the URL-form Submodel id', () => {
    const route = parseAimcRoute(items[haltIndex], haltIndex)
    const resolved = resolveAimcReference(route.sinks[0]!.keys, submodels)
    expect(resolved.kind).toBe('affordance')
    expect(resolved.affordancePath).toBe('actions/Halt')
    expect(resolved.direction).toBe('input')
    expect(resolved.selectedMember).toBeUndefined()
    expect(resolved.form).toBeTruthy()
  })

  it('reports unavailable references rather than grouping them as affordances', () => {
    const route = parseAimcRoute(items[haltIndex], haltIndex)
    const resolved = resolveAimcReference(route.sinks[0]!.keys, new Map())
    expect(resolved.kind).toBe('unknown')
    expect(resolved.warning).toContain('could not be loaded')
  })

  it('classifies an Operation bound to an AID action as a request/reply operation mapping', () => {
    const halt = resolveAimcMapping(parseAimcRoute(items[haltIndex], haltIndex), submodels)
    expect(halt.sources[0]!.kind).toBe('operation')
    expect(halt.kind).toBe('delegated-action')
    expect(halt.bidirectional).toBe(true)
    expect(halt.warnings).toEqual([])
  })

  it('resolves a data route to its property source and the state series it writes', () => {
    const mqtt = resolveAimcMapping(parseAimcRoute(items[0], 0), submodels)
    expect(mqtt.kind).toBe('data')
    expect(mqtt.sources[0]!.group).toBe('properties')
    expect(mqtt.sinks.map(sink => sink.kind)).toEqual(['aas-element'])
    expect(mqtt.warnings).toEqual([])
  })
})

describeFixtures('OPC UA only station (imaDispensing)', () => {
  if (skipWithoutFixtures()) {
    return
  }
  const { aimc, submodels } = loadCase('station-imaDispensing')
  const routes = parseAimc(aimc).mappings.map(route => resolveAimcMapping(route, submodels))

  it('takes the protocol from interface_opcua instead of assuming MQTT', () => {
    const state = routes[0]!
    expect(state.sources.map(source => source.sourceId)).toEqual(['State', 'ProcessQueue'])
    expect(state.sources.every(source => source.protocol === 'opcua')).toBe(true)
    expect(state.sinks.map(sink => sink.sinkId)).toEqual(['Live'])
  })

  it('resolves every route without warnings', () => {
    expect(routes.flatMap(route => route.warnings ?? [])).toEqual([])
  })

  it('indexes every endpoint with the routes that read and write it', () => {
    const index = indexEndpoints(routes)
    const state = index.find(entry => entry.label === 'State')!
    expect(state.kind).toBe('affordance')
    expect(state.group).toBe('properties')
    expect(state.origin).toBe('AssetInterfacesDescription · interface_opcua')
    // Read by the route writing the state series.
    expect(state.readers.map(use => use.endpointId)).toEqual(['State'])
    expect(state.writers).toEqual([])

    const series = index.find(entry => entry.kind === 'aas-element' && entry.writers.some(
      use => use.routeName === routes[0]!.name))!
    expect(series.label).toBe('State/Station/Segments/Live')
    expect(series.origin).toBe('Variables')

    // An action is written by its operation route.
    const halt = index.find(entry => entry.group === 'actions' && entry.label === 'Halt')!
    expect(halt.writers).toHaveLength(1)
  })

  it('gives every route the identity the DMP keys it by', () => {
    expect(routes.map(route => route.identity)).toEqual(routes.map((_, index) => `mapping_${index}`))
  })

  it('reads a per-source PollingInterval', () => {
    const weight = routes.find(route => route.sources.some(source => source.sourceId === 'Weight'))!
    expect(weight.sources[0]!.pollingInterval).toBe(0.1)
  })
})

describeFixtures('DMP extensions (projection-extensions)', () => {
  if (skipWithoutFixtures()) {
    return
  }
  const { aimc, submodels } = loadCase('projection-extensions')
  const [route] = parseAimc(aimc).mappings

  it('decodes the response blob and gives it its own path', () => {
    expect(route!.response.present).toBe(true)
    expect(route!.response.code).toContain('function aimc_main(sources)')
    expect(route!.response.path).toMatch(/MappingConfigurations\[\d+\]\.ResponseTransformation$/)
    expect(route!.request.path).not.toBe(route!.response.path)
    expect(route!.bidirectional).toBe(true)
  })

  it('makes the Operation its mapping\'s only trigger', () => {
    const resolved = resolveAimcMapping(route!, submodels)
    expect(resolved.sources[0]!.effectiveEvaluation).toBe('Operation')
    expect(resolved.sources[0]!.triggers).toBe(true)
  })

  it('warns that an Operation bound to an AAS Property is no mapping the DMP compiles', () => {
    const resolved = resolveAimcMapping(route!, submodels)
    expect(resolved.kind).toBe('data')
    expect(resolved.warnings).toEqual([
      expect.stringContaining('requires explicit ResponseSinks'),
      expect.stringContaining('binds it to an AID action or property'),
    ])
  })
})
