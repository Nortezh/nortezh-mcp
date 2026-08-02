# nortezh-mcp

Manage Nortezh in plain language. An [MCP](https://modelcontextprotocol.io) server giving
Claude 55 tools over the Nortezh user API — projects, deployments, disks, databases, routes,
domains — plus the skills that tell it how to use them safely.

Runs locally. Your token stays on your machine.

## Install

Needs **Node 18+** and **git**.

```bash
# 1. install
pnpm i -g --allow-build=nortezh-mcp github:Nortezh/nortezh-mcp

# 2. sign in — opens your browser
nortezh-mcp login

# 3. add the plugin — this is what registers the tools AND the skills
nortezh-mcp install
```

**4. Restart Claude Code** (or `/reload-plugins`), then check:

```bash
claude plugin details nortezh@skills-dir   # 4 skills, 1 MCP server, token cost
```

In a session, `call serverInfo` should report a version and `55` API routes.
(`claude plugin list` will not show it — that lists plugins installed from a marketplace.)

`--allow-build` in step 1 is required because the package compiles itself at install time.
Without it pnpm stops with `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`. On npm, drop the flag:
`npm i -g github:Nortezh/nortezh-mcp`.

### Why there is no `claude mcp add`

Step 3 links a Claude Code **plugin** into `~/.claude/skills/nortezh`. A directory there
auto-loads as `nortezh@skills-dir`, and this one ships both `.mcp.json` (the server) and the
`nortezh:*` skills — so one command does what `claude mcp add` plus a skill install used to.

It is a symlink into the npm package, which is the point: the tools and the guidance can never
be different builds. That is also why it is not `claude plugin install` — that installs from a
marketplace, as a separate clone, free to drift from the binary it drives.

**Re-run step 3 after every update** — see [Updating](#updating).

<details>
<summary>Upgrading from a manual <code>claude mcp add</code></summary>

If you registered the server by hand before, remove it — otherwise you get two servers called
`nortezh`:

```bash
claude mcp remove nortezh --scope user
```
</details>

<details>
<summary>Without installing</summary>

```bash
pnpm dlx --allow-build=nortezh-mcp github:Nortezh/nortezh-mcp login
claude mcp add nortezh --scope user -- pnpm dlx --allow-build=nortezh-mcp github:Nortezh/nortezh-mcp
```

Always runs the latest `main`, but re-clones and recompiles on **every server start** —
several seconds each time you open a session or reconnect. ⚠️ **And you get the 55 tools with
no guidance at all**: the skills come from the plugin, which only the global install can link.
Fine for a look around; not for deploying anything.
</details>

## Updating

```bash
pnpm i -g --allow-build=nortezh-mcp github:Nortezh/nortezh-mcp   # pull the latest
nortezh-mcp install                                              # re-point the plugin
```

Then restart Claude Code, or `/reload-plugins` and reconnect from `/mcp` — both the tool list
and the plugin are read when a session starts.

`call serverInfo` tells you which build you are on. If it did not change, you did not restart.

> ⚠️ The second command is not optional **on pnpm**. pnpm installs each version into its own
> content-addressed directory, so the plugin symlink still points at the version you had
> before — or at nothing, which takes the tools with it. npm replaces the package in place, so
> there it flows through on its own; re-running is harmless either way.

## Uninstalling

In this order — the first step needs the command to still exist.

```bash
nortezh-mcp uninstall     # unhook the plugin: server and skills both go
nortezh-mcp logout        # delete the stored token
rmdir ~/.nortezh          # logout removes the file, not the directory
pnpm rm -g nortezh-mcp    # npm rm -g nortezh-mcp
```

Then restart Claude Code.

`uninstall` only ever unlinks its own symlink, and refuses if `~/.claude/skills/nortezh` turns
out to be a real directory — that would be someone else's skill.

That is everything it wrote. Claude Code records **no** state for a plugin loaded from
`~/.claude/skills`, so there is nothing to clean out of `settings.json` or
`installed_plugins.json` the way a marketplace install would leave behind. (`claude plugin
uninstall` does not apply here — it refuses plugins with no marketplace backing and tells you
to delete the directory, which is what this command does.)

Two cases leave something behind:

- **You ran `claude mcp add nortezh` at some point.** That registration is yours, not the
  plugin's: `claude mcp remove nortezh --scope user`.
- **`NORTEZH_TOKEN` is set in your shell profile.** `logout` warns about this, because the
  server prefers it over the stored file — unset it or you are not actually signed out.

Nothing on Nortezh itself is affected: projects, deployments and databases are untouched.

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

> ⚠️ **Step 3 is what installs the skills.** They are the only place the rules live — the
> server itself ships tools and nothing else. Without the plugin, "deploy this to nortezh"
> runs with none of the guidance, including the part about not building images locally.

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

**Nothing in `/mcp` at all.** The server comes from the plugin now, so check that first:
`claude plugin details nortezh@skills-dir`. If that errors, the link is missing or stale —
re-run `nortezh-mcp install` and restart. If the plugin is fine, run `nortezh-mcp` by
hand; startup errors go to stderr, which the client may hide.

**Tools work but `nortezh:*` skills never fire.** Same plugin, so the same check. A common
cause is `~/.claude/skills/nortezh` being a real directory from an older install rather than a
symlink — `nortezh-mcp install` refuses to replace one, and says so.

**Two `nortezh` servers.** You ran `claude mcp add nortezh` at some point and the plugin now
registers it too. `claude mcp remove nortezh --scope user`.

---

Changing the server, or adding tools: [DEVELOPMENT.md](./DEVELOPMENT.md).
