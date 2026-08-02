# nortezh-mcp

Manage Nortezh in plain language. An [MCP](https://modelcontextprotocol.io) server giving
Claude 55 tools over the Nortezh user API — projects, deployments, disks, databases, routes,
domains — plus the skills that tell it how to use them safely.

Runs locally. Your token stays on your machine.

## Install

Needs **Node 18+** and **git**.

```bash
pnpm i -g --allow-build=nortezh-mcp github:Nortezh/nortezh-mcp
nortezh-mcp login       # opens your browser
nortezh-mcp install     # registers the tools AND the skills, as one plugin
```

Restart Claude Code, then `call serverInfo` in a session — you should get a version and `55`
API routes.

- `--allow-build` is required: the package compiles itself at install time, and without the
  flag pnpm stops with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`. On npm, drop it.
- There is no `claude mcp add`. `install` links a plugin into `~/.claude/skills/nortezh` that
  carries the server *and* the skills, so they can never be different builds.
- Already ran `claude mcp add nortezh`? Remove it, or you get two servers by that name:
  `claude mcp remove nortezh --scope user`.

<details>
<summary>Without installing</summary>

```bash
pnpm dlx --allow-build=nortezh-mcp github:Nortezh/nortezh-mcp login
claude mcp add nortezh --scope user -- pnpm dlx --allow-build=nortezh-mcp github:Nortezh/nortezh-mcp
```

Always latest `main`, but re-clones and recompiles on **every server start**. ⚠️ You get the
55 tools and **no guidance** — the skills come from the plugin, which only a global install
can link. Fine for a look around; not for deploying.
</details>

## Updating

**It tells you.** The server compares the commit it was built from against `origin/main` once
a day, and when they differ it says so — in the session (the first tool result carries a
note), in `serverInfo`, and on `nortezh-mcp version`. It uses your own git access, the same
one the install used, and stays quiet when it cannot check. `NORTEZH_NO_UPDATE_CHECK=1` turns
it off.

```bash
pnpm i -g --allow-build=nortezh-mcp github:Nortezh/nortezh-mcp
nortezh-mcp install     # ⚠️ not optional on pnpm
```

Then restart Claude Code. `call serverInfo` tells you which build you are on; if it did not
change, you did not restart.

pnpm installs each version into its own directory, so the plugin link still points at the old
one — or at nothing, which takes the tools with it. npm replaces in place, so re-running is
merely harmless there.

## Uninstalling

```bash
nortezh-mcp uninstall --all   # unhook the plugin and delete the stored token
pnpm rm -g nortezh-mcp
```

Then restart Claude Code. That is everything it wrote — a plugin loaded from
`~/.claude/skills` leaves no state behind. Nothing on Nortezh is affected.

Without `--all`, `uninstall` leaves you signed in; unhooking and signing out are different
things, and only the second needs a browser round-trip to undo. If `NORTEZH_TOKEN` is set in
your shell profile, unset it — the server prefers it over the stored file.

## Login

The token goes from your browser straight to the process, into `~/.nortezh/credentials.json`
(mode `600`).

**Lasts 7 days**, and you do not have to track it — when it expires the server reopens the
browser once and retries the call. Sign out with `nortezh-mcp logout`.

## Use it

Just ask:

- *"list my nortezh projects"*
- *"what's deployed in acme, and which ones are paused?"*
- *"cpu and memory for the api deployment over 24h"*
- *"roll back web to the previous revision"*
- *"add DATABASE_URL to the acme env group and redeploy api"*

Claude loads the right guidance itself:

```
nortezh                  always on; routes to the rest and carries the hard rules
nortezh:resources        what each resource is, depends on, and how you know it is ready
nortezh:deployer         creating or changing anything — plan, approve, execute, report
nortezh:reporter         state of a project: running, pending, failing
nortezh:troubleshooter   why something is failing
```

Only the descriptions are always in context (~400 tokens for the set). Name one to force it —
*"use nortezh:troubleshooter on api"*.

`nortezh:deployer` reads your repo, takes inventory, asks what it cannot work out, then
**waits for your approval before touching anything**. It points the deployment at the tag CI
will push — that first deploy fails on purpose — writes the GitHub Actions workflow, and goes
green once you push. It never builds images locally and never asks for a credential.

> ⚠️ The skills are the only place the rules live; the server ships tools and nothing else.
> Skip `nortezh-mcp install` and "deploy this to nortezh" runs with none of them.

## Good to know

> ⚠️ `dbPostgresGet` / `dbRedisGet` / `dbMongoGet` return the database password in plain text.
> That is what lets Claude build a connection string — but it then lives in the conversation
> and anywhere that is logged.

> ⚠️ **Creating a pull secret is deliberately not possible.** It would mean pasting registry
> credentials into the chat. You create it in the console and tell Claude its *name*.

Destructive tools carry the spec's `destructiveHint`, which is what makes your client confirm
first. It is a hint, not a gate — a client set to auto-approve will not stop.

Not included: billing, service accounts, CI/CD bindings, network policies, phone OTP, payment
channels.

## Troubleshooting

**Nothing in `/mcp` at all.** The server comes from the plugin — check it with
`claude plugin details nortezh@skills-dir`. If that errors, the link is missing or stale: run
`nortezh-mcp install` and restart. (`claude plugin list` never shows it; that lists
marketplace installs.) If the plugin is fine, run `nortezh-mcp` by hand — startup errors go to
stderr, which the client may hide.

**Tools work but `nortezh:*` skills never fire.** Same check. Usually
`~/.claude/skills/nortezh` is a real directory from an older install rather than a symlink —
`nortezh-mcp install` refuses to replace one, and says so.

**Two `nortezh` servers.** A leftover `claude mcp add`:
`claude mcp remove nortezh --scope user`.

**Server will not start / `serverInfo` not found.** Usually no credentials yet. Run
`nortezh-mcp login`, then reconnect from `/mcp`.

**Browser never opened.** The URL is printed too — open it by hand. Login times out after 5
minutes; rerun it.

**Every call fails, or `login` 404s.** `NORTEZH_API_URL` is missing its `/user` suffix.

**Browser cannot reach the URL.** A `*.internal.*` host resolves only inside the cluster. Use
the same name without `.internal`, over `https`.

**`UNAUTHORIZED` that re-login does not fix.** The stored token was issued against a different
API URL. `nortezh-mcp logout`, then sign in again.

**A change is not showing up.** The tool list is cached at connect time — restart, then
`call serverInfo` to confirm the build changed.

---

Changing the server, or adding tools: [DEVELOPMENT.md](./DEVELOPMENT.md).
