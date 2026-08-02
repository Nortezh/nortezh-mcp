// Tools that answer from this process instead of calling the API.
//
// Everything in src/generated/tools.ts is a route on the Nortezh API, generated from the
// spec. This file is the other kind: a tool the server answers itself.
//
// `serverInfo` exists because of a gap the build stamp did not close. `serverInfo.version`
// carries the stamp to the MCP *client*, so a human can read it in the server list — but the
// model never sees serverInfo. It sees tool names, descriptions and schemas, and nothing
// else. So "which build am I talking to?" was unanswerable in chat unless a tool had just
// been added or removed, which is exactly the one-shot signal the stamp replaced.
//
// `deployGuide` exists because a prompt is user-invoked only. See below.
//
// Keep this list short. Every tool is paid for in context on every request.

import { readBuildInfo, versionString } from './version.js'
import { PROMPTS } from './prompts.js'
import { TOOLS } from './generated/tools.js'

export interface LocalTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  readOnly: boolean
  /** Answered in-process. No network, so no failure mode worth an error envelope. */
  run: () => unknown
}

/**
 * The deploy-stack guidance, as `deployGuide` returns it.
 *
 * Rendered from the same PromptSpec the slash command uses, so the two cannot drift — one
 * procedure, reachable three ways: the slash command, this tool, and the bundled skill
 * (generated from the same source by scripts/generate-skill.ts).
 *
 * The prepended note exists because the prompt is written for the slash-command path, where
 * nothing has been said yet: rendered with no arguments it opens "the user gave nothing up
 * front". Reached as a tool result that is false — the request is already in the
 * conversation — and left uncorrected the model re-interviews the user for what they just
 * said.
 */
export const DEPLOY_STACK_GUIDE = [
  '⚠️ You are reading this mid-conversation, as a tool result. The user has already said',
  'what they want, above. Treat anything they have stated as answered and do not ask again.',
  'Everything else below applies unchanged.',
  '',
  '---',
  '',
  PROMPTS.find((prompt) => prompt.name === 'deploy-stack')?.render({}) ?? '',
].join('\n')

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
        prompts: PROMPTS.map((prompt) => prompt.name),
      }
    },
  },
  {
    name: 'deployGuide',
    // This description is the ENTIRE trigger surface. It is the only part of the guidance
    // that is always in context, and the model decides from it alone whether to pull the
    // rest — so it names the platform, the verbs, and the read-only cases to stay out of.
    //
    // Excluding lookups matters: firing on "what's deployed?" would load ~19k tokens to
    // answer a question that needs one tool call.
    description:
      'Read BEFORE any call that creates, changes or deletes something on Nortezh — ' +
      'deploying a service, adding or patching a deployment, database, disk, domain, route, ' +
      'env group or pull secret, wiring GitHub Actions for it, or working out why a Nortezh ' +
      'deploy failed. Returns the required order, the approval gate, and the steps the user ' +
      'must do themselves. Do NOT call it for read-only questions ("list my projects", ' +
      "\"what's deployed\", \"show metrics\") — use the nortezh tools directly for those.",
    inputSchema: { type: 'object', properties: {} },
    readOnly: true,
    // The tool exists because a prompt is user-invoked only (the model has no prompts/get),
    // so a plain "deploy this to nortezh" would otherwise run with none of it in context.
    run: () => DEPLOY_STACK_GUIDE,
  },
]

export const LOCAL_TOOL_NAMES = new Set(LOCAL_TOOLS.map((tool) => tool.name))
