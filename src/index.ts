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
import { API_URL_ENV, requireApiUrl, resolveAuth } from './config.js'
import { formatError, UNAUTHORIZED } from './envelope.js'
import { login } from './login.js'
import { TOOLS, type ToolSpec } from './generated/tools.js'

const VERSION = '0.1.0'

async function runServer(): Promise<void> {
  const { apiUrl, token } = resolveAuth()
  const client = new NortezhClient({ apiUrl, token })

  const byName = new Map<string, ToolSpec>(TOOLS.map((tool) => [tool.name, tool]))

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

    const outcome = await client.call(tool.route, request.params.arguments ?? {})

    if (outcome.ok) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(outcome.result, null, 2) }],
      }
    }

    // A domain error arrives as HTTP 200; reporting it as an MCP tool error is what stops
    // the model treating a failure as a result.
    const hint =
      outcome.code === UNAUTHORIZED
        ? '\n\nThe token is missing, invalid or expired (they last 7 days). Run `nortezh-mcp login`.'
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
    const path = await login(requireApiUrl())
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
        `  ${API_URL_ENV}    required — API base URL including /user,`,
        '                       e.g. http://localhost:18080/user',
        '  NORTEZH_TOKEN      optional — a bearer token, used instead of the stored login',
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
