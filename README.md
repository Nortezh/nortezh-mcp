# nortezh-mcp

Manage Nortezh by prompt. An [MCP](https://modelcontextprotocol.io) server that gives
Claude 56 tools over the Nortezh user API — projects, deployments, disks, managed
databases, routes and domains.

Runs **locally**. Your token stays on your machine; nothing is deployed.

## Install

```bash
git clone git@github.com:Nortezh/nortezh-mcp.git
cd nortezh-mcp
npm install && npm run build
node dist/index.js login
```

`login` opens your browser for the normal Google sign-in and saves the token to
`~/.nortezh/credentials.json` (mode `600`). Tokens last 7 days; when one expires the
server re-opens the browser once and retries — you do not have to track it.

Requires Node 18+.

## Add to Claude

```bash
claude mcp add nortezh --scope user -- node "$PWD/dist/index.js"
```

`--scope user` makes it available in every project. Check with `claude mcp list`, or
`/mcp` inside a session. Remove with `claude mcp remove nortezh --scope user`.

<details>
<summary>Claude Desktop, or any other MCP client</summary>

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
</details>

## Use it

Just ask:

- *"list my nortezh projects"*
- *"what's deployed in project acme, and which ones are paused?"*
- *"show me cpu and memory for the api deployment over the last 24h"*
- *"roll back web to the previous revision"*
- *"create a 20Gi disk called uploads in acme, location rcf2"*
- *"add DATABASE_URL to the acme env group and redeploy api"*

Destructive tools (`deploymentDelete`, `deploymentRollback`, `diskDelete`, …) are marked
as such in the spec, so Claude asks before running them.

## Guided workflows

The server ships a prompt, so it arrives with `claude mcp add` — nothing extra to install:

```
/mcp__nortezh__deploy-stack     set up or change a stack, end to end
/mcp__nortezh__resources       what each resource is and what it depends on
```

**`deploy-stack`** covers the whole job, from reading your repo to continuous deploys. It
starts by working out your service topology from `docker-compose.yml`, Dockerfiles and
`.env.example`, then asks what you actually want — patch an existing deployment, add to a
project, build from nothing, or just wire CI — and does only that.

It takes inventory before proposing anything and offers what already exists first, so it is
safe to re-run on a half-built stack and will not create a duplicate of something you
have. All arguments are optional (`project`, `name`, `image`, `location`, `domain`,
`repo`) — pass what you know, it asks for the rest as it goes.

Three steps it deliberately hands back to you rather than doing itself: creating a project
(that needs a billing account UUID no exposed tool returns), adding the DNS record a domain
needs, and minting the service-account key the CI workflow authenticates with.

**`resources`** is the reference behind it: every resource's definition, what it depends on
in both directions, how you tell it is ready — which differs for all four of deployment,
database, disk and route — and what can still be changed after it exists.

`deploy-stack` **embeds `resources` verbatim**, so it is self-contained; run `resources` on
its own when you want the model without the procedure. (A prompt cannot fetch another
prompt, so a cross-reference would be advice the model could not act on.)

## Tools

56 of the API's 98 routes — 30 read-only, 11 destructive, 15 plain writes.

| group | tools |
|---|---|
| core | `authMe`, `clusterList`, projects (6), deployments (11), env groups (5) |
| storage | disks (7), Postgres/Redis/Mongo (12), pull secrets (4) |
| networking | routes (4), custom domains (5) |

Not included: billing, service accounts, GitHub/CI-CD, network policies, phone OTP,
payment channels. The set is curated because every tool's schema costs context on every
request — see [DEVELOPMENT.md](./DEVELOPMENT.md) to add one.

> ⚠️ `dbPostgresGet` / `dbRedisGet` / `dbMongoGet` return the database password in plain
> text and pass it through unmodified. That is what lets Claude build a connection string,
> but the password then lives in the conversation and anywhere it is logged.

## Configuration

Both optional — the defaults cover normal use.

| variable | default | |
|---|---|---|
| `NORTEZH_API_URL` | `https://api.nortezh.com/user` | API base URL, **including `/user`** |
| `NORTEZH_TOKEN` | — | a token to use instead of the stored login; also turns off automatic re-login (for CI) |

Point at a local stack:

```bash
claude mcp add nortezh --scope user \
  -e NORTEZH_API_URL=http://localhost:18080/user \
  -- node "$PWD/dist/index.js"
```

## Troubleshooting

**Every call fails, or `login` 404s.** `NORTEZH_API_URL` is probably missing the `/user`
suffix. Every user route is mounted under it, so a correct host without it routes nothing.

**The browser cannot reach the URL.** A `*.internal.*` host is the cluster-internal
ingress — no public load balancer, no TLS, resolves only from inside the cluster. Use the
same name with `.internal` removed, over `https`.

**`UNAUTHORIZED` that re-login does not fix.** The token is fine but the API URL is wrong,
or the stored credentials were issued against a different one. `rm ~/.nortezh/credentials.json`
and log in again.

**Nothing appears in `/mcp`.** Run `node dist/index.js` by hand — startup errors go to
stderr, which the client may be hiding.

---

Building on it, or adding tools: [DEVELOPMENT.md](./DEVELOPMENT.md).
