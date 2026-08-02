#!/usr/bin/env node
// nortezh-mcp — an MCP server over the Nortezh user API.
//
// Runs locally over stdio: the MCP client (Claude Desktop, Claude Code, …) starts this
// process, and the bearer token never leaves the machine. Nothing is deployed and nothing
// in nortezh-backend changes to support it.
//
// The tool list is generated from the API's own OpenAPI spec — see scripts/generate.ts.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { NortezhClient } from './client.js'
import {
  API_URL_ENV,
  clearCredentials,
  credentialsPath,
  DEFAULT_API_URL,
  resolveApiUrl,
  resolveAuth,
  TOKEN_ENV,
} from './config.js'
import { formatError, UNAUTHORIZED } from './envelope.js'
import { login } from './login.js'
import { TOOLS, type ToolSpec } from './generated/tools.js'
import { install, uninstall } from './install.js'
import { LOCAL_TOOLS } from './local-tools.js'
import { readBuildInfo, versionString } from './version.js'

async function runServer(): Promise<void> {
  const { apiUrl, token, fromEnv } = resolveAuth()
  const client = new NortezhClient({ apiUrl, token })

  const byName = new Map<string, ToolSpec>(TOOLS.map((tool) => [tool.name, tool]))

  // Tokens expire after 7 days, and the failure lands mid-conversation. Rather than
  // making the user notice a tool error and go run a command, re-run the browser login
  // once and retry — the same thing `kunn` does on ErrUnauthorized.
  //
  // Two guards. A token supplied through NORTEZH_TOKEN is never replaced: it was chosen
  // deliberately, and the CI case that sets it has no browser to open. And concurrent
  // tool calls share one login attempt, so an expiry does not open a browser tab per
  // in-flight request.
  let reloginInFlight: Promise<boolean> | null = null
  // Bumped on every successful login. A request that started before a refresh must not
  // trigger a second one when its own stale-token 401 finally lands.
  let tokenGeneration = 0
  // A login the user simply ignores takes the full 5 minutes to time out. Without this,
  // the very next tool call opens another browser window and blocks for another 5.
  let quietUntil = 0

  const RELOGIN_BACKOFF_MS = 2 * 60 * 1000

  async function relogin(generationAtCall: number): Promise<boolean> {
    if (fromEnv) return false
    // Someone already refreshed while this request was in flight — just retry with it.
    if (generationAtCall !== tokenGeneration) return true
    if (reloginInFlight !== null) return await reloginInFlight
    if (Date.now() < quietUntil) return false

    reloginInFlight = (async () => {
      try {
        console.error('Token rejected — reopening the browser to sign in again.')
        await login(apiUrl)
      } catch (error) {
        console.error(`Re-login failed: ${error instanceof Error ? error.message : String(error)}`)
        quietUntil = Date.now() + RELOGIN_BACKOFF_MS
        return false
      } finally {
        reloginInFlight = null
      }

      // Separate from the login attempt on purpose. resolveAuth() throws when the stored
      // credentials do not match NORTEZH_API_URL — a configuration fault, not a failed
      // login. Treating it as a login failure threw away a token the user had just gone to
      // the browser for, and armed a backoff that would reopen the browser on a loop.
      try {
        client.setToken(resolveAuth().token)
        tokenGeneration += 1
        return true
      } catch (error) {
        console.error(
          `Signed in, but the credentials cannot be used: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        quietUntil = Number.POSITIVE_INFINITY
        return false
      }
    })()

    return await reloginInFlight
  }

  // The build stamp goes in serverInfo.version, which is what a client shows in its server
  // list — so "am I running the build I just made" is answerable by reading a number rather
  // than by hunting for a tool that was removed.
  //
  // Tools are the ONLY capability. The guided workflows used to ship here as MCP prompts too,
  // rendered from the same text as the skill — two surfaces, one procedure, and a generator
  // plus a drift-check to keep them equal. The skill does the job better, because it is in
  // context before the first tool call and before Bash, which MCP cannot observe at all. So
  // the prompts went, and `skills/nortezh/` is the single home for the guidance.
  const server = new Server(
    { name: 'nortezh', version: versionString() },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as { type: 'object' },
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: tool.destructive,
          // Every generated tool reaches the remote API, so none is closed-world.
          openWorldHint: true,
        },
      })),
      ...LOCAL_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as { type: 'object' },
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: false,
          // Answered from this process — no network, nothing outside it to observe.
          openWorldHint: false,
        },
      })),
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // Local tools are checked first: they answer in-process, so none of the auth, retry or
    // envelope handling below applies to them. serverInfo in particular has to work when
    // the token is expired — "which build is this?" is a question you ask while debugging.
    const local = LOCAL_TOOLS.find((candidate) => candidate.name === request.params.name)
    if (local !== undefined) {
      const result = local.run()
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      return { content: [{ type: 'text' as const, text }] }
    }

    const tool = byName.get(request.params.name)
    if (tool === undefined) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Unknown tool: ${request.params.name}` }],
      }
    }

    const args = request.params.arguments ?? {}
    const generationAtCall = tokenGeneration
    let outcome = await client.call(tool.route, args)

    // Retried at most once: if the fresh token is rejected too, the problem is not expiry.
    if (!outcome.ok && outcome.code === UNAUTHORIZED && (await relogin(generationAtCall))) {
      outcome = await client.call(tool.route, args)

      // A login that SUCCEEDS but whose token is still rejected is the dangerous case: the
      // catch above never fires, so nothing arms the backoff, and the next tool call opens
      // another browser — one per call, indefinitely. Signing in as the wrong Google
      // account, or pointing at an API the account has no access to, does exactly this.
      if (!outcome.ok && outcome.code === UNAUTHORIZED) {
        quietUntil = Date.now() + RELOGIN_BACKOFF_MS
        console.error(
          'Signed in, but the API still rejects the token. Not reopening the browser for ' +
            `${RELOGIN_BACKOFF_MS / 60_000} minutes — check NORTEZH_API_URL and which account you used.`,
        )
      }
    }

    if (outcome.ok) {
      // JSON.stringify(undefined) is undefined, not a string — that would serialize as a
      // content block with no `text`, which the MCP schema rejects, so an empty success
      // would reach the user as a protocol error.
      const text = outcome.result === undefined ? 'null' : JSON.stringify(outcome.result, null, 2)
      return { content: [{ type: 'text' as const, text }] }
    }

    // A domain error arrives as HTTP 200; reporting it as an MCP tool error is what stops
    // the model treating a failure as a result.
    const hint =
      outcome.code === UNAUTHORIZED
        ? fromEnv
          ? `\n\nThe token in ${TOKEN_ENV} is invalid or expired (they last 7 days). Replace it, or unset it and run \`nortezh-mcp login\`.`
          : '\n\nRe-login did not resolve it. Run `nortezh-mcp login` and check NORTEZH_API_URL.'
        : ''

    return {
      isError: true,
      content: [{ type: 'text' as const, text: `${formatError(outcome)}${hint}` }],
    }
  })

  await server.connect(new StdioServerTransport())
  // stdout is the MCP transport — anything written there corrupts the protocol.
  console.error(`nortezh-mcp ${versionString()}: ${TOOLS.length} tools, API ${apiUrl}`)
}

async function main(): Promise<void> {
  const command = process.argv[2]

  if (command === 'login') {
    const path = await login(resolveApiUrl())
    console.error(`Saved credentials to ${path}`)
    return
  }

  if (command === 'logout') {
    const removed = clearCredentials()
    console.error(
      removed ? `Signed out. Removed ${credentialsPath()}` : 'Already signed out — no stored credentials.',
    )
    // Saying "signed out" while an env token keeps working would be a lie: the server
    // prefers NORTEZH_TOKEN over the file and would still authenticate.
    if (process.env[TOKEN_ENV]?.trim()) {
      console.error(`⚠️  ${TOKEN_ENV} is still set, so calls will keep using it. Unset it to fully sign out.`)
    }
    return
  }

  // The longer names are kept as aliases: `install-skill` is what this was called for its
  // first releases and is in shell history, and `install-plugin` names what it actually does.
  // `install` is the one to type — for a CLI whose other job is being an MCP server, there is
  // nothing else it could mean.
  if (command === 'install' || command === 'install-plugin' || command === 'install-skill') {
    install()
    return
  }

  if (command === 'uninstall' || command === 'uninstall-plugin') {
    uninstall()
    return
  }

  if (command === 'version' || command === '--version') {
    const info = readBuildInfo()
    console.log(versionString(info))
    if (info.build === 0) {
      console.log('running from source — no build stamp. Run `npm run build` to stamp one.')
    } else {
      console.log(`build ${info.build}${info.commit === null ? '' : ` from ${info.commit}`}, built ${info.builtAt}`)
    }
    console.log(`${TOOLS.length} API tools + ${LOCAL_TOOLS.length} local`)
    return
  }

  if (command === 'help' || command === '--help') {
    console.log(
      [
        `nortezh-mcp ${versionString()}`,
        '',
        'Usage:',
        '  nortezh-mcp            run the MCP server over stdio (what an MCP client starts)',
        '  nortezh-mcp login      sign in via the browser and store a token',
        '  nortezh-mcp logout     delete the stored token',
        '  nortezh-mcp install    hook into Claude Code: registers the MCP server AND',
        '                         the nortezh:* skills, as one plugin',
        '  nortezh-mcp uninstall  unhook it again',
        '  nortezh-mcp version',
        '',
        'Environment:',
        `  ${API_URL_ENV}    API base URL including the /user prefix.`,
        `                     Defaults to ${DEFAULT_API_URL}`,
        '                     Local dev: http://localhost:18080/user',
        `  ${TOKEN_ENV}      a bearer token, used instead of the stored login.`,
        '                     Set it and the server never re-opens a browser.',
      ].join('\n'),
    )
    return
  }

  if (command !== undefined) {
    console.error(`Unknown command: ${command}. Try \`nortezh-mcp help\`.`)
    process.exitCode = 1
    return
  }

  await runServer()
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
