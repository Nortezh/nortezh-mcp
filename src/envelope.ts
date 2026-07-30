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

/**
 * Maps one HTTP response into a tool result or a tool error.
 *
 * Status handling, all confirmed against the backend's behaviour:
 *  - 200 with `ok:true`  -> success, unwrap `result`
 *  - 200 with `ok:false` -> domain error, surfaced as a tool error with its code
 *  - 400                 -> arpc protocol error (malformed request), body may be JSON
 *  - 500                 -> server fault, never a domain error. Handled before parsing: the
 *                           body may be arpc's `{"ok":false,"error":{}}`, an ingress's own
 *                           JSON, HTML, or nothing at all — whatever it is gets reported
 */
export function interpret(status: number, bodyText: string): Interpreted {
  // A 500 is handled BEFORE parsing, not inside the parse failure. arpc emits
  // {"ok":false,"error":{}} for one, and an ingress or CDN emits its own JSON — both parse
  // fine, so keying off the parse result would send the ordinary production 500 down the
  // envelope path and report it as a code-less domain error instead of a server fault.
  // Whatever body arrived is reported rather than discarded.
  if (status === 500) {
    return {
      ok: false,
      code: SERVER_ERROR,
      message:
        bodyText.trim() === ''
          ? 'The API returned HTTP 500 with an empty body. Check the API server logs.'
          : `The API returned HTTP 500: ${truncate(bodyText)}`,
      items: [],
    }
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
