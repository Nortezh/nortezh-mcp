// Swagger 2.0 -> JSON Schema conversion for tool input schemas.
//
// Pure functions, no IO, so the conversion rules can be tested directly rather than
// inferred from generated output. scripts/generate.ts is the only caller.

import type { JsonSchema, SwaggerSchema } from './spec-types.js'

const REF_PREFIX = '#/definitions/'

/**
 * Swagger 2.0 emits vendor extensions describing the Go enum constants behind a field.
 * They exist for humans reading the reference UI; in a tool schema they are pure context
 * cost, and context is paid on every request.
 */
const DROPPED_KEYS = new Set(['x-enum-comments', 'x-enum-descriptions', 'x-enum-varnames'])

/** Returns the definition name behind a `#/definitions/X` ref, or null for anything else. */
export function refName(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith(REF_PREFIX)) return null
  return value.slice(REF_PREFIX.length)
}

/**
 * Rewrites a Swagger 2.0 schema fragment into the JSON Schema shape MCP clients expect:
 * `#/definitions/X` becomes `#/$defs/X`, vendor noise is dropped, and a lone
 * `allOf: [{$ref}]` wrapper is flattened.
 *
 * The flattening is worth explaining: swag wraps a property in `allOf` whenever it
 * carries both a `$ref` and a sibling like `description`, because JSON Schema draft-4
 * ignored siblings of `$ref`. Draft 2020-12 does not, so the wrapper buys nothing and
 * costs a nesting level that some clients render badly.
 */
export function convert(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(convert)
  if (node === null || typeof node !== 'object') return node

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (DROPPED_KEYS.has(key)) continue
    if (key === '$ref') {
      const name = refName(value)
      out.$ref = name === null ? value : `#/$defs/${name}`
      continue
    }
    out[key] = convert(value)
  }

  const allOf = out.allOf
  if (Array.isArray(allOf) && allOf.length === 1) {
    const only = allOf[0] as Record<string, unknown> | undefined
    if (only && typeof only.$ref === 'string' && Object.keys(only).length === 1) {
      delete out.allOf
      out.$ref = only.$ref
    }
  }

  return out
}

/**
 * Collects every definition reachable from `name` into `into`, converted.
 *
 * Each tool then carries only the types it actually uses instead of all 277 in the spec.
 * Cycle-guarded, so a definition that refers back into itself terminates rather than
 * recursing forever. (No definition in the current spec actually does — the guard is for
 * the one that eventually will.)
 *
 * Throws on a dangling ref rather than emitting a schema with an unresolvable `$ref`,
 * which a client would only discover at call time.
 */
export function collectRefs(
  name: string | null,
  definitions: Record<string, SwaggerSchema>,
  into: Map<string, JsonSchema>,
): void {
  if (name === null || into.has(name)) return

  const source = definitions[name]
  if (source === undefined) {
    throw new Error(`schema: $ref to unknown definition ${name}`)
  }
  into.set(name, convert(source) as JsonSchema)

  const stack: unknown[] = [source]
  while (stack.length > 0) {
    const node = stack.pop()
    if (Array.isArray(node)) {
      stack.push(...node)
      continue
    }
    if (node === null || typeof node !== 'object') continue
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === '$ref') {
        collectRefs(refName(value), definitions, into)
        continue
      }
      stack.push(value)
    }
  }
}

/** True when `#/$defs/<name>` appears anywhere in the inlined root or the other defs. */
function isReferenced(name: string, root: JsonSchema, defs: Map<string, JsonSchema>): boolean {
  const needle = `"#/$defs/${name}"`
  if (JSON.stringify(root.properties ?? {}).includes(needle)) return true
  for (const [key, value] of defs) {
    if (key === name) continue
    if (JSON.stringify(value).includes(needle)) return true
  }
  return false
}

/**
 * Builds a tool's `inputSchema` from the definition named by its request body.
 *
 * The root definition is inlined rather than `$ref`'d so a client that does not resolve
 * refs at the top level still sees the property names. `rootName === null` means the
 * route takes no body at all (authMe is the one in scope), which is an empty object
 * schema, not an absent one.
 */
export function buildInputSchema(
  rootName: string | null,
  definitions: Record<string, SwaggerSchema>,
): JsonSchema {
  const defs = new Map<string, JsonSchema>()
  collectRefs(rootName, definitions, defs)

  const root = (rootName === null ? {} : (defs.get(rootName) ?? {})) as JsonSchema

  // The root's properties are inlined above, so its entry in $defs is normally redundant.
  // But if anything reachable from it refers BACK to the root, dropping the entry leaves a
  // `#/$defs/<Root>` with nothing to resolve to — a schema that looks fine and breaks at
  // validation time. Keep it whenever it is actually referenced.
  if (rootName !== null && !isReferenced(rootName, root, defs)) defs.delete(rootName)

  const required = root.required
  return {
    type: 'object',
    properties: root.properties ?? {},
    ...(Array.isArray(required) && required.length > 0 ? { required } : {}),
    ...(defs.size > 0 ? { $defs: Object.fromEntries(defs) } : {}),
  }
}
