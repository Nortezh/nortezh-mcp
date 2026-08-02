// `nortezh-mcp login` — obtain a bearer token through the browser.
//
// The API already supports this: GET <apiUrl>/auth?state=<s>&callback=<url> runs the
// Google OAuth flow and then redirects to `callback` with `?state=<s>&code=<token>`
// appended (api/auth/auth.go redirect() and callback()). The web app uses the same route.
// We point `callback` at a loopback listener, so the token goes from the browser straight
// to this process and never transits anywhere else.
//
// Tokens last 7 days (api/auth/auth.go issues them with AddDate(0, 0, 7)), so this is
// expected to be re-run about weekly.
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { platform } from 'node:os';
import { writeCredentials } from './config.js';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
function page(title, body) {
    return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui,sans-serif;padding:3rem;max-width:34rem">
<h1 style="font-size:1.25rem">${title}</h1><p>${body}</p></body>`;
}
function openBrowser(url) {
    const command = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'start' : 'xdg-open';
    try {
        const child = spawn(command, [url], { stdio: 'ignore', detached: true, shell: platform() === 'win32' });
        child.on('error', () => {
            /* the URL is printed too; a failure to launch is not fatal */
        });
        child.unref();
    }
    catch {
        /* same */
    }
}
/**
 * Runs the browser login and stores the resulting token.
 *
 * Resolves with the path the credentials were written to.
 */
export async function login(apiUrl) {
    const base = apiUrl.replace(/\/+$/, '');
    const expectedState = randomBytes(24).toString('base64url');
    return await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            server.close();
            fn();
        };
        const server = createServer((request, response) => {
            const address = server.address();
            const url = new URL(request.url ?? '/', `http://127.0.0.1:${address?.port ?? 0}`);
            if (url.pathname !== '/callback') {
                response.writeHead(404).end();
                return;
            }
            // The state we generated must come back untouched. Without this check any page
            // able to reach the loopback port could hand this process a token of its choosing.
            if (url.searchParams.get('state') !== expectedState) {
                response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                response.end(page('Login failed', 'State mismatch — the response did not come from the login you started.'));
                finish(() => reject(new Error('login: state mismatch; nothing was saved')));
                return;
            }
            const token = url.searchParams.get('code');
            if (token === null || token === '') {
                response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                response.end(page('Login failed', 'No token was returned.'));
                finish(() => reject(new Error('login: no token in callback')));
                return;
            }
            const credentials = {
                token,
                apiUrl: base,
                obtainedAt: new Date().toISOString(),
            };
            let path;
            try {
                path = writeCredentials(credentials);
            }
            catch (error) {
                response.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
                response.end(page('Login failed', 'Could not write the credentials file.'));
                finish(() => reject(error instanceof Error ? error : new Error(String(error))));
                return;
            }
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.end(page('Signed in to Nortezh', 'You can close this tab and return to your terminal.'));
            finish(() => resolve(path));
        });
        const timer = setTimeout(() => {
            finish(() => reject(new Error(`login: timed out after ${LOGIN_TIMEOUT_MS / 1000}s`)));
        }, LOGIN_TIMEOUT_MS);
        server.on('error', (error) => finish(() => reject(error)));
        // Port 0 lets the OS pick a free port; binding to 127.0.0.1 (not 0.0.0.0) keeps the
        // listener off the network for the seconds it exists.
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            const target = new URL(`${base}/auth`);
            target.searchParams.set('state', expectedState);
            target.searchParams.set('callback', `http://127.0.0.1:${port}/callback`);
            console.error('Opening your browser to sign in to Nortezh.');
            console.error(`If it does not open, visit:\n  ${target.toString()}\n`);
            openBrowser(target.toString());
        });
    });
}
//# sourceMappingURL=login.js.map