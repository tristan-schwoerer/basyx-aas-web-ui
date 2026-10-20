<template>
  <div
    class="aimc-graph"
    :class="{ 'aimc-graph--pending': !laidOut }"
    :style="{ height: `${graphHeight}px` }"
  >
    <VueFlow
      v-model:edges="edges"
      v-model:nodes="nodes"
      :default-edge-options="defaultEdgeOptions"
      :edges-updatable="false"
      :elements-selectable="true"
      :max-zoom="2"
      :min-zoom="0.1"
      :nodes-connectable="false"
      :nodes-draggable="false"
      @init="onInit"
      @node-click="onNodeClick"
      @pane-click="onPaneClick"
    >
      <!-- Request and response members share their owning affordance/operation frame. -->
      <template #node-aimcGroup="{ data }">
        <div
          class="aimc-group"
          :class="{ 'aimc-group--collapsed': data.members === 1 }"
        >
          <div class="aimc-group__header">
            <v-icon density="compact" size="x-small">
              {{ data.side === 'source' ? 'mdi-import' : 'mdi-export' }}
            </v-icon>

            <span class="aimc-group__label text-caption font-weight-bold" :title="data.label">{{ data.label }}</span>
            <span class="text-caption opacity-70">{{ data.members }}</span>
          </div>

          <div v-if="data.form" class="aimc-group__form">{{ data.form }}</div>

          <div
            v-for="(section, index) in data.sections"
            :key="section.label"
            class="aimc-group__section text-caption"
            :class="{ 'aimc-group__section--first': index === 0 }"
            :style="{ top: `${section.top}px` }"
          >
            {{ section.label }}
          </div>
        </div>
      </template>

      <template #node-aimcSource="{ data }">
        <AimcEndpointNode :data="data" :expanded="isExpanded(data)" />
      </template>

      <template #node-aimcSink="{ data }">
        <AimcEndpointNode :data="data" :expanded="isExpanded(data)" />
      </template>

      <template #node-aimcTransform="{ data }">
        <div
          class="aimc-node aimc-node--transform"
          :class="[
            `aimc-node--${data.direction}`,
            { 'aimc-node--selected': data.direction === direction, 'aimc-node--absent': data.absent },
          ]"
        >
          <!-- One connection point per edge, placed level with the endpoint at
               its other end (see placeHandles). The reply lane runs
               right-to-left, so its points mirror the request lane's. -->
          <Handle
            v-for="handle in data.handles"
            :id="handle.id"
            :key="handle.id"
            :position="handle.position"
            :style="{ top: handle.top }"
            :type="handle.type"
          />

          <div class="aimc-node__header">
            <v-icon density="compact" size="small">mdi-code-braces</v-icon>
            <span class="text-body-2 font-weight-bold">{{ data.label }}</span>
          </div>

          <div class="aimc-node__meta">
            <v-chip density="compact" label size="x-small" variant="tonal">
              {{ data.absent ? 'passthrough' : 'lua' }}
            </v-chip>

            <v-chip
              v-if="data.lines"
              density="compact"
              label
              size="x-small"
              variant="tonal"
            >
              {{ data.lines }} lines
            </v-chip>
          </div>

          <div class="aimc-node__path">{{ data.entrypoint }}</div>

          <v-btn
            class="aimc-node__open"
            prepend-icon="mdi-code-tags"
            size="x-small"
            variant="tonal"
            @click.stop="emit('select-direction', data.direction)"
          >
            Open editor
          </v-btn>
        </div>
      </template>

      <template #node-aimcResponseEndpoint="{ data }">
        <AimcEndpointNode :data="data" :expanded="isExpanded(data)" />
      </template>

      <Background :gap="16" pattern-color="currentColor" />
      <Controls />
    </VueFlow>
  </div>
</template>

<script lang="ts" setup>
  import type { AimcLayoutItem, AimcLayoutLane } from '../composables/layoutAimcGraph'
  import type { AimcMapping, AimcResponseEndpoint } from '../types'
  import type { AimcEndpointNodeData } from './AimcEndpointNode.vue'
  /**
   * Renders one AIMC route: sources on the left, the Lua transformation(s) in
   * the middle and sinks on the right.
   *
   * Sources and sinks that address the same AID affordance share a labelled
   * frame, so a route that fans out over several affordances stays readable.
   *
   * For a bi-directional action contract (an operation mapping, or any route
   * that authors a `ResponseTransformation`) a second, lower lane is drawn: the
   * correlated reply flows from the sink back through the response
   * transformation to the source. All connections are dashed and animated in
   * the direction of the data transfer; the forward lane additionally labels
   * each source with its delivery mode (polled or pushed).
   *
   * Nodes are placed in two passes: first with estimated heights, then — once
   * Vue Flow has measured them — with their rendered heights, so every column
   * is centered on its lane's midline (see `layoutAimcGraph`).
   */
  import type { Edge, Node } from '@vue-flow/core'
  import { Background } from '@vue-flow/background'
  import { Controls } from '@vue-flow/controls'
  import { Handle, MarkerType, Position, useVueFlow, VueFlow } from '@vue-flow/core'
  import {
    AIMC_LANE_GAP,
    AIMC_SECTION_HEIGHT,
    handleShare,
    layoutAimcGraph,
  } from '../composables/layoutAimcGraph'
  import AimcEndpointNode from './AimcEndpointNode.vue'
  import '@vue-flow/controls/dist/style.css'
  import '@vue-flow/core/dist/style.css'
  import '@vue-flow/core/dist/theme-default.css'

  const props = defineProps<{
    mapping: AimcMapping
    /** Which transformation the editor is currently showing. */
    direction: 'request' | 'response'
  }>()

  const emit = defineEmits<{
    'select-direction': [direction: 'request' | 'response']
  }>()

  // Column geometry. Nodes have a fixed width, so only the heights are measured.
  const SOURCE_X = 0
  const TRANSFORM_X = 400
  const SINK_X = 800
  const NODE_WIDTH = 250
  // Heights assumed until Vue Flow has measured the rendered nodes.
  const ESTIMATED_HEIGHT: Record<string, number> = {
    aimcSource: 72,
    aimcSink: 72,
    aimcTransform: 112,
    aimcResponseEndpoint: 54,
  }
  // The group frame carries a label strip (and optionally the form href line);
  // the first endpoint must clear it.
  const GROUP_HEADER_HEIGHT = 30
  const GROUP_FORM_HEIGHT = 16
  const GROUP_PAD_X = 16
  // The group frames are decorative backdrops; endpoints stack above them.
  const GROUP_Z = 0
  // Edges and nodes share one stacking context: edges are drawn above the
  // frames (whose tint would otherwise cover them) and below the nodes.
  const EDGE_Z = 1
  const INTERACTIVE_Z = 10
  // Frames to wait for Vue Flow to measure the nodes before falling back to the estimates.
  const MEASURE_FRAMES = 20
  // The canvas grows with the route (a fan-in of ten sources needs more room
  // than a 1:1 route), within these bounds; the vertical margin leaves room
  // for the controls and the fit padding.
  const MIN_GRAPH_HEIGHT = 280
  const MAX_GRAPH_HEIGHT = 760
  const GRAPH_MARGIN_Y = 140

  // Every connection is a dashed spline whose dashes march along the flow.
  const defaultEdgeOptions = {
    animated: true,
    type: 'smoothstep',
  }

  const nodes = ref<Node[]>([])
  const edges = ref<Edge[]>([])
  const expandedNodeId = ref('')
  // Hides the first, estimated placement until the measured one is applied.
  const laidOut = ref(false)
  const graphHeight = ref(MIN_GRAPH_HEIGHT)
  let layoutToken = 0

  const { fitView, findNode, updateNode, updateNodeInternals } = useVueFlow()

  watch(
    () => props.mapping,
    async () => {
      await applyRoute(props.mapping)
    },
    { immediate: true },
  )

  function isExpanded (data: any): boolean {
    return Boolean(data?.nodeId) && data.nodeId === expandedNodeId.value
  }

  /**
   * Delivery mode of a source, as authored on the route.
   *
   * The DMP has exactly two modes: a source is **polled** only when a positive
   * `PollingInterval` is declared (on the source, or as the route's
   * `DefaultPollingInterval`) — the sole case in which the DMP runs a timer
   * route. Everything else is **pushed**: event affordances, properties
   * declared `observable`, and anything a push protocol (MQTT) delivers on a
   * topic all arrive on their own. An explicitly declared interval overrides
   * the transport default, so a retained MQTT topic can still be sampled.
   *
   * The affordance group (`properties` / `actions` / `events`) is transport
   * metadata shown as its own chip, not a third delivery mode.
   */
  function sourceDelivery (
    source: AimcMapping['sources'][number],
    defaultPollingInterval?: number,
  ): { kind: string, text: string, color?: string } {
    if (source.resolved?.kind === 'operation') {
      return { kind: 'operation', text: '' }
    }
    const pollingInterval = source.pollingInterval ?? defaultPollingInterval
    if (pollingInterval !== undefined && pollingInterval > 0) {
      return { kind: 'polling', text: `poll ${pollingInterval}s`, color: 'info' }
    }
    return { kind: 'pushed', text: 'pushed', color: 'success' }
  }

  function endpointBadges (endpoint: AimcMapping['sources'][number] | AimcMapping['sinks'][number]): Array<{ text: string, color?: string }> {
    const badges: Array<{ text: string, color?: string }> = []
    if (endpoint.protocol) {
      badges.push({ text: endpoint.protocol.toUpperCase() })
    }
    if (endpoint.group) {
      badges.push({ text: endpoint.group })
    }
    if (endpoint.kind === 'aas-element') {
      badges.push({ text: 'AAS' })
    } else if (endpoint.kind === 'operation') {
      badges.push({ text: 'operation' })
    }
    return badges
  }

  function sourceBadges (mapping: AimcMapping, source: AimcMapping['sources'][number]): Array<{ text: string, color?: string }> {
    const badges = endpointBadges(source)
    const delivery = sourceDelivery(source, mapping.defaultPollingInterval)
    if (delivery.text) {
      badges.push({ text: delivery.text, color: delivery.color })
    }
    // Only meaningful when the route narrows its triggers.
    if (mapping.triggerSourceIds.length > 0) {
      badges.push(source.triggers ? { text: 'trigger', color: 'primary' } : { text: 'no trigger' })
    }
    if (source.kind === 'unknown') {
      badges.push({ text: 'unresolved', color: 'warning' })
    }
    return badges
  }

  function sinkBadges (sink: AimcMapping['sinks'][number]): Array<{ text: string, color?: string }> {
    const badges = endpointBadges(sink)
    if (sink.kind === 'unknown') {
      badges.push({ text: 'unresolved', color: 'warning' })
    }
    return badges
  }

  function lineCount (code: string): number {
    return code === '' ? 0 : code.split('\n').length
  }

  interface EndpointGroup {
    key: string
    label: string
    side: 'source' | 'sink'
    members: number
    form?: string
  }

  /** The frame an endpoint belongs to: the AID affordance it addresses. */
  function endpointGroup (
    endpoint: AimcMapping['sources'][number] | AimcMapping['sinks'][number] | AimcResponseEndpoint,
    side: 'source' | 'sink',
  ): Omit<EndpointGroup, 'members'> | undefined {
    const resolved = endpoint.resolved
    const identity = resolved?.affordanceId ?? resolved?.operationId
    const label = resolved?.affordancePath ?? resolved?.operationPath
    if (!identity || !label) {
      return undefined
    }
    // The interface is on every member as its protocol chip; the frame names
    // the affordance, which would otherwise be what gets cut off.
    return {
      key: `${side}::${identity}`,
      label,
      side,
      form: resolved?.form,
    }
  }

  /** A connection point of a transformation node, owned by one edge. */
  interface TransformHandle {
    id: string
    type: 'source' | 'target'
    position: Position
    /** CSS `top`; set once the nodes are placed. */
    top: string
    /** The endpoint at the edge's other end, and its handle there. */
    peer: string
    peerHandle?: string | null
  }

  interface RouteGraph {
    nodes: Node[]
    edges: Edge[]
    lanes: AimcLayoutLane[]
    /** Endpoint groups by their layout key. */
    groups: Map<string, EndpointGroup>
    /** The connected points of each source and sink, top to bottom. */
    endpointHandles: Map<string, Array<'forward' | 'reply'>>
  }

  function buildGraph (mapping: AimcMapping): RouteGraph {
    const nextNodes: Node[] = []
    const nextEdges: Edge[] = []
    const groups = new Map<string, EndpointGroup>()
    // Every node/edge id is scoped to the route. Vue Flow keys its node and edge
    // registries by id, so ids shared between routes (a plain "source-0") make
    // it re-bind an edge to the previous route's handle element, which leaves
    // the path only partially drawn after a prev/next switch.
    const requestNodeId = `${mapping.id}-request`
    const responseNodeId = `${mapping.id}-response`
    const hasExplicitReply = mapping.response.present || mapping.responseSources.length > 0 || mapping.responseSinks.length > 0
    const isOperation = mapping.kind === 'delegated-action'
    const operationIndex = mapping.sources.findIndex(source => source.resolved?.kind === 'operation')
    // An operation always answers its caller. Without a ResponseTransformation
    // the reply passes through unchanged; it is still drawn through its own
    // (passthrough) node, so it keeps to the reply lane instead of cutting
    // under the request transformation.
    const hasResponseNode = mapping.response.present || hasExplicitReply || (isOperation && operationIndex !== -1)

    const sourceColumn: AimcLayoutItem[] = []
    const sinkColumn: AimcLayoutItem[] = []
    const replyLeft: AimcLayoutItem[] = []
    const replyRight: AimcLayoutItem[] = []

    const groupOf = (
      endpoint: AimcMapping['sources'][number] | AimcMapping['sinks'][number] | AimcResponseEndpoint,
      side: 'source' | 'sink',
    ): string | undefined => {
      const group = endpointGroup(endpoint, side)
      if (!group) {
        return undefined
      }
      const existing = groups.get(group.key)
      if (existing) {
        existing.members += 1
      } else {
        groups.set(group.key, { ...group, members: 1 })
      }
      return group.key
    }

    const sectionOf = (endpoint: { resolved?: AimcResponseEndpoint['resolved'] }, reply = false): AimcLayoutItem['section'] => {
      if (endpoint.resolved?.direction === 'inoutput') {
        return 'In/Outputs'
      }
      return endpoint.resolved?.kind === 'operation' || endpoint.resolved?.affordancePath?.startsWith('actions/')
        ? (reply ? 'Outputs' : 'Inputs')
        : undefined
    }

    const pushNode = (id: string, type: string, x: number, data: Record<string, unknown>): void => {
      nextNodes.push({
        id,
        type,
        position: { x, y: 0 },
        draggable: false,
        connectable: false,
        zIndex: INTERACTIVE_Z,
        data,
      })
    }

    const replyEdge = (id: string, edge: Partial<Edge> & { source: string, target: string }): void => {
      nextEdges.push({
        id,
        class: 'aimc-edge aimc-edge--reply',
        markerEnd: MarkerType.ArrowClosed,
        ...edge,
      } as Edge)
    }

    for (const [index, source] of mapping.sources.entries()) {
      const id = `${mapping.id}-source-${index}`
      const delivery = sourceDelivery(source, mapping.defaultPollingInterval)
      sourceColumn.push({ id, group: groupOf(source, 'source'), section: sectionOf(source) })
      pushNode(id, 'aimcSource', SOURCE_X, {
        nodeId: id,
        role: 'source',
        label: source.sourceId || `source_${index}`,
        kind: source.kind,
        deliveryKind: delivery.kind,
        badges: sourceBadges(mapping, source),
        member: source.resolved?.selectedMember,
        keys: source.keys,
        handles: [],
      } satisfies AimcEndpointNodeData)
      nextEdges.push({
        id: `${id}-to-request`,
        source: id,
        target: requestNodeId,
        sourceHandle: 'forward',
        targetHandle: null,
        // A source outside the trigger selection is read, but does not run the mapping.
        animated: source.triggers,
        label: [source.sourceId, delivery.text].filter(Boolean).join(' · '),
        class: 'aimc-edge',
        markerEnd: MarkerType.ArrowClosed,
      })
      if (hasResponseNode && !hasExplicitReply && (!isOperation || index === operationIndex)) {
        replyEdge(`${responseNodeId}-to-${id}`, {
          source: responseNodeId,
          target: id,
          sourceHandle: null,
          targetHandle: 'reply',
        })
      }
    }

    for (const [index, sink] of mapping.sinks.entries()) {
      const id = `${mapping.id}-sink-${index}`
      sinkColumn.push({ id, group: groupOf(sink, 'sink'), section: sectionOf(sink) })
      pushNode(id, 'aimcSink', SINK_X, {
        nodeId: id,
        role: 'sink',
        label: sink.sinkId || `sink_${index}`,
        kind: sink.kind,
        deliveryKind: 'sink',
        badges: sinkBadges(sink),
        member: sink.resolved?.selectedMember,
        keys: sink.keys,
        handles: [],
      } satisfies AimcEndpointNodeData)
      nextEdges.push({
        id: `${requestNodeId}-to-${id}`,
        source: requestNodeId,
        target: id,
        sourceHandle: null,
        targetHandle: 'forward',
        label: sink.sinkId || undefined,
        class: 'aimc-edge',
        markerEnd: MarkerType.ArrowClosed,
      })
      const answersCaller = isOperation && sink.kind === 'affordance'
      if (hasResponseNode && !hasExplicitReply && (!isOperation || answersCaller)) {
        replyEdge(`${id}-to-response`, {
          source: id,
          target: responseNodeId,
          sourceHandle: 'reply',
          targetHandle: null,
        })
      }
    }

    if (hasExplicitReply) {
      for (const [index, endpoint] of mapping.responseSources.entries()) {
        const id = `${mapping.id}-response-source-${index}`
        replyRight.push({ id, group: groupOf(endpoint, 'sink'), section: sectionOf(endpoint, true) })
        pushNode(id, 'aimcResponseEndpoint', SINK_X, {
          nodeId: id,
          role: 'sink',
          label: endpoint.id || `response source ${index + 1}`,
          kind: endpoint.resolved?.kind ?? 'unknown',
          deliveryKind: 'response',
          badges: [{ text: 'response source' }],
          member: endpoint.resolved?.selectedMember ?? endpoint.refPath,
          keys: endpoint.keys,
          handles: ['reply'],
        } satisfies AimcEndpointNodeData)
        replyEdge(`${id}-to-response`, { source: id, sourceHandle: 'reply', target: responseNodeId, targetHandle: null, label: endpoint.id })
      }

      if (mapping.responseSources.length === 0 && operationIndex !== -1) {
        for (const [index, sink] of mapping.sinks.entries()) {
          if (sink.kind === 'affordance') {
            const id = `${mapping.id}-sink-${index}`
            replyEdge(`${id}-to-response`, { source: id, sourceHandle: 'reply', target: responseNodeId, targetHandle: null })
          }
        }
      }

      for (const [index, endpoint] of mapping.responseSinks.entries()) {
        // An InOut variable is one endpoint, used in both directions. Keep its
        // two handles on the same node instead of duplicating the variable.
        const sharedIndex = endpoint.resolved?.direction === 'inoutput'
          ? mapping.sources.findIndex(source => source.resolved?.direction === 'inoutput'
            && source.resolved.operationId === endpoint.resolved?.operationId
            && source.resolved.selectedMember === endpoint.resolved?.selectedMember)
          : -1
        if (sharedIndex !== -1) {
          replyEdge(`${responseNodeId}-to-inoutput-${index}`, {
            source: responseNodeId,
            target: `${mapping.id}-source-${sharedIndex}`,
            sourceHandle: null,
            targetHandle: 'reply',
            label: endpoint.id,
          })
          continue
        }
        const id = `${mapping.id}-response-sink-${index}`
        replyLeft.push({ id, group: groupOf(endpoint, 'source'), section: sectionOf(endpoint, true) })
        pushNode(id, 'aimcResponseEndpoint', SOURCE_X, {
          nodeId: id,
          role: 'source',
          label: endpoint.id || `response sink ${index + 1}`,
          kind: endpoint.resolved?.kind ?? 'unknown',
          deliveryKind: 'response',
          badges: [{ text: 'response sink' }],
          member: endpoint.resolved?.selectedMember ?? endpoint.resolved?.operationPath ?? endpoint.refPath,
          keys: endpoint.keys,
          handles: ['reply'],
        } satisfies AimcEndpointNodeData)
        replyEdge(`${responseNodeId}-to-${id}`, { source: responseNodeId, target: id, targetHandle: 'reply', sourceHandle: null, label: endpoint.id })
      }
    }

    // Each source and sink draws only the points its edges use, request first.
    const endpointHandles = new Map<string, Array<'forward' | 'reply'>>()
    for (const node of nextNodes) {
      if (['aimcSource', 'aimcSink', 'aimcResponseEndpoint'].includes(node.type ?? '')) {
        const used = (['forward', 'reply'] as const).filter(handle => nextEdges.some(edge =>
          (edge.source === node.id && edge.sourceHandle === handle) || (edge.target === node.id && edge.targetHandle === handle)))
        endpointHandles.set(node.id, used)
        node.data.handles = used
      }
    }

    const handles = transformHandles(nextEdges, requestNodeId, responseNodeId)
    for (const edge of nextEdges) {
      edge.zIndex = EDGE_Z
    }

    pushNode(requestNodeId, 'aimcTransform', TRANSFORM_X, {
      handles: handles.get(requestNodeId) ?? [],
      direction: 'request',
      label: 'Transformation',
      entrypoint: 'aimc_main(sources)',
      absent: !mapping.request.present || mapping.request.code === '',
      lines: lineCount(mapping.request.code),
    })
    if (hasResponseNode) {
      pushNode(responseNodeId, 'aimcTransform', TRANSFORM_X, {
        handles: handles.get(responseNodeId) ?? [],
        direction: 'response',
        label: 'ResponseTransformation',
        entrypoint: 'aimc_main(sources)',
        absent: !mapping.response.present || mapping.response.code === '',
        lines: lineCount(mapping.response.code),
      })
    }

    for (const group of groups.values()) {
      nextNodes.unshift({
        id: `${mapping.id}-group-${group.key}`,
        type: 'aimcGroup',
        position: { x: (group.side === 'source' ? SOURCE_X : SINK_X) - GROUP_PAD_X, y: 0 },
        draggable: false,
        selectable: false,
        connectable: false,
        zIndex: GROUP_Z,
        style: { width: `${NODE_WIDTH + 2 * GROUP_PAD_X}px` },
        data: { groupKey: group.key, side: group.side, label: group.label, members: group.members, form: group.form },
      })
    }

    // One lane: every column is centered on the same midline, so a source
    // and sink that serve both directions sit level with the middle of the
    // Transformation / ResponseTransformation pair. The reply part of each
    // column follows its request part after the lane gap.
    // A reply member that shares a request frame fills that frame's output
    // section; the first one that starts a frame of its own is set apart by
    // the lane gap.
    const replyPart = (request: AimcLayoutItem[], items: AimcLayoutItem[]): AimcLayoutItem[] => {
      const requestGroups = new Set(request.map(item => item.group).filter(Boolean))
      const own = items.findIndex(item => !item.group || !requestGroups.has(item.group))
      return items.map((item, index) => (index === own ? { ...item, gapBefore: AIMC_LANE_GAP } : item))
    }
    const middle: AimcLayoutItem[] = [{ id: requestNodeId }]
    if (hasResponseNode) {
      middle.push({ id: responseNodeId, gapBefore: AIMC_LANE_GAP })
    }
    const lanes: AimcLayoutLane[] = [[
      [...sourceColumn, ...replyPart(sourceColumn, replyLeft)],
      middle,
      [...sinkColumn, ...replyPart(sinkColumn, replyRight)],
    ]]
    return { nodes: nextNodes, edges: nextEdges, lanes, groups, endpointHandles }
  }

  /**
   * Gives every edge that meets a transformation its own connection point
   * there, and points the edge at it. In the request lane edges enter on the
   * left and leave on the right; the reply lane is mirrored.
   */
  function transformHandles (edges: Edge[], requestNodeId: string, responseNodeId: string): Map<string, TransformHandle[]> {
    const handles = new Map<string, TransformHandle[]>([[requestNodeId, []], [responseNodeId, []]])
    for (const edge of edges) {
      const entering = handles.get(edge.target)
      if (entering) {
        const id = `in-${edge.id}`
        entering.push({
          id,
          type: 'target',
          position: edge.target === requestNodeId ? Position.Left : Position.Right,
          top: '50%',
          peer: edge.source,
          peerHandle: edge.sourceHandle,
        })
        edge.targetHandle = id
      }
      const leaving = handles.get(edge.source)
      if (leaving) {
        const id = `out-${edge.id}`
        leaving.push({
          id,
          type: 'source',
          position: edge.source === requestNodeId ? Position.Right : Position.Left,
          top: '50%',
          peer: edge.target,
          peerHandle: edge.targetHandle,
        })
        edge.sourceHandle = id
      }
    }
    return handles
  }

  /** Where an edge meets the node at its other end, as a share of that node's height. */
  function peerShare (graph: RouteGraph, peer: string, peerHandle: string | null | undefined): number {
    const handles = graph.endpointHandles.get(peer) ?? []
    const rank = handles.indexOf(peerHandle as 'forward' | 'reply')
    // Response endpoints have a single point, in the middle.
    return rank === -1 ? 0.5 : handleShare(rank, handles.length)
  }

  /**
   * Spaces each transformation's connection points evenly per side, like
   * every other node, ordered by the height of the node at the other end so
   * that the edges do not cross.
   */
  function placeHandles (graph: RouteGraph, top: Map<string, number>, heightOf: (id: string) => number): void {
    const level = (handle: TransformHandle): number =>
      (top.get(handle.peer) ?? 0) + heightOf(handle.peer) * peerShare(graph, handle.peer, handle.peerHandle)
    for (const node of graph.nodes) {
      if (node.type !== 'aimcTransform') {
        continue
      }
      const handles: TransformHandle[] = node.data.handles
      const placed = new Map<string, string>()
      for (const position of [Position.Left, Position.Right]) {
        const side = handles
          .filter(handle => handle.position === position)
          .toSorted((a, b) => level(a) - level(b))
        for (const [rank, handle] of side.entries()) {
          placed.set(handle.id, `${handleShare(rank, side.length) * 100}%`)
        }
      }
      updateNode(node.id, {
        data: { ...node.data, handles: handles.map(handle => ({ ...handle, top: placed.get(handle.id) ?? '50%' })) },
      })
    }
  }

  /** Places every node of the route for the given node heights. */
  function placeNodes (graph: RouteGraph, heightOf: (id: string) => number): void {
    const layout = layoutAimcGraph(
      graph.lanes,
      heightOf,
      key => GROUP_HEADER_HEIGHT + (graph.groups.get(key)?.form ? GROUP_FORM_HEIGHT : 0),
    )
    graphHeight.value = Math.min(MAX_GRAPH_HEIGHT, Math.max(MIN_GRAPH_HEIGHT, Math.round(layout.height + GRAPH_MARGIN_Y)))
    for (const node of graph.nodes) {
      if (node.type === 'aimcGroup') {
        const frame = layout.frames.get(node.data.groupKey)
        if (frame) {
          const sections = new Map<string, number>()
          for (const item of graph.lanes.flatMap(lane => lane.flat())) {
            if (item.group === node.data.groupKey && item.section && !sections.has(item.section)) {
              sections.set(item.section, layout.top.get(item.id)! - frame.top - AIMC_SECTION_HEIGHT)
            }
          }
          updateNode(node.id, {
            position: { x: node.position.x, y: frame.top },
            style: { width: `${NODE_WIDTH + 2 * GROUP_PAD_X}px`, height: `${frame.height}px` },
            data: { ...node.data, sections: [...sections].map(([label, top]) => ({ label, top })).toSorted((a, b) => a.top - b.top) },
          })
        }
        continue
      }
      const top = layout.top.get(node.id)
      if (top !== undefined) {
        updateNode(node.id, { position: { x: node.position.x, y: top } })
      }
    }
    placeHandles(graph, layout.top, heightOf)
  }

  function estimatedHeightOf (graph: RouteGraph): (id: string) => number {
    const types = new Map(graph.nodes.map(node => [node.id, node.type ?? '']))
    return id => ESTIMATED_HEIGHT[types.get(id) ?? ''] ?? 72
  }

  /**
   * Waits until Vue Flow has measured the given nodes and returns their
   * heights; falls back to the estimates if the graph is not rendered (e.g.
   * inside a hidden container) and the nodes never get a size.
   */
  async function measuredHeightOf (graph: RouteGraph, token: number): Promise<((id: string) => number) | undefined> {
    const ids = graph.lanes.flatMap(lane => lane.flat()).map(item => item.id)
    const estimate = estimatedHeightOf(graph)
    for (let frame = 0; frame < MEASURE_FRAMES; frame++) {
      if (token !== layoutToken) {
        return undefined
      }
      const heights = new Map(ids.map(id => [id, findNode(id)?.dimensions.height ?? 0]))
      if ([...heights.values()].every(height => height > 0)) {
        return id => heights.get(id) ?? estimate(id)
      }
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
    return token === layoutToken ? estimate : undefined
  }

  /**
   * A single route always fits the viewport, so the graph is framed as a whole
   * rather than per route.
   */
  async function fitAll (): Promise<void> {
    await fitView({ padding: 0.18, maxZoom: 1.2, duration: 250 })
  }

  /**
   * Swaps the graph over in phases: nodes first (placed with estimated
   * heights), then — once Vue Flow has measured them — the final placement,
   * and the edges last, when the handles exist where they will stay.
   * Committing edges in the same tick as their nodes lets Vue Flow resolve an
   * edge against a handle it has not measured yet, which draws only part of
   * the spline.
   */
  async function applyRoute (mapping: AimcMapping): Promise<void> {
    const token = ++layoutToken
    const graph = buildGraph(mapping)
    expandedNodeId.value = ''
    laidOut.value = false
    // The previous route's edges go first so no stale path is bound to the new
    // node ids while the new ones are still unmeasured.
    edges.value = []
    nodes.value = graph.nodes
    await nextTick()
    placeNodes(graph, estimatedHeightOf(graph))

    const heightOf = await measuredHeightOf(graph, token)
    if (!heightOf) {
      return
    }
    placeNodes(graph, heightOf)
    await nextTick()
    // The transformations' connection points moved; Vue Flow re-reads their
    // positions before any edge is bound to them.
    updateNodeInternals(graph.nodes.filter(node => node.type === 'aimcTransform').map(node => node.id))
    await nextTick()
    edges.value = graph.edges
    await nextTick()
    // The canvas height may just have changed; let Vue Flow observe the new
    // size before framing the route in it.
    await new Promise(resolve => requestAnimationFrame(resolve))
    if (token !== layoutToken) {
      return
    }
    await fitAll()
    laidOut.value = true
  }

  function onInit (): void {
    void nextTick().then(fitAll)
  }

  function onNodeClick (event: { node: Node }): void {
    const data = event.node.data as any
    if (event.node.type === 'aimcTransform') {
      emit('select-direction', data.direction)
      return
    }
    if (!data?.nodeId) {
      return
    }
    // Endpoint nodes toggle their reference detail; a second click collapses it.
    expandedNodeId.value = expandedNodeId.value === data.nodeId ? '' : data.nodeId
  }

  function onPaneClick (): void {
    expandedNodeId.value = ''
  }
</script>

<style scoped>
  .aimc-graph {
    min-width: 0;
    transition: opacity 120ms ease-out;
  }

  /* Nodes still render (so they can be measured), just not visibly. */
  .aimc-graph--pending {
    opacity: 0;
  }

  /* Origin frame around the endpoints of one affordance. It sits behind the
     endpoint nodes, so it must not swallow their pointer events. */
  .aimc-group {
    position: relative;
    height: 100%;
    width: 100%;
    border-radius: 16px;
    border: 1px solid rgba(128, 128, 128, 0.28);
    background: rgba(128, 128, 128, 0.05);
    pointer-events: none;
  }

  .aimc-group--collapsed {
    border-style: dotted;
    opacity: 0.75;
  }

  .aimc-group__header {
    position: absolute;
    top: 0;
    left: 12px;
    max-width: calc(100% - 24px);
    height: 22px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    border-radius: 0 0 8px 8px;
    background: rgba(128, 128, 128, 0.18);
    overflow: hidden;
    white-space: nowrap;
  }

  .aimc-group__label {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .aimc-group__form {
    position: absolute;
    top: 26px;
    left: 12px;
    max-width: calc(100% - 24px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: monospace;
    font-size: 10px;
    opacity: 0.72;
  }

  .aimc-group__section {
    position: absolute;
    left: 12px;
    right: 12px;
    border-top: 1px solid rgba(128, 128, 128, 0.28);
    padding-top: 2px;
    opacity: 0.75;
  }

  /* Separation lines go between sections only. */
  .aimc-group__section--first {
    border-top: none;
  }

  .aimc-node {
    border-radius: 14px;
    border: 1px solid rgba(128, 128, 128, 0.5);
    background: rgb(var(--v-theme-surface));
    padding: 6px 10px;
    width: 250px;
  }

  .aimc-node--selected {
    border-color: rgb(var(--v-theme-primary));
    box-shadow: 0 0 0 1px rgb(var(--v-theme-primary));
  }

  .aimc-node--response {
    border-style: dashed;
    border-color: rgb(var(--v-theme-secondary));
  }

  .aimc-node--absent {
    opacity: 0.65;
  }

  .aimc-node__header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .aimc-node__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }

  .aimc-node__path {
    margin-top: 4px;
    font-family: monospace;
    font-size: 11px;
    opacity: 0.7;
    overflow-wrap: anywhere;
  }

  .aimc-node__open {
    margin-top: 6px;
  }

  /* Dashed, marching splines. The reply lane keeps a coarser dash so the two
     directions stay distinguishable at a glance. */
  :deep(.aimc-edge .vue-flow__edge-path) {
    stroke-dasharray: 7 5;
    stroke-width: 1.75;
  }

  :deep(.aimc-edge--reply .vue-flow__edge-path) {
    stroke-dasharray: 3 5;
    stroke-width: 1.5;
  }

  :deep(.aimc-edge .vue-flow__edge-text) {
    font-size: 10px;
  }
</style>
