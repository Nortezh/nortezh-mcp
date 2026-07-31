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

test('a non-JSON body on an envelope status does not throw', () => {
  // 400 is a real arpc status, so its body IS parsed — it just may not be JSON.
  const outcome = interpret(400, '<html>bad request</html>')
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

test('a 500 with a JSON body is a server fault, not a domain error', () => {
  // Regression: handling 500 inside the parse-failure branch meant arpc's own
  // {"ok":false,"error":{}} — which parses fine — went down the envelope path and came back
  // as a code-less domain error, losing the "check the server logs" advice entirely.
  const arpc = interpret(500, '{"ok":false,"error":{}}')
  assert.equal(arpc.ok === false && arpc.code, 'SERVER_ERROR')

  // An ingress or CDN emits its own JSON. That body must be reported, not discarded.
  const ingress = interpret(500, '{"error":"upstream connect error"}')
  assert.equal(ingress.ok === false && ingress.code, 'SERVER_ERROR')
  assert.match(ingress.ok === false ? ingress.message : '', /upstream connect error/)

  const jsonNull = interpret(500, 'null')
  assert.equal(jsonNull.ok === false && jsonNull.code, 'SERVER_ERROR')
})

test('a 5xx that is not 500 keeps the body that names the fault', () => {
  // The same bug the 500 fix addressed, still live for its neighbours. arpc emits only 200,
  // 400 and 500 (arpc.go:155-170), so a 502/503/504 is the ingress — but its JSON parsed
  // fine, went down the envelope path, and came back as
  // "UNCODED_ERROR: HTTP 503 with no error code or message", discarding the one string that
  // said what was actually wrong.
  const unavailable = interpret(503, '{"error":"no healthy upstream"}')
  assert.equal(unavailable.ok === false && unavailable.code, 'SERVER_UNAVAILABLE')
  assert.match(unavailable.ok === false ? unavailable.message : '', /no healthy upstream/)

  const gateway = interpret(502, '<html>bad gateway</html>')
  assert.equal(gateway.ok === false && gateway.code, 'SERVER_UNAVAILABLE')
  assert.match(gateway.ok === false ? gateway.message : '', /bad gateway/)

  // 500 keeps its own code: "the API crashed" and "the API was unreachable" send the reader
  // to different places.
  const crashed = interpret(500, '{}')
  assert.equal(crashed.ok === false && crashed.code, 'SERVER_ERROR')
})

test('a 404 says the base URL is wrong rather than inventing a domain error', () => {
  // arpc's own NotFound goes through EncodeError, so an unknown method on a correct mount
  // is still HTTP 200 with ok:false. A real 404 means NORTEZH_API_URL is wrong — most often
  // missing the /user suffix, which is the top entry in the README's troubleshooting.
  const outcome = interpret(404, 'page not found')
  assert.equal(outcome.ok === false && outcome.code, 'TRANSPORT_ERROR')
  assert.match(outcome.ok === false ? outcome.message : '', /\/user suffix/)
})

test('a proxy 401 does not masquerade as the API UNAUTHORIZED code', () => {
  // index.ts reopens the browser whenever it sees UNAUTHORIZED. Mapping a transport 401 to
  // it would open a login window for a gateway that is rejecting the request for its own
  // reasons — and keep doing it. The API's auth failures arrive as HTTP 200.
  for (const status of [401, 403]) {
    const outcome = interpret(status, 'denied')
    assert.notEqual(outcome.ok === false && outcome.code, 'UNAUTHORIZED')
    assert.equal(outcome.ok === false && outcome.code, 'TRANSPORT_ERROR')
  }
})

test('an unexpected status is reported rather than parsed as an envelope', () => {
  const outcome = interpret(429, '{"ok":false,"error":{"code":"NOPE"}}')
  assert.equal(outcome.ok === false && outcome.code, 'TRANSPORT_ERROR')
  // The body is echoed, but its "code" is not adopted — it did not come from arpc.
  assert.match(outcome.ok === false ? outcome.message : '', /HTTP 429/)
})
