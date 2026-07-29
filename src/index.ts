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
import { API_URL_ENV, DEFAULT_API_URL, resolveApiUrl, resolveAuth, TOKEN_ENV } from './config.js'
import { formatError, UNAUTHORIZED } from './envelope.js'
import { login } from './login.js'
import { TOOLS, type ToolSpec } from './generated/tools.js'

const VERSION = '0.1.0'

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

  async function relogin(): Promise<boolean> {
    if (fromEnv) return false
    if (reloginInFlight !== null) return await reloginInFlight

    reloginInFlight = (async () => {
      try {
        console.error('Token rejected — reopening the browser to sign in again.')
        await login(apiUrl)
        client.setToken(resolveAuth().token)
        return true
      } catch (error) {
        console.error(`Re-login failed: ${error instanceof Error ? error.message : String(error)}`)
        return false
      } finally {
        reloginInFlight = null
      }
    })()

    return await reloginInFlight
  }

  const server = new Server(
    { name: 'nortezh', version: VERSION },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as { type: 'object' },
      annotations: {
        readOnlyHint: tool.readOnly,
        destructiveHint: tool.destructive,
        // Every tool reaches a remote API, so none of them is closed-world.
        openWorldHint: true,
      },
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name)
    if (tool === undefined) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Unknown tool: ${request.params.name}` }],
      }
    }

    const args = request.params.arguments ?? {}
    let outcome = await client.call(tool.route, args)

    // Retried at most once: if the fresh token is rejected too, the problem is not expiry.
    if (!outcome.ok && outcome.code === UNAUTHORIZED && (await relogin())) {
      outcome = await client.call(tool.route, args)
    }

    if (outcome.ok) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(outcome.result, null, 2) }],
      }
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
  console.error(`nortezh-mcp ${VERSION}: ${TOOLS.length} tools, API ${apiUrl}`)
}

async function main(): Promise<void> {
  const command = process.argv[2]

  if (command === 'login') {
    const path = await login(resolveApiUrl())
    console.error(`Saved credentials to ${path}`)
    return
  }

  if (command === 'version' || command === '--version') {
    console.log(VERSION)
    return
  }

  if (command === 'help' || command === '--help') {
    console.log(
      [
        `nortezh-mcp ${VERSION}`,
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
