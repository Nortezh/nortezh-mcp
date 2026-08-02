// Tools that answer from this process instead of calling the API.
//
// Everything in src/generated/tools.ts is a route on the Nortezh API, generated from the
// spec. This file is the other kind: a tool the server answers itself.
//
// There is exactly one, and keeping it that way is the point — every tool is paid for in
// context on every request, so a tool has to earn its description.
//
// `serverInfo` earns it because the build stamp does not reach the model. `serverInfo.version`
// carries the stamp to the MCP *client*, so a human can read it in the server list, but the
// model only ever sees tool names, descriptions and schemas. Without this, "which build am I
// talking to?" was unanswerable in chat unless a tool had just been added or removed — the
// one-shot signal the stamp was introduced to replace.
//
// A `deployGuide` tool used to sit here, returning the deploy procedure so the model could
// pull it without the user typing a slash command. It was removed with the prompts: the
// guidance now ships as the `nortezh` skill, which reaches the model earlier (before Bash,
// which no MCP mechanism can observe) and costs nothing until it fires. Keeping the tool would
// have meant ~90 tokens on every request to deliver the same text a second way.

import { readBuildInfo, versionString } from './version.js'
import { TOOLS } from './generated/tools.js'

export interface LocalTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  readOnly: boolean
  /** Answered in-process. No network, so no failure mode worth an error envelope. */
  run: () => unknown
}

export const LOCAL_TOOLS: LocalTool[] = [
  {
    name: 'serverInfo',
    description:
      'Version and build of this MCP server itself, not the Nortezh API. ' +
      'Call it to check whether the connected server is the current build — after a rebuild ' +
      'a client keeps the old process until it reconnects, and nothing else the model can ' +
      'see distinguishes them.',
    inputSchema: { type: 'object', properties: {} },
    readOnly: true,
    run: () => {
      const info = readBuildInfo()
      return {
        version: versionString(info),
        semver: info.version,
        // 0 means the server is running from source and was never stamped.
        build: info.build,
        commit: info.commit,
        builtAt: info.builtAt,
        stale: info.build === 0 ? 'unknown — running from source, no build stamp' : undefined,
        tools: TOOLS.length + LOCAL_TOOLS.length,
        apiRoutes: TOOLS.length,
        // The guidance lives in the bundled skill, not in this server. Naming it here is how
        // a session can tell whether the skill it is following came from this package.
        skill: 'nortezh (resources, deployer, reporter, troubleshooter)',
      }
    },
  },
]

export const LOCAL_TOOL_NAMES = new Set(LOCAL_TOOLS.map((tool) => tool.name))
