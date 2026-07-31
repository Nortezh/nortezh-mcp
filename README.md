# nortezh-mcp

Manage Nortezh by prompt. An [MCP](https://modelcontextprotocol.io) server that gives
Claude 55 tools over the Nortezh user API — projects, deployments, disks, managed
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
- *"create a 20 GB disk called uploads in acme, location rcf2"* (disk size is in MB — that
  is `20480`)
- *"add DATABASE_URL to the acme env group and redeploy api"*

Destructive tools (`deploymentDelete`, `deploymentRollback`, `diskDelete`, …) carry the
spec's `destructiveHint`, which is what prompts your client to confirm before running one.
It is a hint, not an enforced gate — a client configured to auto-approve tools will not
stop for it.

## Guided workflows

The server ships a prompt, so it arrives with `claude mcp add` — nothing extra to install:

```
/mcp__nortezh__deploy-stack     set up or change a stack, end to end
/mcp__nortezh__resources       what each resource is and what it depends on
```

**`deploy-stack`** covers the whole job, from reading your repo to continuous deploys, and
runs as seven fixed steps:

1. take the request
2. **ask which project** — always, every run
3. loop: work out your architecture from `docker-compose.yml`, Dockerfiles and
   `.env.example` → take inventory of what already exists → clarify. The loop does not exit
   while anything is still a guess.
4. write a plan — one section per resource kind, a diagram, and before/after for every change
5. **your explicit approval**
6. execute exactly that
7. report what actually ran, including what failed and what is still yours to do

**Nothing is created, changed or deleted before step 5.** Steps 1–4 use read-only tools
only, so it is safe to run it just to see what it would propose.

**It never builds a container image.** New deployments are created with a public placeholder
image, and the GitHub Actions workflow it writes replaces that with the real one on its first
run. An image built on your laptop cannot be deployed anyway — the cluster pulls from a
registry — and pushing one by hand would mean registry credentials going through the chat.

It offers what already exists ahead of creating anything, so re-running it on a half-built
stack will not duplicate what you have. All arguments are optional (`project`, `name`,
`image`, `location`, `domain`, `repo`) — pass what you know, it asks for the rest.

Three steps it deliberately hands back to you rather than doing itself: adding the DNS
record a domain needs, minting the service-account key the CI workflow authenticates with,
and creating a pull secret if your registry is private.
(Creating a project it can do — `projectCreate` needs a billing account UUID, which
`projectGet` returns for any project you already have. Only your very first one has to come
from the console.)

**`resources`** is the reference behind it: every resource's definition, what it depends on
in both directions, how you tell it is ready — no two resources report that the same way,
and only deployments and domains can report failure at all — and what can still be changed
after it exists.

`deploy-stack` **embeds `resources` verbatim**, so it is self-contained; run `resources` on
its own when you want the model without the procedure. (A prompt cannot fetch another
prompt, so a cross-reference would be advice the model could not act on.)

## Tools

55 of the API's 98 routes — 30 read-only, 11 destructive, 14 plain writes.

| group | tools |
|---|---|
| core | `authMe`, `clusterList`, projects (6), deployments (11), env groups (5) |
| storage | disks (7), Postgres/Redis/Mongo (12), pull secrets (3) |
| networking | routes (4), custom domains (5) |

Not included: billing, service accounts, GitHub/CI-CD, network policies, phone OTP,
payment channels. The set is curated because every tool's schema costs context on every
request — see [DEVELOPMENT.md](./DEVELOPMENT.md) to add one.

> ⚠️ **`pullsecretCreate` is withheld on purpose.** It takes a registry `serverUrl`,
> `username` and `password`, so the only way to call it is to paste live registry credentials
> into the conversation. `deploy-stack` gives you console steps instead and asks only for the
> secret's *name*. Listing, reading and deleting pull secrets are all still available.

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
