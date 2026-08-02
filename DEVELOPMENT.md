# Development

Everything user-facing is in [README.md](./README.md). This is the part that matters if
you are changing the server.

```bash
npm run check      # verify the committed tools.ts, typecheck, test
```

`check` does **not** regenerate `src/generated/tools.ts` — it generates into memory and
compares. Regenerating first would mean the tests grade the generator's fresh output
against itself, so a stale or hand-edited artifact would always pass. It works with no git
repository, which a `git diff` guard did not.

## Is the client running my build?

`npm run build` stamps `dist/build-info.json` with a counter that increases every time, plus
the commit. It surfaces as `serverInfo.version`, so the server list shows:

```
0.1.0+build.12.a1b2c3d          build 12, clean tree
0.1.0+build.12.a1b2c3d-dirty    built from uncommitted changes
0.1.0+source                    running from src, never stamped
```

Everything after `+` is semver build metadata and ignored for precedence, so a client that
parses the string still reads `0.1.0`.

```bash
node dist/index.js version    # full stamp, build time, tool and prompt counts
```

The model cannot see `serverInfo.version` — it sees tool names, descriptions and schemas and
nothing else. So the same stamp is also exposed as a **`serverInfo` tool**, which is how you
ask *in chat* whether the connected server is current. It lives in `src/local-tools.ts`
alongside `deployGuide`: answered in-process, no API call, and checked before the generated
tools so it still works when the token has expired.

An MCP client caches the tool list at connect time, so **every rebuild needs a reconnect** —
and the reconnect has to happen after the build finishes, or it picks up a half-written
`dist`. Comparing the build number is how you tell.

The counter lives in `.build-number` (gitignored) so `rm -rf dist` does not reset it. The
stamp is written to `dist/`, never `src/`: it contains a timestamp and a counter that change
every run, and `check-generated.ts` compares committed generated output against a fresh
generation — a stamp in `src/` would fail that check permanently.

## Environment

Both optional; the defaults cover normal use, which is why they are not in the README.

| variable | default | |
|---|---|---|
| `NORTEZH_API_URL` | `https://api.nortezh.com/user` | must include `/user` — every user route is mounted under it |
| `NORTEZH_TOKEN` | — | use instead of the stored login. Never replaced, and no browser is opened, so this is what CI wants |

Point a client at a local stack:

```bash
claude mcp add nortezh-local --scope user \
  -e NORTEZH_API_URL=http://localhost:18080/user \
  -- node "$PWD/dist/index.js"
```

Register it under a **different name** than the production one, or you will be one
reconnect away from running a deploy against the wrong cluster.

## dist/ is built at install time

`dist/` is gitignored. The package installs straight from git, and `npm i -g` does **not**
install devDependencies — so `tsx` and `typescript` are real **dependencies**, which is what
lets the `prepare` script compile on install. That costs every user ~40MB and a few seconds
of `tsc`; the alternative was committing build output, which goes stale silently.

`skills/` **is** committed even though the build regenerates it. It is the guidance itself —
worth reviewing as a diff and reading on GitHub — and `scripts/check-skill.ts` fails the
build if it drifts from `src/prompts.ts`.

⚠️ `tsc` does not delete the output of a source file you removed. If you delete something in
`src/`, delete its `dist/` counterpart too, or it keeps being served.

## Layout

```
scripts/allowlist.ts   which operations become tools — the only hand-maintained list
scripts/generate.ts    spec + allowlist -> src/generated/tools.ts
scripts/sync-spec.ts   vendor swagger.json from ../nortezh-backend
scripts/check-generated.ts  fail if the committed tools.ts is not what the generator makes
scripts/stamp.ts       write dist/build-info.json — the per-build counter and commit
src/version.ts         read that stamp, or fall back when running from source
src/spec-types.ts      the Swagger 2.0 subset this spec actually uses
src/schema.ts          Swagger 2.0 -> JSON Schema (pure, tested)
src/envelope.ts        arpc envelope -> tool result or tool error (pure, tested)
src/client.ts          the only code that makes HTTP requests
src/login.ts           loopback browser login
src/prompts.ts         guided workflows exposed over prompts/list
src/local-tools.ts     tools answered in-process: serverInfo, deployGuide
src/guide-gate.ts      blocks the first write until the guidance has been delivered
src/index.ts           MCP server, stdio transport
```

## The guidance reaches the model three ways

An MCP prompt is **user-invoked only** — the model has no `prompts/get`, so a plain "deploy
this to nortezh" runs with none of it in context. That is not theoretical: a run on a build
containing every rule still built an image locally and pushed it with the laptop's docker
credential, because the slash command was never typed.

So one procedure, three doors, all rendering the same constant:

```
prompts.ts  DEPLOY_STACK
   ├─▶ /nortezh:deploy-stack         the user types it
   ├─▶ deployGuide tool              the model calls it — description always in context
   └─▶ GuideGate                     served on the first blocked write
```

`src/guide-gate.ts` blocks the **first mutating call** of a session and returns the guidance
as a tool error, so the call genuinely did not run and the model retries with the rules in
context. A `deployGuide` tool alone would not close this — the model still has to *choose* to
call it, and the failure being fixed is a model that did not.

- Read-only tools are never gated; the inventory step of the procedure needs them.
- The retry always proceeds — the guidance was in the blocked response, so blocking again
  would loop forever.
- Invoking a prompt or calling `deployGuide` satisfies it: there is nothing left to teach.
- Disabled when `NORTEZH_TOKEN` is set. That is CI, where nobody reads a tool error.

## Prompts are how a "skill" ships with the server

`src/prompts.ts` holds the guided workflows. The client lists them over `prompts/list` and
surfaces them as slash commands, so `claude mcp add` is the entire install — no `SKILL.md`
to symlink, and it works in any MCP client rather than only Claude Code.

`deploy-stack` is structured as seven fixed steps, and two of its properties are load-bearing
rather than stylistic:

- **Steps 1–5 are read-only.** The first mutating call happens in Step 6, after the user
  approves a written plan. Anything that would let a create slip earlier — a rule saying
  "there is no fixed sequence", an operation described before the gate — is a bug, and
  `test/prompts.test.ts` asserts against it.
- **The plan and report templates are part of the contract.** Their sections are asserted,
  including the ones people delete as noise: `Explicitly not doing`, `Not done`, `To undo`.
  A report that silently omits what did not run reads as success.

A third property is enforced by the **allowlist**, not the prompt: `pullsecretCreate` is
withheld. Its inputs are a registry `serverUrl`, `username` and `password`, so exposing it
means the credentials have to travel through the conversation to reach it. Instructing the
model not to call a tool it has is weaker than not shipping the tool — the prompt explains
the reasoning so the next person does not add it back, and `WITHHELD_TOOLS` in
`test/prompts.test.ts` lets the prompt name it without the existence check objecting.

The same logic covers images: the prompt forbids `docker build` / `docker push` outright.
A locally built image cannot be deployed (the cluster pulls from a registry) and pushing one
by hand needs the same credentials. CI owns images: a deployment is created pointing at the
tag CI will push, fails once because nothing is there yet, and goes green when the workflow
runs. Both rules are written as the route that works rather than as a list of forbidden
commands — a blocklist cannot enumerate podman, nerdctl or whatever is next, and leaves the
model to improvise an alternative.

Output goes to a **terminal**, not a markdown viewer, so the templates use fenced blocks
rather than pipe tables, and emoji chips only on plain lines — never inside the box-drawing
diagram, where a double-width glyph breaks the boxes. The prompt's own tables are reference
material for the model and are exempt; the rule is scoped to what reaches the user.

Write into a prompt only what the tool schemas **cannot** carry:

- the order operations must happen in, and what depends on what
- which failures are expected rather than wrong (`CAN_MAP_ONLY_WEB_SERVICE` on a Worker,
  `DEPLOYMENT_CLUSTER_NOT_SUPPORT_TRIAL` on trial billing)
- asynchrony — that `deploymentGet.actionStatus` must be polled until it leaves `pending`
- steps that leave this API entirely: DNS records, GitHub secrets, service-account keys

Do **not** restate a single call's parameters. That comes from the generated schema and a
copy only goes stale.

⚠️ The `deploy-stack` prompt embeds a GitHub Actions workflow inside a TypeScript template
literal, so `${{ … }}` has to be escaped. One backslash too many ships `\${{ secrets.X }}`,
which Actions treats as a literal string, and `\\` where the shell wants a single line
continuation — a workflow that reviews fine and fails at run time. `test/prompts.test.ts`
asserts the rendered text, and also that every tool the prompt names is actually exposed.

## Tools are generated, not written

Tool names, parameter schemas, `required[]` and the read-only/destructive hints all come
from the API's own OpenAPI spec — the same annotations that produce the Scalar docs at
`GET /user/docs`. `scripts/allowlist.ts` is the only hand-maintained file.

To add a tool, put its `operationId` in the allowlist and regenerate:

```bash
npm run generate && npm test
```

`src/generated/tools.ts` is committed, so a clone builds without running codegen and a
reviewer can see exactly what the tool surface became.

**Keep the set curated.** Every tool's schema is paid for in context on every request —
the current 55 cost ~10k tokens, and `npm run generate` prints the figure each run. Model
tool-selection degrades well before the full 98.

`operationId` values become MCP tool names and are effectively permanent — renaming one
breaks whatever was generated from the spec.

## After an API change

```bash
cd ../nortezh-backend && make docs   # regenerate the spec at its source
cd -
npm run sync-spec                    # vendor it into spec/
npm run generate
npm test
```

`spec/swagger.json` is vendored rather than read from the sibling checkout at build time,
so this repo builds standalone and in its own CI, and an API change lands as a reviewable
diff instead of silently reshaping the tools.

## The response envelope

The one thing a client over this API has to get right.

arpc answers a **domain error with HTTP 200** and `{"ok":false,"error":{...}}`, not a 4xx,
because `arpc.Error` implements `OKError`. A client that keys off the status code reports
real failures as successful calls, and the model then reasons on top of a result that
never existed.

`src/envelope.ts` maps it: `ok:true` unwraps `result`; `ok:false` becomes an MCP tool
error carrying the code, the message, and one line per failed validation rule. Each tool's
description also names the codes that route can return, from the spec's `x-error-codes`.

## Schema conversion

`src/schema.ts` turns Swagger 2.0 into the JSON Schema an MCP client expects:

- `#/definitions/X` → `#/$defs/X`
- only the definitions each tool actually reaches are inlined, not all 277 — cycle-guarded,
  since several refer back into themselves
- `x-enum-varnames` and friends are dropped; they are for humans reading the reference UI
- a lone `allOf: [{$ref}]` wrapper is flattened (swag emits it because draft-4 ignored
  siblings of `$ref`; 2020-12 does not)
- a dangling `$ref` throws rather than shipping a schema a client discovers is broken at
  call time

## `required[]` must mirror `Valid()`

The spec's `required[]` comes from `binding:"required"` tags in the Go source, and each one
mirrors that route's own `Valid()` exactly. Marking a field the code does not enforce makes
generated clients reject calls the API accepts. `deployment.list` and `domain.get` /
`domain.delete` enforce nothing at all, so they carry no `required` — `test/tools.test.ts`
asserts that.

## Auth

`login` uses the API's existing browser flow: `GET <apiUrl>/auth?state=<s>&callback=<url>`
runs Google OAuth and redirects to `callback` with `?state=<s>&code=<token>` appended. The
callback points at a loopback listener on a random port, so the token goes from the browser
straight to the process. `state` is verified on return.

Tokens last 7 days. On `UNAUTHORIZED` the server re-runs that flow once and retries the
call, unless `NORTEZH_TOKEN` was set — an explicitly supplied token is never replaced, and
CI has no browser to open. Concurrent tool calls share one login attempt.
