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

test('an error envelope with no code gets the uncoded sentinel', () => {
  const outcome = interpret(400, JSON.stringify({ ok: false }))
  assert.equal(outcome.ok === false && outcome.code, 'UNCODED_ERROR')
})

test('a JSON null body does not crash', () => {
  // JSON.parse("null") is null and typeof null is "object", so a naive guard misses it.
  // client.ts calls interpret inside its try block, so the throw surfaced as
  // NETWORK_ERROR — a response that arrived fine, reported as a connectivity problem.
  const outcome = interpret(200, 'null')
  assert.equal(outcome.ok, false)
  assert.equal(outcome.ok === false && outcome.code, 'INVALID_RESPONSE')
})

test('non-object JSON bodies are rejected, not misread as envelopes', () => {
  for (const body of ['null', '[]', '"x"', '123', 'true']) {
    const outcome = interpret(200, body)
    assert.equal(outcome.ok, false, body)
    assert.equal(outcome.ok === false && outcome.code, 'INVALID_RESPONSE', body)
  }
})

test('an error with a message but no code gets an honest sentinel', () => {
  // arpc's Error.Code is omitempty and WrapError produces code-less errors. Reporting
  // "HTTP_200" handed the model a code that exists nowhere in the API, while every tool
  // description tells it to react to specific codes.
  const outcome = interpret(200, '{"ok":false,"error":{"message":"json: cannot unmarshal"}}')
  assert.equal(outcome.ok === false && outcome.code, 'UNCODED_ERROR')
  assert.equal(outcome.ok === false && outcome.message, 'json: cannot unmarshal')
})

test('a 500 with a body reports the body instead of claiming there was none', () => {
  const withBody = interpret(500, '<html>bad gateway</html>')
  assert.equal(withBody.ok === false && withBody.code, 'SERVER_ERROR')
  assert.match(withBody.ok === false ? withBody.message : '', /bad gateway/)

  const empty = interpret(500, '')
  assert.match(empty.ok === false ? empty.message : '', /empty body/)
})
