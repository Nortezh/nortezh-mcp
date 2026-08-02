# nortezh-mcp

Manage Nortezh by prompt. An [MCP](https://modelcontextprotocol.io) server giving Claude 55
tools over the Nortezh user API — projects, deployments, disks, databases, routes, domains.

Runs locally. Your token stays on your machine.

## Install

Needs **Node 18+** and **git**.

```bash
# 1. install
pnpm i -g --allow-build=nortezh-mcp github:Nortezh/nortezh-mcp

# 2. sign in — opens your browser
nortezh-mcp login

# 3. add it to Claude Code
claude mcp add nortezh --scope user -- nortezh-mcp

# 4. install the skills (Claude Code only)
nortezh-mcp install-skill
```

**5. Check it worked** — in a session, ask `call serverInfo`. You should get a version and
`55` API routes.

The skills are what make Claude follow the rules when you just say *"deploy this to nortezh"*
without typing a slash command. **Re-run step 4 after every update** — see
[Updating](#updating).

`--allow-build` is required because the package compiles itself at install time. Without it
pnpm stops with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`. On npm, drop the flag:
`npm i -g github:Nortezh/nortezh-mcp`.

<details>
<summary>Without installing</summary>

```bash
pnpm dlx --allow-build=nortezh-mcp github:Nortezh/nortezh-mcp login
claude mcp add nortezh --scope user -- pnpm dlx --allow-build=nortezh-mcp github:Nortezh/nortezh-mcp
```

Always runs the latest `main`, but re-clones and recompiles on **every server start** —
several seconds each time you open a session or reconnect, and no skill. Fine for trying it
out; the global install is better for daily use.
</details>

## Updating

```bash
pnpm i -g --allow-build=nortezh-mcp github:Nortezh/nortezh-mcp   # pull the latest
nortezh-mcp install-skill                                        # re-point the skill
```

Then reconnect from `/mcp` — the tool list is cached when a session connects.

`call serverInfo` tells you which build you are on. If it did not change, you did not
reconnect.

> ⚠️ The second command is not optional **on pnpm**. pnpm installs each version into its own
> content-addressed directory, so the skill symlink still points at the version you had
> before — or at nothing. npm replaces the package in place, so there it flows through on its
> own; re-running is harmless either way.

## Uninstalling

In this order — the first step needs the command to still exist.

```bash
nortezh-mcp logout                    # delete the stored token
rm ~/.claude/skills/nortezh           # the skill (a symlink; nothing else is touched)
claude mcp remove nortezh --scope user
pnpm rm -g nortezh-mcp                # npm rm -g nortezh-mcp
```

That is everything it put on your machine. `logout` removes
`~/.nortezh/credentials.json`; if you skip it the token sits there until it expires. Nothing
on Nortezh itself is affected — projects, deployments and databases are untouched.

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

Claude loads the right guidance on its own — the skills install as a small plugin:

```
nortezh                  always on; routes to the rest and carries the hard rules
nortezh:resources        what each resource is, depends on, and how you know it is ready
nortezh:deployer         creating or changing anything — plan, approve, execute, report
nortezh:reporter         state of a project: running, pending, failing
nortezh:troubleshooter   why something is failing
```

Only the descriptions are always in context (~400 tokens for the set); a skill's body loads
when it applies. Ask for one by name if you want to force it — *"use nortezh:troubleshooter
on api"*.

`nortezh:deployer` reads your repo, takes inventory, asks what it cannot work out, then writes
a plan and **waits for your approval before touching anything**. It creates the deployment
pointing at the tag CI will push — that first deploy fails on purpose — writes the GitHub
Actions workflow, and goes green once you push. It never builds images locally and never
asks for a credential; DNS records, service-account keys and pull secrets come back to you
with step-by-step instructions.

> ⚠️ **Step 4 is not optional if you want any of that.** The skills are the only place the
> rules live — the server itself ships tools and nothing else. Without them, "deploy this to
> nortezh" runs with none of the guidance, including the part about not building images
> locally.

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
