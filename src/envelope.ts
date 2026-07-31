// Interpreting the arpc response envelope.
//
// This is the single most important thing an MCP layer over this API has to get right.
// arpc answers a DOMAIN ERROR with **HTTP 200** and `{"ok":false,"error":{...}}`, because
// arpc.Error implements OKError. A client that keys off the status code reports genuine
// failures — "project not found", "validation failed" — as successful tool calls, and the
// model then reasons on top of a result that never existed.
//
// Pure function, no IO, so the mapping is testable directly.

export interface EnvelopeError {
  code: string
  message: string
  /** One message per failed rule; only present for VALIDATE_ERROR. */
  items?: string[]
}

export type Interpreted =
  | { ok: true; result: unknown }
  | { ok: false; code: string; message: string; items: string[] }

interface RawEnvelope {
  ok?: unknown
  result?: unknown
  error?: Partial<EnvelopeError>
}

/** Domain code the API returns for an absent, invalid, or expired credential. */
export const UNAUTHORIZED = 'UNAUTHORIZED'

/** Not an API code: an error that arrived with a message but no code of its own. */
export const UNCODED_ERROR = 'UNCODED_ERROR'

/** Not an API code: an HTTP 500, which carries no useful domain error. */
export const SERVER_ERROR = 'SERVER_ERROR'

/** Not an API code: a 5xx that is not 500 — the ingress or proxy, not the API itself. */
export const SERVER_UNAVAILABLE = 'SERVER_UNAVAILABLE'

/** Not an API code: a status arpc cannot emit, so the response is not an envelope at all. */
export const TRANSPORT_ERROR = 'TRANSPORT_ERROR'

/**
 * The only statuses arpc produces (Manager.EncodeError, arpc.go:155-170):
 *
 *   OKError       -> 200   a domain error, `{"ok":false,"error":{…}}`
 *   ProtocolError -> 400   a malformed request, also a real envelope
 *   anything else -> 500   internal, body replaced with a fixed placeholder
 *
 * A success is 200 too. So 200 and 400 are the only statuses whose body is worth parsing as
 * an envelope; every other one was produced by something in front of the API.
 */
const ENVELOPE_STATUSES = new Set([200, 400])

/**
 * Maps one HTTP response into a tool result or a tool error.
 *
 * Status handling, all confirmed against arpc's own EncodeError:
 *  - 200 with `ok:true`  -> success, unwrap `result`
 *  - 200 with `ok:false` -> domain error, surfaced as a tool error with its code
 *  - 400                 -> arpc protocol error (malformed request), also a real envelope
 *  - anything else       -> not an envelope. Reported by status, body preserved.
 */
export function interpret(status: number, bodyText: string): Interpreted {
  // Everything arpc cannot emit is handled BEFORE parsing, not inside the parse failure.
  //
  // Keying off the parse result is the bug this replaces. A 500 from arpc is
  // `{"ok":false,"error":{}}` and an ingress 503 is `{"error":"no healthy upstream"}` —
  // both parse perfectly well, so both went down the envelope path and came back as
  // code-less domain errors. The 503 was the worse of the two: its body named the actual
  // fault and was thrown away, leaving "HTTP 503 with no error code or message".
  //
  // Only 200 and 400 come from arpc with a body worth reading as an envelope. Anything else
  // was produced by the ingress, a proxy, or the wrong URL, so its body is reported as-is.
  if (!ENVELOPE_STATUSES.has(status)) {
    return { ok: false, code: transportCode(status), message: transportMessage(status, bodyText), items: [] }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return {
      ok: false,
      code: 'INVALID_RESPONSE',
      message: `HTTP ${status}: response was not JSON: ${truncate(bodyText)}`,
      items: [],
    }
  }

  // JSON.parse("null") yields null, and null is typeof "object" — so this guard has to
  // test both. Without it, reading .ok off null throws, and because client.ts calls this
  // inside its try block the crash surfaces as NETWORK_ERROR: a response that arrived
  // perfectly well, reported as a connectivity problem.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      code: 'INVALID_RESPONSE',
      message: `HTTP ${status}: expected a JSON object, got ${truncate(bodyText)}`,
      items: [],
    }
  }

  const envelope = parsed as RawEnvelope
  if (envelope.ok === true) return { ok: true, result: envelope.result }

  const error = envelope.error ?? {}
  // arpc's Error.Code is `omitempty`, and NewError/WrapError produce code-less errors — a
  // body that fails to bind comes back with a message and no code. Report that as its own
  // sentinel: inventing "HTTP_200" hands the model a code that exists nowhere in the API,
  // when every tool description tells it to react to specific codes.
  const code = typeof error.code === 'string' && error.code !== '' ? error.code : UNCODED_ERROR
  const message =
    typeof error.message === 'string' && error.message !== ''
      ? error.message
      : `HTTP ${status} with no error code or message`
  const items = Array.isArray(error.items) ? error.items.filter((i): i is string => typeof i === 'string') : []

  return { ok: false, code, message, items }
}

/** Renders a domain error as the text an MCP tool error carries. */
export function formatError(error: Extract<Interpreted, { ok: false }>): string {
  const head = `${error.code}: ${error.message}`
  if (error.items.length === 0) return head
  return `${head}\n${error.items.map((item) => `- ${item}`).join('\n')}`
}

function truncate(value: string, max = 300): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`
}

function transportCode(status: number): string {
  if (status === 500) return SERVER_ERROR
  if (status >= 500) return SERVER_UNAVAILABLE
  return TRANSPORT_ERROR
}

/**
 * What to say about a status arpc did not produce.
 *
 * The body is always included when there is one: for these statuses it is the only
 * diagnostic there is, and it is usually the thing that names the real fault ("no healthy
 * upstream", "upstream connect error", an nginx error page).
 */
function transportMessage(status: number, bodyText: string): string {
  const body = bodyText.trim()
  const detail = body === '' ? ' The response had no body.' : ` Response: ${truncate(body)}`

  if (status === 500) {
    return body === ''
      ? 'The API returned HTTP 500 with an empty body. Check the API server logs.'
      : `The API returned HTTP 500: ${truncate(body)}`
  }
  if (status >= 500) {
    return (
      `HTTP ${status}: the API did not handle this request — that status comes from the ` +
      `ingress or a proxy, not from the API, so it is usually unreachable, restarting, or ` +
      `overloaded rather than rejecting the call.${detail}`
    )
  }
  if (status === 404) {
    return (
      `HTTP 404: no route at this URL. arpc answers an unknown method on a valid mount with ` +
      `HTTP 200 and ok:false, so a real 404 means the base URL is wrong — most often ` +
      `NORTEZH_API_URL is missing its /user suffix.${detail}`
    )
  }
  if (status === 401 || status === 403) {
    // Deliberately NOT mapped to UNAUTHORIZED: index.ts reopens the browser on that code,
    // and a proxy rejecting the request is not an expired Nortezh token. The API's own
    // auth failures arrive as HTTP 200 with code UNAUTHORIZED.
    return (
      `HTTP ${status}: rejected before reaching the API — the API reports its own auth ` +
      `failures as HTTP 200 with code UNAUTHORIZED, so this came from a proxy or gateway ` +
      `in front of it.${detail}`
    )
  }
  return `HTTP ${status}: unexpected status; arpc only emits 200, 400 and 500.${detail}`
}
