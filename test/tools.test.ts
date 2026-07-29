// Checks the GENERATED tool set against the spec it came from.
//
// These are not testing the generator's logic (schema.test.ts does that) — they are
// testing the artifact that actually ships, so a bad regeneration cannot be committed
// silently.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { ALLOWLIST } from '../scripts/allowlist.js'
import { TOOLS } from '../src/generated/tools.js'
import type { SwaggerDocument, SwaggerOperation } from '../src/spec-types.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const spec = JSON.parse(readFileSync(resolve(root, 'spec/swagger.json'), 'utf8')) as SwaggerDocument

const operations = new Map<string, SwaggerOperation>()
for (const methods of Object.values(spec.paths ?? {})) {
  for (const operation of Object.values(methods)) {
    if (operation.operationId !== undefined) operations.set(operation.operationId, operation)
  }
}

test('the generated tools match the allowlist exactly', () => {
  // If this fails, someone edited the allowlist without running `npm run generate`.
  assert.deepEqual(TOOLS.map((tool) => tool.name), [...ALLOWLIST])
})

test('tool names are unique', () => {
  assert.equal(new Set(TOOLS.map((tool) => tool.name)).size, TOOLS.length)
})

test('every tool maps to a real route in the spec', () => {
  for (const tool of TOOLS) {
    assert.ok(operations.has(tool.name), `${tool.name} is not in the spec`)
    assert.match(tool.route, /^[a-zA-Z]+(\.[a-zA-Z]+)+$/, `${tool.name} has an odd route: ${tool.route}`)
  }
})

test('no tool is both read-only and destructive', () => {
  for (const tool of TOOLS) {
    assert.ok(!(tool.readOnly && tool.destructive), `${tool.name} claims both hints`)
  }
})

test('safety hints come from the spec, not from the name', () => {
  for (const tool of TOOLS) {
    const operation = operations.get(tool.name)
    assert.equal(tool.readOnly, operation?.['x-mcp-read-only'] === true, tool.name)
    assert.equal(tool.destructive, operation?.['x-mcp-destructive'] === true, tool.name)
  }
})

test('no tool schema contains a leftover swagger $ref', () => {
  const serialized = JSON.stringify(TOOLS.map((tool) => tool.inputSchema))
  assert.equal(serialized.includes('#/definitions/'), false)
})

test('every $ref resolves inside its own tool schema', () => {
  for (const tool of TOOLS) {
    const defs = (tool.inputSchema as { $defs?: Record<string, unknown> }).$defs ?? {}
    const refs = [...JSON.stringify(tool.inputSchema).matchAll(/"#\/\$defs\/([^"]+)"/g)].map((m) => m[1])
    for (const ref of refs) {
      assert.ok(ref !== undefined && ref in defs, `${tool.name} refers to missing $defs/${ref}`)
    }
  }
})

test('required[] is only claimed where the spec claims it', () => {
  // A required field the API does not enforce makes a generated client reject legitimate
  // calls. deployment.list and domain.get enforce nothing at all — see the notes in
  // nortezh-backend about their Valid() methods.
  for (const name of ['deploymentList', 'domainGet', 'domainDelete']) {
    const tool = TOOLS.find((candidate) => candidate.name === name)
    if (tool === undefined) continue
    assert.equal('required' in tool.inputSchema, false, `${name} should mark nothing required`)
  }

  const create = TOOLS.find((tool) => tool.name === 'diskCreate')
  assert.ok(create !== undefined)
  assert.deepEqual(
    [...((create.inputSchema as { required: string[] }).required ?? [])].sort(),
    ['location', 'name', 'project', 'size'],
  )
})

test('tool descriptions name the error codes the route can return', () => {
  for (const tool of TOOLS) {
    if (tool.errorCodes.length === 0) continue
    assert.ok(
      tool.description.includes(tool.errorCodes[0] as string),
      `${tool.name} does not mention its error codes`,
    )
  }
})
