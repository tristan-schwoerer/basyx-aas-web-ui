import { describe, expect, it } from 'vitest'
import { resolveAimcReference } from './resolveAimc'

describe('operation member references', () => {
  const operation = {
    modelType: 'Operation',
    idShort: 'invoke',
    inputVariables: [{ value: { modelType: 'Property', idShort: 'command' } }],
    outputVariables: [{ value: { modelType: 'Property', idShort: 'result' } }],
    inoutputVariables: [{ value: {
      modelType: 'SubmodelElementCollection',
      idShort: 'context',
      value: [{ modelType: 'Property', idShort: 'uuid' }],
    } }],
  }
  const submodels = new Map([['cci', { submodelElements: [operation] }]])
  const root = [{ type: 'Submodel', value: 'cci' }, { type: 'Operation', value: 'invoke' }]

  it('resolves input, output and nested inoutput variables to their owning operation', () => {
    const owner = resolveAimcReference(root, submodels)
    for (const [member, direction] of [['command', 'input'], ['result', 'output']] as const) {
      expect(resolveAimcReference([...root, { type: 'Property', value: member }], submodels)).toMatchObject({
        kind: 'operation', operationId: owner.operationId, operationPath: 'invoke', selectedMember: member, direction,
      })
    }
    expect(resolveAimcReference([
      ...root, { type: 'SubmodelElementCollection', value: 'context' }, { type: 'Property', value: 'uuid' },
    ], submodels)).toMatchObject({ kind: 'operation', operationId: owner.operationId, selectedMember: 'context/uuid', direction: 'inoutput' })
  })
})

describe('affordance identity', () => {
  it('keeps same-named actions on different interfaces separate', () => {
    const submodels = new Map([['aid', { submodelElements: ['http', 'opcua'].map(idShort => ({
      idShort,
      value: [{
        idShort: 'actions',
        semanticId: { keys: [{ value: 'https://www.w3.org/2019/wot/td#ActionAffordance' }] },
        value: [{ idShort: 'Run' }],
      }],
    })) }]])
    const endpoints = ['http', 'opcua'].map(protocol => resolveAimcReference(
      ['aid', protocol, 'actions', 'Run'].map(value => ({ type: 'SubmodelElementCollection', value })), submodels,
    ))
    expect(endpoints[0]!.kind).toBe('affordance')
    expect(endpoints[0]!.affordanceId).not.toBe(endpoints[1]!.affordanceId)
  })
})
