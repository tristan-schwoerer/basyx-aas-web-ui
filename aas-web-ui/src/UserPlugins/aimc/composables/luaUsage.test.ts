import { describe, expect, it } from 'vitest'
import { metaUsage, requestSourceUsage, stripLuaComments } from './luaUsage'

describe('requestSourceUsage', () => {
  it('finds no request sources without a second parameter', () => {
    expect(requestSourceUsage('function aimc_main(sources) return { State = sources.Reply.State } end')).toEqual({ kind: 'none' })
  })

  it('lists the request sources read by name, whatever the parameter is called', () => {
    const lua = `function aimc_main(sources, request)
      local reply = sources.Reply or {}
      return { Uuid = request.Uuid, Station = request["Target Station"] }
    end`
    expect(requestSourceUsage(lua)).toEqual({ kind: 'some', ids: ['Uuid', 'Target Station'] })
  })

  it('counts a parameter that is declared but never read as unused', () => {
    expect(requestSourceUsage('function aimc_main(sources, requestSources) return {} end')).toEqual({ kind: 'none' })
  })

  it('takes every request source when the table is used in a way the scan cannot follow', () => {
    expect(requestSourceUsage('function aimc_main(s, r) for k, v in pairs(r) do end return {} end')).toEqual({ kind: 'all' })
    expect(requestSourceUsage('function aimc_main(s, r) local key = "Uuid" return { Uuid = r[key] } end')).toEqual({ kind: 'all' })
  })

  it('ignores comments', () => {
    expect(requestSourceUsage('function aimc_main(s, r) -- r.Uuid is not needed\n return {} end')).toEqual({ kind: 'none' })
  })
})

describe('metaUsage', () => {
  it('lists the meta fields one level below their group', () => {
    const lua = `function aimc_main(sources, requestSources)
      local log = { Outcome = meta.invocation.outcome, DurationMs = meta.invocation.durationMs }
      if meta.sources.Reply.time then end
      return { Log = log }
    end`
    expect(metaUsage(lua)).toEqual(['invocation.outcome', 'invocation.durationMs', 'sources.Reply'])
  })

  it('is empty without meta, and says meta when the table is handed on', () => {
    expect(metaUsage('function aimc_main(sources) return sources end')).toEqual([])
    expect(metaUsage('function aimc_main(sources) return { Context = meta } end')).toEqual(['meta'])
  })

  it('strips line and block comments', () => {
    expect(stripLuaComments('a --[[ meta.x ]] b -- meta.y\nc')).toBe('a  b \nc')
  })
})
