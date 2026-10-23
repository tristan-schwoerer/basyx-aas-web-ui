/**
 * What a transformation's Lua reads besides its `sources`, as far as a plain
 * text scan can tell: the request sources a ResponseTransformation takes as
 * its second parameter (`aimc_main(sources, requestSources)`), and the
 * fields of the DMP's global `meta` table. Comments are ignored; anything the
 * scan cannot pin down (a computed key, the table handed on as a whole)
 * counts as using all of it.
 */

/** Which request sources the response Lua reads: none, all of them, or the listed SourceIds. */
export type RequestSourceUsage = { kind: 'none' } | { kind: 'all' } | { kind: 'some', ids: string[] }

const IDENTIFIER = String.raw`[A-Za-z_]\w*`
const ENTRYPOINT = new RegExp(String.raw`function\s+aimc_main\s*\(\s*(${IDENTIFIER})?\s*(?:,\s*(${IDENTIFIER}))?`)

/** The code without comments (`--` to the end of the line, and `--[[ ... ]]` / `--[==[ ... ]==]` blocks). */
export function stripLuaComments (code: string): string {
  return code
    .replaceAll(/--\[(=*)\[[\s\S]*?\]\1\]/g, '')
    .replaceAll(/--[^\n]*/g, '')
}

function escape (name: string): string {
  return name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

/** The fields read from table `name`: `name.key` and `name["key"]`; `undefined` when it is also used otherwise. */
function fieldsOf (code: string, name: string): string[] | undefined {
  const table = escape(name)
  const fields = new Set<string>()
  let accounted = 0
  for (const match of code.matchAll(new RegExp(String.raw`\b${table}\s*\.\s*(${IDENTIFIER})`, 'g'))) {
    fields.add(match[1]!)
    accounted++
  }
  for (const match of code.matchAll(new RegExp(String.raw`\b${table}\s*\[\s*(["'])(.*?)\1\s*\]`, 'g'))) {
    fields.add(match[2]!)
    accounted++
  }
  const uses = [...code.matchAll(new RegExp(String.raw`\b${table}\b`, 'g'))].length
  return uses === accounted ? [...fields] : undefined
}

/** The request sources a ResponseTransformation reads through its second parameter. */
export function requestSourceUsage (code: string): RequestSourceUsage {
  const lua = stripLuaComments(code)
  const parameter = ENTRYPOINT.exec(lua)?.[2]
  if (!parameter) {
    return { kind: 'none' }
  }
  // The parameter name itself appears once, in the signature.
  const body = lua.replace(ENTRYPOINT, '')
  const fields = fieldsOf(body, parameter)
  if (fields === undefined) {
    return { kind: 'all' }
  }
  return fields.length === 0 ? { kind: 'none' } : { kind: 'some', ids: fields }
}

/**
 * The `meta` fields the Lua reads, one level below `invocation`, `sources`
 * and `sinks` (`invocation.outcome`, `sources.Reply`); `['meta']` when it
 * uses the table in a way the scan cannot follow.
 */
export function metaUsage (code: string): string[] {
  const lua = stripLuaComments(code)
  if (!/\bmeta\b/.test(lua)) {
    return []
  }
  const used = new Set<string>()
  let accounted = 0
  for (const match of lua.matchAll(new RegExp(String.raw`\bmeta\s*\.\s*(${IDENTIFIER})(?:\s*\.\s*(${IDENTIFIER}))?`, 'g'))) {
    used.add(match[2] ? `${match[1]}.${match[2]}` : match[1]!)
    accounted++
  }
  const uses = [...lua.matchAll(/\bmeta\b/g)].length
  if (uses !== accounted) {
    used.add('meta')
  }
  return [...used]
}
