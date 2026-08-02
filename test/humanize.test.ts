// The enum translation. Every case here is a value the API really emits — the point of the
// module is that four different encodings of "how far along is this" stop reaching the model
// as raw JSON, so the tests pin each encoding against the shape that produces it.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { humanize, outputNote, TOOL_SHAPES } from '../src/humanize.js'
import { TOOLS } from '../src/generated/tools.js'

test('a deployment reports what it IS, not what the deployer did', () => {
  const result = humanize('deploymentGet', {
    name: 'carmateauto-web',
    action: 'deploy',
    actionStatus: 'success',
  })
  assert.deepEqual(result, {
    name: 'carmateauto-web',
    action: 'deploy',
    status: 'success',
    state: 'running',
  })
})

test('the same deployment status means different things under different actions', () => {
  const states = (action: string, actionStatus: string) =>
    (humanize('deploymentGet', { action, actionStatus }) as { state?: string }).state

  assert.equal(states('deploy', 'pending'), 'deploying')
  assert.equal(states('deploy', 'failed'), 'failed')
  assert.equal(states('pause', 'pending'), 'pausing')
  assert.equal(states('pause', 'success'), 'paused')
  assert.equal(states('delete', 'pending'), 'deleting')
  assert.equal(states('delete', 'success'), 'deleted')
})

test('a disk or database integer becomes a name, under the name `status`', () => {
  // pkg/api.ActionStatus: 1 pending, 2 success, and no failure value at all.
  assert.deepEqual(humanize('diskGet', { name: 'uploads', actionStatus: 2 }), {
    name: 'uploads',
    status: 'success',
    state: 'ready',
  })
  assert.deepEqual(humanize('dbPostgresGet', { name: 'orders', actionStatus: 1, host: '' }), {
    name: 'orders',
    status: 'pending',
    state: 'pending',
    host: '',
  })
})

test('a route or pull secret keeps its field name and loses the integer', () => {
  assert.deepEqual(humanize('routeGet', { path: '/', status: 2 }), {
    path: '/',
    status: 'success',
    state: 'ready',
  })
  assert.deepEqual(humanize('pullsecretList', { items: [{ name: 'ghcr', status: 1 }] }), {
    items: [{ name: 'ghcr', status: 'pending', state: 'pending' }],
  })
})

test('a revision`s 2 is "deploying", not "success"', () => {
  // The one place a bare 2 does not mean success — which is exactly why the mapping is
  // per tool rather than per field name.
  assert.deepEqual(
    humanize('deploymentLogRevision', { items: [{ revision: 7, status: 2 }, { revision: 6, status: 3 }] }),
    { items: [{ revision: 7, status: 'deploying' }, { revision: 6, status: 'deployed' }] },
  )
})

test('a revision gets no derived state', () => {
  const [first] = (humanize('deploymentLogRevision', { items: [{ status: 1 }] }) as {
    items: Array<Record<string, unknown>>
  }).items
  assert.deepEqual(first, { status: 'pending' })
})

test('a domain keeps its string status and gains a state', () => {
  const state = (action: string, status: string) =>
    (humanize('domainGet', { action, status }) as { state?: string }).state

  assert.equal(state('create', 'success'), 'ready')
  assert.equal(state('create', 'verify'), 'verifying')
  assert.equal(state('create', 'error'), 'failed')
  assert.equal(state('delete', 'pending'), 'deleting')
  assert.deepEqual(humanize('domainGet', { domain: 'acme.com', action: 'create', status: 'pending' }), {
    domain: 'acme.com',
    action: 'create',
    status: 'pending',
    state: 'pending',
  })
})

test('list items nested under a paginated result are rewritten too', () => {
  const result = humanize('deploymentList', {
    items: [
      { name: 'api', action: 'deploy', actionStatus: 'success' },
      { name: 'worker', action: 'pause', actionStatus: 'success' },
    ],
    paginate: { next: false, items: 2 },
  })
  assert.deepEqual(result, {
    items: [
      { name: 'api', action: 'deploy', status: 'success', state: 'running' },
      { name: 'worker', action: 'pause', status: 'success', state: 'paused' },
    ],
    paginate: { next: false, items: 2 },
  })
})

test('key order is preserved, so the field reads where the API put it', () => {
  const result = humanize('deploymentGet', {
    name: 'api',
    action: 'deploy',
    actionStatus: 'success',
    url: 'api.example.com',
  }) as Record<string, unknown>
  assert.deepEqual(Object.keys(result), ['name', 'action', 'status', 'state', 'url'])
})

test('a value with no mapping is passed through rather than guessed at', () => {
  // A new enum member is the case this protects: translating 4 into a name that happens to
  // exist would be a wrong answer nothing downstream could spot. The rename still happens —
  // the field is named `status` in this server's output unconditionally, so that the
  // description note stays true even for a value nothing knows how to read.
  assert.deepEqual(humanize('diskGet', { actionStatus: 4 }), { status: 4 })
  assert.deepEqual(humanize('deploymentGet', { action: 'deploy', actionStatus: 'queued' }), {
    action: 'deploy',
    status: 'queued',
  })
})

test('no state is invented when the action is missing', () => {
  assert.deepEqual(humanize('deploymentGet', { actionStatus: 'success' }), { status: 'success' })
})

test('a tool with no status field is left exactly as it arrived', () => {
  const raw = { slug: 'acme', name: 'Acme', status: 2 }
  assert.deepEqual(humanize('projectGet', raw), raw)
  assert.equal(outputNote('projectGet'), undefined)
})

test('non-object results survive the walk', () => {
  assert.equal(humanize('diskCount', 4), 4)
  assert.equal(humanize('deploymentGet', null), null)
  assert.deepEqual(humanize('deploymentList', { items: null }), { items: null })
})

test('every shaped tool exists, and says in its description what changed', () => {
  // A tool renamed or dropped from the allowlist would otherwise leave a mapping that
  // silently never fires — and a renamed field with no note in the description leaves the
  // model polling `actionStatus`, which is not in the output any more.
  const names = new Set(TOOLS.map((tool) => tool.name))
  for (const name of Object.keys(TOOL_SHAPES)) {
    assert.ok(names.has(name), `${name} has a result shape but is not an exposed tool`)
    assert.match(outputNote(name) ?? '', /^Output note: /)
  }
})

test('the description note is appended to the generated description, not replacing it', () => {
  const tool = TOOLS.find((candidate) => candidate.name === 'deploymentGet')
  assert.ok(tool !== undefined)
  assert.match(outputNote('deploymentGet') ?? '', /no `actionStatus` field in the output/)
  assert.doesNotMatch(tool.description, /Output note:/)
})
