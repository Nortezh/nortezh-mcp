import assert from 'node:assert/strict'
import { test } from 'node:test'

import { formatError, interpret } from '../src/envelope.js'

test('a success unwraps result', () => {
  const outcome = interpret(200, JSON.stringify({ ok: true, result: { id: 7 } }))
  assert.deepEqual(outcome, { ok: true, result: { id: 7 } })
})

test('a domain error on HTTP 200 is an error, not a success', () => {
  // The whole reason this module exists: arpc answers domain errors with 200.
  const body = JSON.stringify({
    ok: false,
    error: { code: 'PROJECT_NOT_FOUND', message: 'project: not found' },
  })
  const outcome = interpret(200, body)
  assert.equal(outcome.ok, false)
  assert.equal(outcome.ok === false && outcome.code, 'PROJECT_NOT_FOUND')
})

test('validation errors carry one item per failed rule', () => {
  const body = JSON.stringify({
    ok: false,
    error: {
      code: 'VALIDATE_ERROR',
      message: 'validate error',
      items: ['name is required', 'project is required'],
    },
  })
  const outcome = interpret(200, body)
  assert.equal(outcome.ok, false)
  if (outcome.ok) return
  assert.deepEqual(outcome.items, ['name is required', 'project is required'])
  assert.equal(
    formatError(outcome),
    'VALIDATE_ERROR: validate error\n- name is required\n- project is required',
  )
})

test('a result of null is still a success', () => {
  // Routes whose handler returns only `error` produce {"ok":true,"result":null}.
  const outcome = interpret(200, JSON.stringify({ ok: true, result: null }))
  assert.deepEqual(outcome, { ok: true, result: null })
})

test('HTTP 500 is reported even though the body is empty', () => {
  const outcome = interpret(500, '')
  assert.equal(outcome.ok, false)
  assert.equal(outcome.ok === false && outcome.code, 'SERVER_ERROR')
})

test('a non-JSON body does not throw', () => {
  const outcome = interpret(502, '<html>bad gateway</html>')
  assert.equal(outcome.ok, false)
  assert.equal(outcome.ok === false && outcome.code, 'INVALID_RESPONSE')
})

test('an error envelope with no code falls back to the status', () => {
  const outcome = interpret(400, JSON.stringify({ ok: false }))
  assert.equal(outcome.ok === false && outcome.code, 'HTTP_400')
})
