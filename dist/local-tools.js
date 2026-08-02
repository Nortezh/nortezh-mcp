// Tools that answer from this process instead of calling the API.
//
// Everything in src/generated/tools.ts is a route on the Nortezh API, generated from the
// spec. This file is the other kind: a tool the server answers itself.
//
// There is exactly one, and it exists because of a gap the build stamp did not close.
// `serverInfo.version` carries the stamp to the MCP *client*, so a human can read it in the
// server list — but the model never sees serverInfo. It sees tool names, descriptions and
// schemas, and nothing else. So "which build am I talking to?" was unanswerable in chat
// unless a tool had just been added or removed, which is exactly the one-shot signal the
// stamp replaced.
//
// Keep this list at one entry unless there is as good a reason. Every tool is paid for in
// context on every request.
import { readBuildInfo, versionString } from './version.js';
import { PROMPTS } from './prompts.js';
import { TOOLS } from './generated/tools.js';
export const LOCAL_TOOLS = [
    {
        name: 'serverInfo',
        description: 'Version and build of this MCP server itself, not the Nortezh API. ' +
            'Call it to check whether the connected server is the current build — after a rebuild ' +
            'a client keeps the old process until it reconnects, and nothing else the model can ' +
            'see distinguishes them.',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        run: () => {
            const info = readBuildInfo();
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
            };
        },
    },
];
export const LOCAL_TOOL_NAMES = new Set(LOCAL_TOOLS.map((tool) => tool.name));
//# sourceMappingURL=local-tools.js.map