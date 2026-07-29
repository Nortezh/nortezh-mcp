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

Then sign in. Production is the default, so this is the whole setup:

```bash
node dist/index.js login
```

That opens your browser, runs the normal Google login, and writes the token to
`~/.nortezh/credentials.json` (mode `600`).

Tokens last **7 days**. You do not have to track that: when a tool call comes back
`UNAUTHORIZED`, the server re-opens the browser once and retries the call. Set
`NORTEZH_TOKEN` if you would rather it never did that.

To point somewhere else, set `NORTEZH_API_URL` — the user API base URL **including the
`/user` prefix**:

```bash
export NORTEZH_API_URL=http://localhost:18080/user   # local stack
```

| | |
|---|---|
| production (default) | `https://api.nortezh.com/user` |
| local | `http://localhost:18080/user` |

Two ways to get that wrong, both of which fail without saying why:

- **Dropping `/user`.** `cmd/api/main.go` mounts every user route under
  `mux.Group("/user", nil)`, so a correct host without the prefix routes nothing.
- **Using a `*.internal.*` host.** That is the cluster-internal ingress — ingress class
  `parapet-internal`, no public load balancer, no TLS (`deployer/k8s/ingress.go:134-136`)
  — so it only resolves from inside the cluster. The external host is the same name with
  `.internal` removed, over `https`.

## MCP client configuration

Claude Desktop (`claude_desktop_config.json`) or Claude Code (`.mcp.json`):

```json
{
  "mcpServers": {
    "nortezh": {
      "command": "node",
      "args": ["/absolute/path/to/nortezh-mcp/dist/index.js"]
    }
  }
}
```

Add `"env": { "NORTEZH_API_URL": "http://localhost:18080/user" }` to point at a local
stack instead of production.

`NORTEZH_TOKEN` can be set instead of logging in. It takes precedence over the stored
credentials and **disables the automatic re-login**, which is what you want in CI or any
context with no browser.

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
