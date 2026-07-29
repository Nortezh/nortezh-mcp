# nortezh-mcp

An [MCP](https://modelcontextprotocol.io) server over the Nortezh user API, so an LLM can
manage projects, deployments, disks, databases, routes and domains by prompt.

It runs **locally, over stdio**: your MCP client starts this process on your machine and
the bearer token never leaves it. Nothing is deployed, and nothing in `nortezh-backend`
changes to support it.

The tool list is **generated from the API's own OpenAPI spec**, so tool names, parameter
schemas, `required` fields and the read-only/destructive safety hints all come from the
same annotations that produce the Scalar docs at `GET /user/docs`.

## Setup

```bash
npm install
npm run build
```

Then sign in. `NORTEZH_API_URL` is the user API base URL **including the `/user` prefix**:

```bash
export NORTEZH_API_URL=http://localhost:18080/user
node dist/index.js login
```

That opens your browser, runs the normal Google login, and writes the token to
`~/.nortezh/credentials.json` (mode `600`). Tokens last **7 days**, so expect to re-run it
about weekly — the server tells you when that is the problem.

## MCP client configuration

Claude Desktop (`claude_desktop_config.json`) or Claude Code (`.mcp.json`):

```json
{
  "mcpServers": {
    "nortezh": {
      "command": "node",
      "args": ["/absolute/path/to/nortezh-mcp/dist/index.js"],
      "env": {
        "NORTEZH_API_URL": "http://localhost:18080/user"
      }
    }
  }
}
```

`NORTEZH_TOKEN` can be set instead of logging in; it takes precedence over the stored
credentials, which is what you want in CI or a script.

There is **no default API URL** on purpose: no production hostname exists anywhere in the
nortezh workspace — the k8s manifests carry only a `${NT_API_ENDPOINT}` placeholder — so
any default here would be invented. Known-real values are the local one above and staging,
`https://api-stag-899570118063554590.rcf2.deploys.app/user`.

## Commands

| | |
|---|---|
| `nortezh-mcp` | run the MCP server over stdio (what the client starts) |
| `nortezh-mcp login` | browser sign-in, stores a token |
| `nortezh-mcp help` | usage |

## Tools

56 tools, curated from the API's 98 routes — 30 read-only, 11 destructive, 15 plain
writes. Roughly 9k tokens of schema, which the model pays on every request, which is why
the set is curated rather than complete.

| group | what |
|---|---|
| core compute | `authMe`, `clusterList`, projects, all of `deployment*`, env groups |
| storage & data | disks, managed Postgres/Redis/Mongo, pull secrets |
| networking | routes, custom domains |

Excluded on purpose: billing, service accounts, GitHub/CI-CD, network policies, phone OTP,
payment channels. Add an operation id to `scripts/allowlist.ts` and re-run
`npm run generate` — the schema comes from the spec, so there is nothing else to write.

> **`dbPostgresGet` / `dbRedisGet` / `dbMongoGet` return the database password in plain
> text, and it is passed through unmodified.** That is deliberate — it is what lets the
> model assemble a connection string — but it means the password enters the conversation
> and anything that stores or logs the conversation.

## Regenerating after an API change

```bash
cd ../nortezh-backend && make docs   # refresh the spec at its source
cd -
npm run sync-spec                    # vendor it into spec/
npm run generate                     # rebuild src/generated/tools.ts
npm test
```

`spec/swagger.json` is vendored rather than read from the sibling checkout at build time,
so this repo builds standalone and an API change lands as a reviewable diff instead of
silently reshaping the tools.

## The response envelope

The one thing a client over this API has to get right. arpc answers a **domain error with
HTTP 200** and `{"ok":false,"error":{...}}`, not a 4xx. A client that keys off the status
code reports real failures as successful calls.

`src/envelope.ts` maps them: `ok:true` unwraps `result`; `ok:false` becomes an MCP tool
error carrying the code, the message, and one line per failed validation rule. Each tool's
description also names the codes that route can return, from the spec's `x-error-codes`.

## Development

```bash
npm run check      # generate + typecheck + test
```

Layout:

```
scripts/allowlist.ts   which operations become tools — the only hand-maintained list
scripts/generate.ts    spec + allowlist -> src/generated/tools.ts
scripts/sync-spec.ts   vendor swagger.json from ../nortezh-backend
src/schema.ts          Swagger 2.0 -> JSON Schema (pure, tested)
src/envelope.ts        arpc envelope -> tool result or tool error (pure, tested)
src/client.ts          the only code that makes HTTP requests
src/login.ts           loopback browser login
src/index.ts           MCP server, stdio transport
```
