// Where the server gets its API base URL and bearer token.
import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
/**
 * Base URL of the Nortezh user API, INCLUDING the /user prefix.
 *
 * Two ways to get this wrong, both of which fail as an opaque 404 or an unreachable
 * browser tab rather than as anything that names the cause:
 *
 *  - dropping the `/user` prefix. cmd/api/main.go mounts every user route under
 *    `mux.Group("/user", nil)`, so a correct host without it routes nothing, login
 *    included.
 *  - using a `*.internal.*` host. That is the cluster-internal ingress (ingress class
 *    `parapet-internal`, no public load balancer, no TLS — deployer/k8s/ingress.go), so
 *    it resolves only from inside the cluster. The external host is the same name with
 *    `.internal` removed, over https.
 *
 * Known-real values:
 *
 *   production  https://api.nortezh.com/user   (the default)
 *   local       http://localhost:18080/user
 */
export const API_URL_ENV = 'NORTEZH_API_URL';
/**
 * Production, used when NORTEZH_API_URL is unset.
 *
 * Same value kunn defaults to (`KUNN_AUTH_URL`), minus the trailing `/auth` this client
 * appends itself.
 */
export const DEFAULT_API_URL = 'https://api.nortezh.com/user';
/** Optional: a bearer token supplied directly, bypassing `nortezh-mcp login`. */
export const TOKEN_ENV = 'NORTEZH_TOKEN';
export function credentialsPath() {
    return join(homedir(), '.nortezh', 'credentials.json');
}
export function readCredentials() {
    try {
        const parsed = JSON.parse(readFileSync(credentialsPath(), 'utf8'));
        if (typeof parsed.token !== 'string' || parsed.token === '')
            return null;
        return {
            token: parsed.token,
            apiUrl: typeof parsed.apiUrl === 'string' ? parsed.apiUrl : '',
            obtainedAt: typeof parsed.obtainedAt === 'string' ? parsed.obtainedAt : '',
        };
    }
    catch {
        return null;
    }
}
export function writeCredentials(credentials) {
    const path = credentialsPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
    // writeFileSync's mode only applies when it creates the file, so an existing
    // world-readable file would keep its permissions. Set them unconditionally.
    chmodSync(path, 0o600);
    return path;
}
/**
 * Deletes the stored credentials. Returns false when there were none.
 *
 * Only removes the file. A token supplied through NORTEZH_TOKEN lives in the environment,
 * so `logout` cannot reach it — the caller says so rather than reporting a sign-out that
 * did not happen.
 */
export function clearCredentials() {
    try {
        unlinkSync(credentialsPath());
        return true;
    }
    catch {
        return false;
    }
}
/** The API base URL: NORTEZH_API_URL if set, production otherwise. */
export function resolveApiUrl() {
    const raw = process.env[API_URL_ENV]?.trim();
    const value = raw === undefined || raw === '' ? DEFAULT_API_URL : raw;
    return value.replace(/\/+$/, '');
}
/**
 * Resolves the credentials the server will use.
 *
 * The env var wins over the stored file so a scripted or CI invocation can override a
 * developer's saved login without deleting it.
 */
export function resolveAuth() {
    const apiUrl = resolveApiUrl();
    const supplied = process.env[TOKEN_ENV]?.trim();
    if (supplied !== undefined && supplied !== '') {
        return { apiUrl, token: supplied, fromEnv: true };
    }
    const stored = readCredentials();
    if (stored === null) {
        throw new Error(`No credentials for ${apiUrl}. Run \`nortezh-mcp login\`, or set ${TOKEN_ENV}.`);
    }
    if (stored.apiUrl !== '' && stored.apiUrl !== apiUrl) {
        throw new Error(`Stored credentials are for ${stored.apiUrl} but the API is ${apiUrl}. ` +
            'Run `nortezh-mcp login` again against this API.');
    }
    return { apiUrl, token: stored.token, fromEnv: false };
}
//# sourceMappingURL=config.js.map