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

/**
 * Maps one HTTP response into a tool result or a tool error.
 *
 * Status handling, all confirmed against the backend's behaviour:
 *  - 200 with `ok:true`  -> success, unwrap `result`
 *  - 200 with `ok:false` -> domain error, surfaced as a tool error with its code
 *  - 400                 -> arpc protocol error (malformed request), body may be JSON
 *  - 500                 -> unexpected server error; the backend sends an EMPTY body, so
 *                           there is nothing to parse and nothing to report but the fact
 */
export function interpret(status: number, bodyText: string): Interpreted {
  if (status === 500) {
    return {
      ok: false,
      code: 'SERVER_ERROR',
      message: 'The Nortezh API returned HTTP 500 with no body. Check the API server logs.',
      items: [],
    }
  }

  let parsed: RawEnvelope
  try {
    parsed = JSON.parse(bodyText) as RawEnvelope
  } catch {
    return {
      ok: false,
      code: 'INVALID_RESPONSE',
      message: `HTTP ${status}: response was not JSON: ${truncate(bodyText)}`,
      items: [],
    }
  }

  if (parsed.ok === true) return { ok: true, result: parsed.result }

  const error = parsed.error ?? {}
  const code = typeof error.code === 'string' && error.code !== '' ? error.code : `HTTP_${status}`
  const message =
    typeof error.message === 'string' && error.message !== ''
      ? error.message
      : `HTTP ${status} with no error message`
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
