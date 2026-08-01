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
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { NortezhClient } from './client.js'
import { API_URL_ENV, DEFAULT_API_URL, resolveApiUrl, resolveAuth, TOKEN_ENV } from './config.js'
import { formatError, UNAUTHORIZED } from './envelope.js'
import { login } from './login.js'
import { PROMPTS } from './prompts.js'
import { TOOLS, type ToolSpec } from './generated/tools.js'
import { LOCAL_TOOLS } from './local-tools.js'
import { readBuildInfo, versionString, VERSION } from './version.js'

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
  const server = new Server(
    { name: 'nortezh', version: versionString() },
    { capabilities: { tools: {}, prompts: {} } },
  )

  // Prompts are how a guided workflow ships WITH the server: the client surfaces them as
  // slash commands, so `claude mcp add` is the entire install. See src/prompts.ts.
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS.map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments,
    })),
  }))

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const prompt = PROMPTS.find((candidate) => candidate.name === request.params.name)
    if (prompt === undefined) throw new Error(`Unknown prompt: ${request.params.name}`)

    return {
      description: prompt.description,
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: prompt.render(request.params.arguments ?? {}),
          },
        },
      ],
    }
  })

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
      return { content: [{ type: 'text' as const, text: JSON.stringify(local.run(), null, 2) }] }
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

  if (command === 'version' || command === '--version') {
    const info = readBuildInfo()
    console.log(versionString(info))
    if (info.build === 0) {
      console.log('running from source — no build stamp. Run `npm run build` to stamp one.')
    } else {
      console.log(`build ${info.build}${info.commit === null ? '' : ` from ${info.commit}`}, built ${info.builtAt}`)
    }
    console.log(`${TOOLS.length} tools, ${PROMPTS.length} prompts`)
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
