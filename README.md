# nortezh-mcp

Manage Nortezh by prompt. An [MCP](https://modelcontextprotocol.io) server giving Claude 55
tools over the Nortezh user API — projects, deployments, disks, databases, routes, domains.

Runs locally. Your token stays on your machine.

## Install

Needs **Node 18+** and **git**.

```bash
# 1. install
npm i -g github:Nortezh/nortezh-mcp

# 2. sign in — opens your browser
nortezh-mcp login

# 3. add it to Claude Code
claude mcp add nortezh --scope user -- nortezh-mcp
```

**4. Check it worked** — in a session, ask `call serverInfo`. You should get a version and
`55` API routes.

<details>
<summary>Without installing (npx)</summary>

```bash
npx -y github:Nortezh/nortezh-mcp login
claude mcp add nortezh --scope user -- npx -y github:Nortezh/nortezh-mcp
```

Always runs the latest `main`, but re-clones and recompiles on **every server start** —
about 5 seconds each time you open a session or reconnect. Fine for trying it out; the
global install is better for daily use.
</details>

## Updating

```bash
npm i -g github:Nortezh/nortezh-mcp     # pull the latest
```

Then reconnect from `/mcp` — the tool list is cached when a session connects.

`call serverInfo` tells you which build you are on. If it did not change, you did not
reconnect.

## Login

The token goes from your browser straight to the process and is saved to
`~/.nortezh/credentials.json` (mode `600`).

- **Lasts 7 days.** You do not have to track it — when it expires the server reopens the
  browser once and retries the call.
- Sign in again: rerun the `login` command.
- Sign out: `nortezh-mcp logout`

## Use it

Just ask:

- *"list my nortezh projects"*
- *"what's deployed in acme, and which ones are paused?"*
- *"cpu and memory for the api deployment over 24h"*
- *"roll back web to the previous revision"*
- *"add DATABASE_URL to the acme env group and redeploy api"*

For anything that **creates or changes** infrastructure, start with the guided workflow:

```
/mcp__nortezh__deploy-stack     set up or change a stack, end to end
/mcp__nortezh__resources        what each resource is and depends on
```

`deploy-stack` reads your repo, takes inventory, asks what it cannot work out, then writes a
plan and **waits for your approval before touching anything**. It creates the deployment
pointing at the tag CI will push — that first deploy fails on purpose — writes the GitHub
Actions workflow, and goes green once you push. It never builds images locally and never
asks for a credential; DNS records, service-account keys and pull secrets come back to you
with step-by-step instructions.

> ⚠️ Ask it *before* it starts calling tools. It is a slash command, so it only applies when
> you invoke it — a plain "deploy this to nortezh" runs without any of it.

## Good to know

> ⚠️ `dbPostgresGet` / `dbRedisGet` / `dbMongoGet` return the database password in plain
> text. That is what lets Claude build a connection string — but it then lives in the
> conversation and anywhere that is logged.

> ⚠️ **Creating a pull secret is deliberately not possible.** It would mean pasting registry
> credentials into the chat. You create it in the console and tell Claude its *name*.

Destructive tools carry the spec's `destructiveHint`, which is what makes your client
confirm first. It is a hint, not a gate — a client set to auto-approve will not stop.

Not included: billing, service accounts, CI/CD bindings, network policies, phone OTP,
payment channels.

## Troubleshooting

**Server will not start / `serverInfo` not found.** Usually no credentials yet. Run the
`login` command, then reconnect from `/mcp`.

**Browser never opened.** The URL is printed in the terminal too — open it by hand. The
login times out after 5 minutes; just rerun it.

**Every call fails, or `login` 404s.** `NORTEZH_API_URL` is missing the `/user` suffix.

**Browser cannot reach the URL.** A `*.internal.*` host resolves only inside the cluster.
Use the same name without `.internal`, over `https`.

**`UNAUTHORIZED` that re-login does not fix.** The stored token was issued against a
different API URL. `nortezh-mcp logout`, then sign in again.

**A change is not showing up.** The tool list is cached at connect time — reconnect from
`/mcp`, then `call serverInfo` to confirm the build changed. See [Updating](#updating).

**Nothing in `/mcp` at all.** Run `nortezh-mcp` by hand — startup errors go to stderr,
which the client may hide.

---

Changing the server, or adding tools: [DEVELOPMENT.md](./DEVELOPMENT.md).
