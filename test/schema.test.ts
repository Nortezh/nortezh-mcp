import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildInputSchema, collectRefs, convert, refName } from '../src/schema.js'
import type { JsonSchema, SwaggerSchema } from '../src/spec-types.js'

test('refs are rewritten from definitions to $defs', () => {
  assert.equal(refName('#/definitions/api_disk.Item'), 'api_disk.Item')
  assert.equal(refName('#/$defs/x'), null)
  assert.deepEqual(convert({ $ref: '#/definitions/api_disk.Item' }), {
    $ref: '#/$defs/api_disk.Item',
  })
})

test('enum vendor extensions are dropped', () => {
  const converted = convert({
    type: 'string',
    enum: ['a', 'b'],
    'x-enum-varnames': ['A', 'B'],
    'x-enum-comments': { A: 'first' },
    'x-enum-descriptions': ['first'],
  }) as JsonSchema
  assert.deepEqual(converted, { type: 'string', enum: ['a', 'b'] })
})

test('a lone allOf $ref wrapper is flattened', () => {
  const converted = convert({
    description: 'the spec',
    allOf: [{ $ref: '#/definitions/api_deployment.Spec' }],
  }) as JsonSchema
  assert.deepEqual(converted, {
    description: 'the spec',
    $ref: '#/$defs/api_deployment.Spec',
  })
})

test('an allOf with more than a bare $ref is left alone', () => {
  const converted = convert({
    allOf: [{ $ref: '#/definitions/A' }, { type: 'object' }],
  }) as JsonSchema
  assert.deepEqual(converted, {
    allOf: [{ $ref: '#/$defs/A' }, { type: 'object' }],
  })
})

test('collectRefs follows nested and array refs', () => {
  const definitions: Record<string, SwaggerSchema> = {
    Root: {
      type: 'object',
      properties: {
        child: { $ref: '#/definitions/Child' },
        many: { type: 'array', items: { $ref: '#/definitions/Leaf' } },
      },
    },
    Child: { type: 'object', properties: { leaf: { $ref: '#/definitions/Leaf' } } },
    Leaf: { type: 'string' },
    Unused: { type: 'string' },
  }
  const into = new Map<string, JsonSchema>()
  collectRefs('Root', definitions, into)
  assert.deepEqual([...into.keys()].sort(), ['Child', 'Leaf', 'Root'])
})

test('collectRefs terminates on a self-referential definition', () => {
  const definitions: Record<string, SwaggerSchema> = {
    Node: { type: 'object', properties: { next: { $ref: '#/definitions/Node' } } },
  }
  const into = new Map<string, JsonSchema>()
  collectRefs('Node', definitions, into)
  assert.deepEqual([...into.keys()], ['Node'])
})

test('a dangling ref fails loudly rather than emitting an unresolvable schema', () => {
  const definitions: Record<string, SwaggerSchema> = {
    Root: { type: 'object', properties: { gone: { $ref: '#/definitions/Missing' } } },
  }
  assert.throws(
    () => collectRefs('Root', definitions, new Map()),
    /unknown definition Missing/,
  )
})

test('buildInputSchema inlines the root and $defs the rest', () => {
  const definitions: Record<string, SwaggerSchema> = {
    Params: {
      type: 'object',
      required: ['project'],
      properties: {
        project: { type: 'string' },
        page: { $ref: '#/definitions/Paginate' },
      },
    },
    Paginate: { type: 'object', properties: { page: { type: 'integer' } } },
  }
  const schema = buildInputSchema('Params', definitions)
  assert.equal(schema.type, 'object')
  assert.deepEqual(schema.required, ['project'])
  assert.deepEqual(Object.keys(schema.properties as object), ['project', 'page'])
  assert.deepEqual(Object.keys(schema.$defs as object), ['Paginate'])
})

test('a route with no body gets an empty object schema, not a missing one', () => {
  // authMe is the one such route in the allowlist.
  assert.deepEqual(buildInputSchema(null, {}), { type: 'object', properties: {} })
})

test('required is omitted rather than emitted empty', () => {
  // deployment.list and domain.get genuinely enforce nothing; claiming a required field
  // would make a generated client reject calls the API accepts.
  const definitions: Record<string, SwaggerSchema> = {
    Params: { type: 'object', properties: { project: { type: 'string' } } },
  }
  assert.equal('required' in buildInputSchema('Params', definitions), false)
})

test('a root referenced from its own subtree is kept in $defs', () => {
  // Mutation-proven gap: reverting this fix left the suite fully green. Without it the
  // emitted schema carries `#/$defs/<Root>` with nothing to resolve to — valid-looking
  // JSON that fails at validation time.
  const definitions: Record<string, SwaggerSchema> = {
    Params: { type: 'object', properties: { child: { $ref: '#/definitions/Child' } } },
    Child: { type: 'object', properties: { parent: { $ref: '#/definitions/Params' } } },
  }
  const schema = buildInputSchema('Params', definitions)
  const defs = (schema.$defs ?? {}) as Record<string, unknown>
  assert.ok('Params' in defs, 'the root must stay when something refs back to it')

  for (const ref of [...JSON.stringify(schema).matchAll(/"#\/\$defs\/([^"]+)"/g)]) {
    assert.ok(ref[1]! in defs, `dangling $defs/${ref[1]}`)
  }
})

test('a self-referential root is kept in $defs', () => {
  const definitions: Record<string, SwaggerSchema> = {
    Node: { type: 'object', properties: { next: { $ref: '#/definitions/Node' } } },
  }
  const schema = buildInputSchema('Node', definitions)
  assert.ok('Node' in ((schema.$defs ?? {}) as Record<string, unknown>))
})

test('an unreferenced root is still inlined and dropped from $defs', () => {
  const definitions: Record<string, SwaggerSchema> = {
    Params: { type: 'object', properties: { name: { type: 'string' } } },
  }
  const schema = buildInputSchema('Params', definitions)
  assert.deepEqual(Object.keys(schema.properties as object), ['name'])
  assert.equal('$defs' in schema, false)
})

test('definition names that prefix one another do not cross-match', () => {
  const definitions: Record<string, SwaggerSchema> = {
    Foo: { type: 'object', properties: { bar: { $ref: '#/definitions/FooBar' } } },
    FooBar: { type: 'object', properties: { x: { type: 'string' } } },
  }
  const schema = buildInputSchema('Foo', definitions)
  // FooBar refs nothing back, so Foo is unreferenced and must be dropped despite the
  // "#/$defs/FooBar" needle containing "#/$defs/Foo" as a prefix.
  assert.equal('Foo' in ((schema.$defs ?? {}) as Record<string, unknown>), false)
})
