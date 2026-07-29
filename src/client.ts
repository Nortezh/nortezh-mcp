// The only thing in this repo that talks HTTP to Nortezh.

import { interpret, type Interpreted } from './envelope.js'

export interface ClientOptions {
  /** Base URL including the /user prefix, e.g. http://localhost:18080/user */
  apiUrl: string
  token: string
  /** Milliseconds. Deployment routes do real work; the default is generous. */
  timeoutMs?: number
}

export class NortezhClient {
  private readonly apiUrl: string
  private readonly token: string
  private readonly timeoutMs: number

  constructor(options: ClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/+$/, '')
    this.token = options.token
    this.timeoutMs = options.timeoutMs ?? 60_000
  }

  /**
   * Calls one arpc route.
   *
   * Every route is a POST with a JSON body, even the reads — that is the arpc convention,
   * not an oversight. The `Authorization: bearer <token>` casing matches what the web app
   * already sends (apps/user/src/libs/axios.ts); the backend parses it case-insensitively.
   */
  async call(route: string, params: unknown): Promise<Interpreted> {
    const url = `${this.apiUrl}/${route}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `bearer ${this.token}`,
        },
        body: JSON.stringify(params ?? {}),
        signal: controller.signal,
      })
      return interpret(response.status, await response.text())
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          ok: false,
          code: 'TIMEOUT',
          message: `${route} did not respond within ${this.timeoutMs}ms.`,
          items: [],
        }
      }
      return {
        ok: false,
        code: 'NETWORK_ERROR',
        message: `Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
        items: [],
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
