import type { AimcMapping } from '../types'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAimcRoute } from '../composables/parseAimc'
import AimcMappingGraph from './AimcMappingGraph.vue'

const { updateNode } = vi.hoisted(() => ({ updateNode: vi.fn() }))
vi.mock('@vue-flow/core', () => ({
  Position: { Left: 'left', Right: 'right' },
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Handle: { template: '<div />' },
  VueFlow: { name: 'VueFlow', props: ['nodes', 'edges'], template: '<div />' },
  useVueFlow: () => ({
    fitView: vi.fn(), updateNode, updateNodeInternals: vi.fn(),
    findNode: () => ({ dimensions: { height: 72 } }),
  }),
}))

function mapping (): AimcMapping {
  const route = parseAimcRoute({ value: [] }, 0)
  const operation = { kind: 'operation' as const, operationId: 'cci/Run', operationPath: 'Skills/Run/operation' }
  const action = { kind: 'affordance' as const, affordanceId: 'aid/Run', affordancePath: 'actions/Run' }
  const common = { keys: [], refPath: '', submodelId: '', protocol: '' }
  return {
    ...route,
    kind: 'delegated-action',
    bidirectional: true,
    response: { ...route.response, present: true },
    sources: [{ ...common, sourceId: 'command', kind: 'operation', triggers: true, resolved: { ...operation, selectedMember: 'command' } }],
    sinks: [{ ...common, sinkId: 'command', kind: 'affordance', resolved: { ...action, selectedMember: 'input/command' } }],
    responseSources: [{ ...common, id: 'result', resolved: { ...action, selectedMember: 'output/result' } }],
    responseSinks: [{ ...common, id: 'result', resolved: { ...operation, selectedMember: 'result' } }],
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('AIMC request/reply graph', () => {
  it('groups both directions by owner and connects the response to the explicit output variable', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      callback()
      return 0
    })
    const wrapper = shallowMount(AimcMappingGraph, { props: { mapping: mapping(), direction: 'request' } })
    await flushPromises()
    const graph = wrapper.findComponent({ name: 'VueFlow' })
    const nodes = graph.props('nodes')
    const groups = nodes.filter((node: any) => node.type === 'aimcGroup')
    expect(groups).toHaveLength(2)
    expect(groups.map((node: any) => node.data.members)).toEqual([2, 2])
    for (const group of groups) {
      const placed = updateNode.mock.calls.findLast(([id]) => id === group.id)![1]
      expect(placed.data.sections.map((section: any) => section.label)).toEqual(['Inputs', 'Outputs'])
    }
    const edges = graph.props('edges')
    const reply = edges.filter((edge: any) => edge.source.endsWith('-response'))
    expect(reply).toHaveLength(1)
    expect(reply[0].target).toBe('mapping_0-response-sink-0')
    expect(reply[0].targetHandle).toBe('reply')
    expect(nodes.find((node: any) => node.id === reply[0].target).data.member).toBe('result')
    wrapper.unmount()
  })

  it('does not invent an output or caller edge when a response transform has no declared sinks', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      callback()
      return 0
    })
    const route = mapping()
    route.responseSinks = []
    const wrapper = shallowMount(AimcMappingGraph, { props: { mapping: route, direction: 'response' } })
    await flushPromises()
    expect(wrapper.findComponent({ name: 'VueFlow' }).props('edges')
      .filter((edge: any) => edge.source.endsWith('-response'))).toEqual([])
    wrapper.unmount()
  })

  it('keeps multiple input and output members in the same two owner frames', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      callback()
      return 0
    })
    const route = mapping()
    route.sources.push({ ...route.sources[0]!, sourceId: 'uuid' })
    route.sinks.push({ ...route.sinks[0]!, sinkId: 'uuid' })
    route.responseSources.push({ ...route.responseSources[0]!, id: 'status' })
    route.responseSinks.push({ ...route.responseSinks[0]!, id: 'status' })
    const wrapper = shallowMount(AimcMappingGraph, { props: { mapping: route, direction: 'request' } })
    await flushPromises()
    const graph = wrapper.findComponent({ name: 'VueFlow' })
    expect(graph.props('nodes').filter((node: any) => node.type === 'aimcGroup')
      .map((node: any) => node.data.members)).toEqual([4, 4])
    expect(graph.props('edges').filter((edge: any) => edge.source.endsWith('-response'))
      .map((edge: any) => edge.target)).toEqual(['mapping_0-response-sink-0', 'mapping_0-response-sink-1'])
    wrapper.unmount()
  })

  it('renders an InOut variable once between inputs and outputs, with one handle per direction', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      callback()
      return 0
    })
    const route = mapping()
    const source = route.sources[0]!
    const resolved = { ...source.resolved!, direction: 'inoutput' as const, selectedMember: 'context' }
    route.sources.unshift({ ...source, sourceId: 'context', resolved })
    route.responseSinks.push({ ...route.responseSinks[0]!, id: 'updatedContext', resolved })
    const wrapper = shallowMount(AimcMappingGraph, { props: { mapping: route, direction: 'request' } })
    await flushPromises()
    const graph = wrapper.findComponent({ name: 'VueFlow' })
    const nodes = graph.props('nodes')
    const inoutputs = nodes.filter((node: any) => node.data.member === 'context')
    expect(inoutputs).toHaveLength(1)
    expect(inoutputs[0].data.handles).toEqual(['forward', 'reply'])
    const operation = nodes.find((node: any) => node.type === 'aimcGroup' && node.data.side === 'source')
    expect(operation.data.members).toBe(3)
    const placed = updateNode.mock.calls.findLast(([id]) => id === operation.id)![1]
    expect(placed.data.sections.map((section: any) => section.label)).toEqual(['Inputs', 'In/Outputs', 'Outputs'])
    expect(graph.props('edges')).toContainEqual(expect.objectContaining({
      source: 'mapping_0-response', target: inoutputs[0].id, targetHandle: 'reply', label: 'response sink',
    }))
    expect(graph.props('edges')).toContainEqual(expect.objectContaining({
      source: inoutputs[0].id, sourceHandle: 'forward', target: 'mapping_0-request',
    }))
    wrapper.unmount()
  })

  it('labels each edge with its role and draws what the response Lua reads besides its sources', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      callback()
      return 0
    })
    const route = mapping()
    route.sinks[0]!.resolved = { ...route.sinks[0]!.resolved!, direction: 'input' }
    route.response = { ...route.response, code: `function aimc_main(sources, requestSources)
      return { result = sources.result, Log = { Uuid = requestSources.command, Outcome = meta.invocation.outcome } }
    end` }
    const wrapper = shallowMount(AimcMappingGraph, { props: { mapping: route, direction: 'request' } })
    await flushPromises()
    const graph = wrapper.findComponent({ name: 'VueFlow' })
    const edges = graph.props('edges')
    const labelOf = (source: string, target: string): string | undefined =>
      edges.find((edge: any) => edge.source === source && edge.target === target)?.label
    expect(labelOf('mapping_0-source-0', 'mapping_0-request')).toBe('request source')
    expect(labelOf('mapping_0-request', 'mapping_0-sink-0')).toBe('request sink')
    expect(labelOf('mapping_0-response-source-0', 'mapping_0-response')).toBe('response source')

    // requestSources.command: the request source feeds the response, entering from the left.
    const context = edges.find((edge: any) => edge.source === 'mapping_0-source-0' && edge.target === 'mapping_0-response')
    expect(context.label).toBe('requestSources')
    const nodes = graph.props('nodes')
    const response = nodes.find((node: any) => node.id === 'mapping_0-response')
    expect(response.data.entrypoint).toBe('aimc_main(sources, requestSources)')
    expect(response.data.handles.find((handle: any) => handle.id === context.targetHandle).position).toBe('left')

    // meta.invocation.outcome: a meta node feeds the response only.
    const meta = nodes.find((node: any) => node.id === 'mapping_0-meta')
    expect(meta.data.member).toBe('invocation.outcome')
    expect(labelOf('mapping_0-meta', 'mapping_0-response')).toBe('meta')
    expect(labelOf('mapping_0-meta', 'mapping_0-request')).toBeUndefined()

    // The node says what the endpoint addresses; the edge says its role.
    const sink = nodes.find((node: any) => node.id === 'mapping_0-sink-0')
    expect(sink.data.badges.map((badge: any) => badge.text)).toContain('action input')
    wrapper.unmount()
  })
})
