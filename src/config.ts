// Where the server gets its API base URL and bearer token.

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Base URL of the Nortezh user API, INCLUDING the /user prefix.
 *
 * Required, with no default on purpose: no production hostname exists anywhere in the
 * nortezh workspace — the k8s manifests only carry a `${NT_API_ENDPOINT}` placeholder —
 * so any default would be invented. Known-real values:
 *
 *   local    http://localhost:18080/user
 *   staging  https://api-stag-899570118063554590.rcf2.deploys.app/user
 */
export const API_URL_ENV = 'NORTEZH_API_URL'

/** Optional: a bearer token supplied directly, bypassing `nortezh-mcp login`. */
export const TOKEN_ENV = 'NORTEZH_TOKEN'

export interface Credentials {
  token: string
  /** The API URL the token was issued against — a token is not portable between them. */
  apiUrl: string
  /** ISO 8601. The API issues 7-day tokens, so this is when a re-login is due. */
  obtainedAt: string
}

export function credentialsPath(): string {
  return join(homedir(), '.nortezh', 'credentials.json')
}

export function readCredentials(): Credentials | null {
  try {
    const parsed = JSON.parse(readFileSync(credentialsPath(), 'utf8')) as Partial<Credentials>
    if (typeof parsed.token !== 'string' || parsed.token === '') return null
    return {
      token: parsed.token,
      apiUrl: typeof parsed.apiUrl === 'string' ? parsed.apiUrl : '',
      obtainedAt: typeof parsed.obtainedAt === 'string' ? parsed.obtainedAt : '',
    }
  } catch {
    return null
  }
}

export function writeCredentials(credentials: Credentials): string {
  const path = credentialsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 })
  // writeFileSync's mode only applies when it creates the file, so an existing
  // world-readable file would keep its permissions. Set them unconditionally.
  chmodSync(path, 0o600)
  return path
}

export function requireApiUrl(): string {
  const value = process.env[API_URL_ENV]?.trim()
  if (value === undefined || value === '') {
    throw new Error(
      `${API_URL_ENV} is not set. It must be the Nortezh user API base URL including the ` +
        '/user prefix, e.g. http://localhost:18080/user',
    )
  }
  return value.replace(/\/+$/, '')
}

export interface Resolved {
  apiUrl: string
  token: string
}

/**
 * Resolves the credentials the server will use.
 *
 * The env var wins over the stored file so a scripted or CI invocation can override a
 * developer's saved login without deleting it.
 */
export function resolveAuth(): Resolved {
  const apiUrl = requireApiUrl()

  const fromEnv = process.env[TOKEN_ENV]?.trim()
  if (fromEnv !== undefined && fromEnv !== '') return { apiUrl, token: fromEnv }

  const stored = readCredentials()
  if (stored === null) {
    throw new Error(
      `No credentials. Run \`nortezh-mcp login\` (with ${API_URL_ENV} set), or set ${TOKEN_ENV}.`,
    )
  }

  if (stored.apiUrl !== '' && stored.apiUrl !== apiUrl) {
    throw new Error(
      `Stored credentials are for ${stored.apiUrl} but ${API_URL_ENV} is ${apiUrl}. ` +
        'Run `nortezh-mcp login` again against this API.',
    )
  }

  return { apiUrl, token: stored.token }
}
