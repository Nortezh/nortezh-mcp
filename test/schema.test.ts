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
