/**
 * The DMP's view of an AIMC: whether each route compiled and is running.
 *
 * Read from the DMP's credential-free `GET /management/status` (proxied by the
 * Web UI's nginx at `<base>/api/dmp/status`, see `DMP_STATUS_URL`). The DMP
 * identifies mappings there only by SHA-256 tokens of the AIMC submodel id and
 * the mapping identity — the list item's idShort, or `mapping_<index>` — so
 * the tokens are recomputed here and matched. It reports a state and a short
 * category per mapping, not the full compile message: that comes from
 * `GET /management/mappings?aimc=<id>` (`<base>/api/dmp/mappings`), see
 * {@link fetchDmpMappings}.
 */
import { sha256Hex } from './sha256'

/** `not-deployed`: the DMP manages this AIMC but has no entry for the route. */
export type DmpRouteState = 'installed' | 'blocked' | 'stale' | 'failed' | 'removed' | 'not-deployed'

export interface DmpRouteStatus {
  state: DmpRouteState
  category: string
  /** The DMP runs an older version of the route than the repository holds. */
  outdated: boolean
  /**
   * The DMP generation of the installed version: a number from one sequence
   * shared by every bundle the DMP installs, not a per-route count. It only
   * changes when this route is reinstalled — and since the DMP swaps a route
   * within milliseconds and publishes no intermediate state, a rising
   * generation is the only visible trace of a redeploy.
   */
  generation: number
  /**
   * How often the DMP has installed this route since it started: 1 for the
   * first installation, +1 per redeploy. 0 when the DMP does not report it.
   */
  revision: number
}

export type DmpStatus
  = | {
    available: true
    /** DMP-wide state: `starting`, `ready`, `degraded`, `stopping`, `stopped` or `failed`. */
    state: string
    /** Initial repository scan done and every route reconciled; the DMP serves traffic. */
    ready: boolean
    /** Why the DMP is not ready, e.g. `repository-scan-incomplete`. */
    category: string
    converged: boolean
    /** `false` when the DMP has no mapping of this AIMC at all (outside its scope, or not discovered yet). */
    managesAimc: boolean
    /** Per route identity. */
    routes: Map<string, DmpRouteStatus>
  }
  | { available: false, reason: string }

interface StatusPayload {
  state?: string
  ready?: boolean
  category?: string
  controlCategory?: string
  converged?: boolean
  mappings?: Array<{
    aimcToken?: string
    mappingToken?: string
    state?: string
    category?: string
    generation?: number
    revision?: number
    desiredFingerprint?: string
    installedFingerprint?: string
  }>
}

const KNOWN_STATES = new Set<string>(['installed', 'blocked', 'stale', 'failed', 'removed'])

/** The identity the DMP keys a route by. */
export function dmpMappingIdentity (idShort: string | undefined, index: number): string {
  return idShort && idShort.trim() !== '' ? idShort : `mapping_${index}`
}

/** Matches a status payload to the routes of one AIMC. Pure, so it is unit tested. */
export function matchDmpStatus (payload: StatusPayload, aimcId: string, identities: string[]): DmpStatus {
  const aimcToken = sha256Hex(aimcId)
  const entries = (payload.mappings ?? []).filter(entry => entry.aimcToken === aimcToken)
  const byToken = new Map(entries.map(entry => [entry.mappingToken ?? '', entry]))
  const routes = new Map<string, DmpRouteStatus>()

  for (const identity of identities) {
    const entry = byToken.get(sha256Hex(identity))
    if (!entry) {
      routes.set(identity, { state: 'not-deployed', category: '', outdated: false, generation: 0, revision: 0 })
      continue
    }
    const state = KNOWN_STATES.has(entry.state ?? '') ? entry.state as DmpRouteState : 'failed'
    const installed = entry.installedFingerprint ?? ''
    routes.set(identity, {
      state,
      category: entry.category ?? '',
      outdated: installed !== '' && installed !== (entry.desiredFingerprint ?? ''),
      generation: typeof entry.generation === 'number' ? entry.generation : 0,
      revision: typeof entry.revision === 'number' ? entry.revision : 0,
    })
  }

  return {
    available: true,
    state: payload.state ?? 'unknown',
    ready: payload.ready === true,
    category: payload.category || payload.controlCategory || '',
    converged: payload.converged === true,
    managesAimc: entries.length > 0,
    routes,
  }
}

/**
 * Fetches and matches the DMP status; `undefined` when the Web UI has no DMP
 * status configured (`DMP_STATUS_URL` unset, the proxy answers 404), so the
 * feature stays out of sight.
 */
export async function fetchDmpStatus (url: string, aimcId: string, identities: string[]): Promise<DmpStatus | undefined> {
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
    if (response.status === 404) {
      return undefined
    }
    if (!response.ok) {
      // The proxy answers 502/504 when the DMP container is down or hangs.
      return { available: false, reason: `The DMP did not answer (HTTP ${response.status}); it is probably not running.` }
    }
    return matchDmpStatus(await response.json(), aimcId, identities)
  } catch {
    return { available: false, reason: 'The DMP could not be reached.' }
  }
}

/** A plain-language reading of a DMP status category. */
export function describeDmpCategory (category: string): string {
  if (category === '') {
    return ''
  }
  const resolution = /^mapping-resolution-(.+)$/.exec(category)
  if (resolution) {
    const reasons: Record<string, string> = {
      not_found: 'a referenced submodel or element does not exist',
      unauthorized: 'the DMP is not allowed to read a referenced submodel',
      transient_failure: 'the repository did not answer while a reference was resolved; the DMP retries',
      invalid_response: 'the repository returned an unreadable referenced submodel',
    }
    return `Not compiled: ${reasons[resolution[1]!] ?? resolution[1]!.replaceAll('_', ' ')}.`
  }
  const descriptions: Record<string, string> = {
    'invalid-desired-mapping': 'Not compiled: the route is not a valid DMP mapping (structure, references or Lua).',
    'unsupported-connector-capability': 'Not compiled: the route is valid AIMC, but the DMP has no connector for it (binding, protocol or response elements it does not support).',
    'rest-path-conflict': 'Not compiled: another route already serves the same Operation invocation path.',
    'timeseries-type-conflict': 'Not compiled: another route writes or reads the same InfluxDB field as a different type.',
    'bundle-installation-failed': 'Compiled, but starting its routes failed; the DMP retries.',
    'bundle-removal-failed': 'The previous version could not be stopped; the DMP retries.',
    'mapping-capacity-exceeded': 'The DMP has reached its mapping limit (DMP_MANAGED_MAX_MAPPINGS).',
  }
  return descriptions[category] ?? category
}

export interface DmpHealth {
  text: string
  color: string
  icon: string
  detail: string
}

/**
 * The DMP-wide state at a glance: whether it is live at all, ready, and
 * running this AIMC's routes. Shown on the route index and on every route.
 */
export function describeDmpHealth (status: DmpStatus): DmpHealth {
  if (!status.available) {
    return { text: 'offline', color: 'error', icon: 'mdi-lan-disconnect', detail: status.reason }
  }
  const reason = status.category ? ` (${status.category})` : ''
  if (status.state === 'starting') {
    return { text: 'starting', color: 'info', icon: 'mdi-progress-clock', detail: `The DMP is starting and has not finished its first repository scan${reason}.` }
  }
  if (['stopping', 'stopped', 'failed'].includes(status.state)) {
    return { text: status.state, color: 'error', icon: 'mdi-alert-octagon-outline', detail: `The DMP is ${status.state}${reason}; no route runs.` }
  }
  if (!status.ready) {
    return { text: 'degraded', color: 'warning', icon: 'mdi-alert-outline', detail: `The DMP is live but not ready${reason}; routes may lag behind the repository.` }
  }
  if (!status.managesAimc) {
    return {
      text: 'live, not managing this AIMC',
      color: 'grey',
      icon: 'mdi-transit-connection-variant',
      detail: 'The DMP is ready but reports no mapping of this AIMC: it is outside DMP_MANAGED_AIMC_IDS, or not discovered yet.',
    }
  }
  const routes = [...status.routes.values()]
  const problems = routes.filter(route => route.state !== 'installed' || route.outdated).length
  return problems === 0
    ? { text: `live · ${routes.length} running`, color: 'success', icon: 'mdi-transit-connection-variant', detail: 'The DMP is ready; every route of this AIMC is compiled and running.' }
    : { text: `live · ${problems} of ${routes.length} not running`, color: 'warning', icon: 'mdi-transit-connection-variant', detail: 'The DMP is ready, but some routes are not running as authored; hover a route\'s chip for the reason.' }
}

/** One reason a route does not run as authored, at its path within the route (`Sinks/value/1`, or empty). */
export interface DmpDiagnostic {
  path: string
  message: string
}

/** Why the DMP runs a route, or not: the named view of `/management/mappings`. */
export interface DmpRouteDetails {
  state: string
  category: string
  /** Why a compiled route failed to install, from a fixed set; empty otherwise. */
  cause: string
  diagnostics: DmpDiagnostic[]
}

interface MappingsPayload {
  mappings?: Array<{
    identity?: string
    state?: string
    category?: string
    cause?: string
    diagnostics?: Array<{ path?: string, message?: string }>
  }>
}

/** Reads the details of one AIMC's routes by identity; `undefined` when the Web UI or the DMP does not serve them. */
export async function fetchDmpMappings (url: string, aimcId: string): Promise<Map<string, DmpRouteDetails> | undefined> {
  try {
    const response = await fetch(`${url}?aimc=${encodeURIComponent(aimcId)}`,
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
    if (!response.ok) {
      return undefined
    }
    return parseDmpMappings(await response.json())
  } catch {
    return undefined
  }
}

/** Pure, so it is unit tested. */
export function parseDmpMappings (payload: MappingsPayload): Map<string, DmpRouteDetails> {
  const details = new Map<string, DmpRouteDetails>()
  for (const entry of payload.mappings ?? []) {
    if (!entry.identity) {
      continue
    }
    details.set(entry.identity, {
      state: entry.state ?? '',
      category: entry.category ?? '',
      cause: entry.cause ?? '',
      diagnostics: (entry.diagnostics ?? []).map(diagnostic => ({ path: diagnostic.path ?? '', message: diagnostic.message ?? '' })),
    })
  }
  return details
}

export type DmpEndpointCollection = 'Sources' | 'Sinks' | 'ResponseSources' | 'ResponseSinks'

const ENDPOINT_PATH = /^(Sources|Sinks|ResponseSources|ResponseSinks)\/value\/(\d+)(?:\/(.*))?$/

/** The endpoint a diagnostic concerns, and the path below it; `undefined` for one about the whole route. */
export function diagnosticEndpoint (path: string): { collection: DmpEndpointCollection, index: number, below: string } | undefined {
  const match = ENDPOINT_PATH.exec(path)
  return match ? { collection: match[1] as DmpEndpointCollection, index: Number(match[2]), below: match[3] ?? '' } : undefined
}

/** The messages about one endpoint, each prefixed with the path below it (`forms/mqv_qos: …`). */
export function diagnosticsAt (diagnostics: DmpDiagnostic[], collection: DmpEndpointCollection, index: number): string[] {
  return diagnostics.flatMap(diagnostic => {
    const endpoint = diagnosticEndpoint(diagnostic.path)
    if (!endpoint || endpoint.collection !== collection || endpoint.index !== index) {
      return []
    }
    return [endpoint.below === '' ? diagnostic.message : `${endpoint.below}: ${diagnostic.message}`]
  })
}

/** A plain-language reading of an installation cause. */
export function describeDmpCause (cause: string): string {
  const causes: Record<string, string> = {
    'multiple-consumers-unsupported': 'An endpoint of this route does not allow a second consumer, and another route already consumes it.',
    'unknown-host': 'The host of an endpoint could not be resolved.',
    'connection-refused': 'An endpoint refused the connection.',
    'timeout': 'An endpoint did not answer in time.',
    'authentication-failed': 'An endpoint rejected the credentials.',
    'endpoint-invalid': 'The DMP could not create an endpoint from the route (an invalid URI or option).',
    'unknown': 'The cause is not one the DMP recognises; the DMP log has the details.',
  }
  return cause === '' ? '' : causes[cause] ?? cause
}
