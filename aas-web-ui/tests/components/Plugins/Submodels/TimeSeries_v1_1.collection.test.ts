import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TimeSeries from '@/components/Plugins/Submodels/TimeSeries_v1_1.vue'

/*
 * A TimeSeries collection in aas-camel-dmp's profile: IDTA-shaped inside a submodel, Record fields named by their
 * idShortPath (the InfluxDB field), a nested group, a reference to an element elsewhere in the AAS, and a
 * LinkedSegment on the proxied InfluxDB.
 */

const { getRequestMock, postRequestMock } = vi.hoisted(() => ({ getRequestMock: vi.fn(), postRequestMock: vi.fn() }))

vi.mock('@/composables/AAS/ConceptDescriptionHandling', () => ({
  useConceptDescriptionHandling: () => ({ fetchCds: vi.fn().mockResolvedValue(undefined) }),
}))
vi.mock('@/composables/AAS/SubmodelElements/File', () => ({
  useSMEFile: () => ({ valueUrl: () => ({ url: '' }) }),
}))
vi.mock('@/composables/AAS/ReferableUtils', () => ({
  useReferableUtils: () => ({
    checkIdShort: (smc: any, idShort: string) => smc?.idShort === idShort,
    descriptionToDisplay: () => '',
    nameToDisplay: () => 'Station state',
  }),
}))
vi.mock('@/composables/RequestHandling', () => ({
  useRequestHandling: () => ({ getRequest: getRequestMock, postRequest: postRequestMock }),
}))
vi.mock('@/store/EnvironmentStore', () => ({
  useEnvStore: () => ({
    getEnvInfluxdbToken: 'browser-token',
    getEnvInfluxdbProxyOrigin: 'http://influxdb:8086',
    getEnvBasePath: '',
  }),
}))
vi.mock('@/store/NavigationStore', () => ({
  useNavigationStore: () => ({ dispatchSnackbar: vi.fn() }),
}))

const LINKED = 'https://admin-shell.io/idta/TimeSeries/Segments/LinkedSegment/1/1'

function segment (idShort: string, endpoint: string): any {
  return {
    idShort, modelType: 'SubmodelElementCollection',
    semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: LINKED }] },
    value: [
      { idShort: 'Endpoint', modelType: 'Property', value: endpoint },
      { idShort: 'Query', modelType: 'Property', value: 'from(bucket: "ap2030") |> range(start: v.timeRangeStart, stop: v.timeRangeStop) |> filter(fn: (r) => r["_field"] == "{{y-value}}")' },
    ],
  }
}

function stationState (): any {
  return {
    idShort: 'Station', modelType: 'SubmodelElementCollection',
    path: 'http://aas:8081/submodels/VmFyaWFibGVz/submodel-elements/State.Station',
    semanticId: { type: 'ExternalReference', keys: [{ type: 'GlobalReference', value: 'https://smartproductionlab.aau.dk/variables/TimeSeries/1/0' }] },
    value: [
      {
        idShort: 'Metadata', modelType: 'SubmodelElementCollection', value: [{
          idShort: 'Record', modelType: 'SubmodelElementCollection', value: [
            { idShort: 'Time', modelType: 'Property', valueType: 'xs:dateTime' },
            { idShort: 'PackMLState', modelType: 'Property', valueType: 'xs:string' },
            { idShort: 'Position', modelType: 'SubmodelElementCollection', value: [
              { idShort: 'X', modelType: 'Property', valueType: 'xs:double' },
            ] },
            { idShort: 'Tolerance', modelType: 'Range', valueType: 'xs:double' },
            { idShort: 'Batch', modelType: 'MultiLanguageProperty', value: [
              { language: 'en', text: 'Batch name' }, { language: 'de', text: 'Chargenname' },
            ] },
            { idShort: 'Report', modelType: 'File', contentType: 'application/pdf' },
            { idShort: 'Location', modelType: 'ReferenceElement', value: { type: 'ModelReference', keys: [
              { type: 'Submodel', value: 'urn:aas:Parameters' },
              { type: 'SubmodelElementCollection', value: 'Location' },
            ] } },
          ],
        }],
      },
      {
        idShort: 'Segments', modelType: 'SubmodelElementCollection', value: [
          segment('Live', 'http://influxdb:8086/api/v2/query?org=ap2030'),
          segment('Elsewhere', 'http://localhost:8086/api/v2/query?org=basyx'),
        ],
      },
    ],
  }
}

function createWrapper () {
  return mount(TimeSeries, {
    props: { submodelElementData: stationState() },
    global: { stubs: {
      'v-container': true, 'v-card': true, 'v-card-title': true, 'v-card-text': true, 'v-list': true,
      'v-list-item': true, 'v-divider': true, 'v-select': true, 'v-row': true, 'v-col': true,
      'v-text-field': true, 'v-btn': true, 'v-empty-state': true, 'AutoRefreshSelector': true,
      'TimeRangeSelector': true, 'LineChart': true, 'AreaChart': true, 'ScatterChart': true,
      'Histogram': true, 'Gauge': true, 'DisplayField': true,
    } },
  })
}

/** One point a minute ago, inside the plugin's relative "last hour". */
function csv (): string {
  const time = new Date(Date.now() - 60_000).toISOString()
  return ',result,table,_start,_stop,_time,_value,_field,_measurement,asset\n'
    + `,_result,0,${time},${time},${time},1.5,Position.X,station_state,imaDispensing\n`
}

describe('TimeSeries_v1_1.vue on a TimeSeries collection', () => {
  beforeEach(() => {
    getRequestMock.mockReset()
    getRequestMock.mockResolvedValue({ success: true, data: {
      idShort: 'Location', modelType: 'SubmodelElementCollection', value: [
        { idShort: 'x', modelType: 'Property', valueType: 'xs:double' },
        { idShort: 'Waypoints', modelType: 'SubmodelElementList', value: [
          { modelType: 'Property', valueType: 'xs:double' }, { modelType: 'Property', valueType: 'xs:double' },
        ] },
      ],
    } })
    postRequestMock.mockReset()
    postRequestMock.mockResolvedValue({ success: true, data: csv() })
  })

  it('reads a collection\'s segments and its Record, groups by their idShort path', async () => {
    const vm = createWrapper().vm as any
    await flushPromises()
    expect(vm.segments.map((s: any) => s.idShort)).toEqual(['Live', 'Elsewhere'])
    expect(vm.records.map((r: any) => r.idShort)).toEqual(
      ['Time', 'PackMLState', 'Position.X', 'Tolerance.min', 'Tolerance.max', 'Batch.en', 'Batch.de', 'Report',
        'Location.x', 'Location.Waypoints[0]', 'Location.Waypoints[1]'])
  })

  it('resolves a Record reference from the repository the TimeSeries comes from', async () => {
    createWrapper()
    await flushPromises()
    expect(getRequestMock).toHaveBeenCalledWith(
      'http://aas:8081/submodels/dXJuOmFhczpQYXJhbWV0ZXJz/submodel-elements/Location', expect.any(String), true)
  })

  it('queries a segment on the proxied InfluxDB through the Web UI, by the field\'s Column', async () => {
    const vm = createWrapper().vm as any
    await flushPromises()
    vm.selectedSegment = vm.segments[0]
    vm.timeVariable = vm.records[0]
    vm.yVariables = [vm.records[2]]
    vm.timeRangeSelection = { mode: 'relative', value: 1, unit: 'hours' }
    expect(vm.selectedSegmentProxied).toBe(true)

    vm.fetchLinkedData()
    await flushPromises()

    const [path, query, headers] = postRequestMock.mock.calls[0]
    expect(path).toBe('/api/influxdb/api/v2/query?org=ap2030')
    expect(headers.get('Authorization')).toBeNull()
    expect(query).toContain('r["_field"] == "Position.X"')
    expect(vm.timeSeriesValues[0].map((point: any) => Number(point.value))).toEqual([1.5])
  })

  it('queries any other InfluxDB directly with the browser token, as before', async () => {
    const vm = createWrapper().vm as any
    await flushPromises()
    vm.selectedSegment = vm.segments[1]
    vm.timeVariable = vm.records[0]
    vm.yVariables = [vm.records[1]]
    vm.timeRangeSelection = { mode: 'relative', value: 1, unit: 'hours' }
    expect(vm.selectedSegmentProxied).toBe(false)

    vm.fetchLinkedData()
    await flushPromises()

    const [path, query, headers] = postRequestMock.mock.calls[0]
    expect(path).toBe('http://localhost:8086/api/v2/query?org=basyx')
    expect(headers.get('Authorization')).toBe('Token browser-token')
    expect(query).toContain('r["_field"] == "PackMLState"')
  })
})
