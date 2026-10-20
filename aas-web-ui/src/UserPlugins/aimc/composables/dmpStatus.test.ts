import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { describeDmpCategory, describeDmpHealth, dmpMappingIdentity, matchDmpStatus } from './dmpStatus'
import { sha256Hex } from './sha256'

const token = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')

describe('sha256Hex', () => {
  it.each([
    '',
    'abc',
    'mapping_0',
    'https://smartproductionlab.aau.dk/aas/imaDispensingSystemAAS/submodels/AssetInterfacesMappingConfiguration',
    // Lengths around the 55/56/64-byte padding boundaries, and non-ASCII.
    'a'.repeat(55),
    'a'.repeat(56),
    'a'.repeat(64),
    'ÆØÅ – ü',
  ])('matches node:crypto for %j', value => {
    expect(sha256Hex(value)).toBe(token(value))
  })
})

describe('matchDmpStatus', () => {
  const aimcId = 'https://example.test/submodels/aimc'
  const entry = (identity: string, state: string, extra: Record<string, string> = {}) => ({
    aimcToken: token(aimcId),
    mappingToken: token(identity),
    state,
    category: '',
    desiredFingerprint: 'f1',
    installedFingerprint: 'f1',
    ...extra,
  })

  it('keys the DMP entries by route identity', () => {
    const status = matchDmpStatus({
      state: 'ready',
      converged: false,
      mappings: [
        entry('mapping_0', 'installed'),
        entry('mapping_1', 'blocked', { category: 'unsupported-connector-capability', installedFingerprint: '' }),
        entry('mapping_0', 'installed', { aimcToken: token('another AIMC') }),
      ],
    }, aimcId, ['mapping_0', 'mapping_1', 'mapping_2'])

    expect(status.available).toBe(true)
    if (!status.available) {
      return
    }
    expect(status.managesAimc).toBe(true)
    expect(status.routes.get('mapping_0')).toEqual({ state: 'installed', category: '', outdated: false, generation: 0, revision: 0 })
    expect(status.routes.get('mapping_1')).toEqual({ state: 'blocked', category: 'unsupported-connector-capability', outdated: false, generation: 0, revision: 0 })
    expect(status.routes.get('mapping_2')?.state).toBe('not-deployed')
  })

  it('carries the generation and the per-route revision', () => {
    const status = matchDmpStatus({ mappings: [{ ...entry('mapping_0', 'installed'), generation: 80, revision: 3 }] }, aimcId, ['mapping_0'])
    expect(status.available && status.routes.get('mapping_0')).toMatchObject({ generation: 80, revision: 3 })
  })

  it('flags a route whose running version lags behind the repository', () => {
    const status = matchDmpStatus({ mappings: [entry('mapping_0', 'installed', { desiredFingerprint: 'f2' })] }, aimcId, ['mapping_0'])
    expect(status.available && status.routes.get('mapping_0')?.outdated).toBe(true)
  })

  it('reports an AIMC the DMP does not manage', () => {
    const status = matchDmpStatus({ mappings: [] }, aimcId, ['mapping_0'])
    expect(status.available && status.managesAimc).toBe(false)
  })
})

describe('dmpMappingIdentity', () => {
  it('uses the item idShort, else the list position, like the DMP', () => {
    expect(dmpMappingIdentity(undefined, 3)).toBe('mapping_3')
    expect(dmpMappingIdentity(' ', 3)).toBe('mapping_3')
    expect(dmpMappingIdentity('Halt', 3)).toBe('Halt')
  })
})

describe('describeDmpCategory', () => {
  it('explains known categories and keeps unknown ones verbatim', () => {
    expect(describeDmpCategory('')).toBe('')
    expect(describeDmpCategory('mapping-resolution-not_found')).toContain('does not exist')
    expect(describeDmpCategory('unsupported-connector-capability')).toContain('no connector')
    expect(describeDmpCategory('something-new')).toBe('something-new')
  })
})

describe('describeDmpHealth', () => {
  const aimcId = 'https://example.test/submodels/aimc'
  const installed = { aimcToken: token(aimcId), mappingToken: token('mapping_0'), state: 'installed' }

  it('reports a DMP that does not answer as offline', () => {
    expect(describeDmpHealth({ available: false, reason: 'HTTP 502' })).toMatchObject({ text: 'offline', color: 'error' })
  })

  it('tells starting and degraded apart from ready', () => {
    const starting = matchDmpStatus({ state: 'starting', ready: false, category: 'initial-reconciliation' }, aimcId, ['mapping_0'])
    expect(describeDmpHealth(starting)).toMatchObject({ text: 'starting', color: 'info' })
    expect(describeDmpHealth(starting).detail).toContain('initial-reconciliation')

    const degraded = matchDmpStatus({ state: 'degraded', ready: false, mappings: [installed] }, aimcId, ['mapping_0'])
    expect(describeDmpHealth(degraded)).toMatchObject({ text: 'degraded', color: 'warning' })

    const failed = matchDmpStatus({ state: 'failed', ready: false }, aimcId, ['mapping_0'])
    expect(describeDmpHealth(failed)).toMatchObject({ text: 'failed', color: 'error' })
  })

  it('summarises the routes of a ready DMP', () => {
    const ready = matchDmpStatus({ state: 'ready', ready: true, mappings: [installed] }, aimcId, ['mapping_0'])
    expect(describeDmpHealth(ready)).toMatchObject({ text: 'live · 1 running', color: 'success' })

    const partly = matchDmpStatus({ state: 'ready', ready: true, mappings: [installed] }, aimcId, ['mapping_0', 'mapping_1'])
    expect(describeDmpHealth(partly)).toMatchObject({ text: 'live · 1 of 2 not running', color: 'warning' })

    const elsewhere = matchDmpStatus({ state: 'ready', ready: true, mappings: [] }, aimcId, ['mapping_0'])
    expect(describeDmpHealth(elsewhere).text).toBe('live, not managing this AIMC')
  })
})
