# Development

Everything user-facing is in [README.md](./README.md). This is the part that matters if
you are changing the server.

```bash
pnpm install
pnpm check         # verify the committed tools.ts, typecheck, test
```

`check` does **not** regenerate `src/generated/tools.ts` — it generates into memory and
compares. Regenerating first would mean the tests grade the generator's fresh output
against itself, so a stale or hand-edited artifact would always pass. It works with no git
repository, which a `git diff` guard did not.

## Is the client running my build?

`pnpm build` stamps `dist/build-info.json` with a counter that increases every time, plus
the commit. It surfaces as `serverInfo.version`, so the server list shows:

```
0.1.0+build.12.a1b2c3d          build 12, clean tree
0.1.0+build.12.a1b2c3d-dirty    built from uncommitted changes
0.1.0+source                    running from src, never stamped
```

Everything after `+` is semver build metadata and ignored for precedence, so a client that
parses the string still reads `0.1.0`.

```bash
node dist/index.js version    # full stamp, build time, tool counts
```

The model cannot see `serverInfo.version` — it sees tool names, descriptions and schemas and
nothing else. So the same stamp is also exposed as a **`serverInfo` tool**, which is how you
ask *in chat* whether the connected server is current. It lives in `src/local-tools.ts` —
answered in-process, no API call, and checked before the generated tools so it still works
when the token has expired. It is the **only** local tool, and should stay that way: every
tool costs its description on every request.

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

`dist/` is gitignored. The package installs straight from git, and a global install does
**not** install devDependencies — so `tsx` and `typescript` are real **dependencies**, which
is what lets the `prepare` script compile on install. That costs every user ~40MB and a few
seconds of `tsc`; the alternative was committing build output, which goes stale silently.

Two consequences of building at install time:

- ⚠️ **pnpm refuses to run install-time build scripts on a git dependency** unless the
  package is allowlisted: `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`. Hence the
  `--allow-build=nortezh-mcp` in every install command in the README. npm has no such guard.
- `build` chains `tsx`/`tsc` **directly** rather than calling `npm run <sub-script>`. The
  install runs under whichever package manager the *user* chose, and only the binaries in
  `node_modules/.bin` are guaranteed to be there. (`prepare` still calls `npm run build` —
  one hop, and npm ships with Node.)

`.build-number` is gitignored too, so an installed copy always stamps `build.1`. For anything
that was not built in this working tree, the **commit** in the version string is the identity;
the counter only distinguishes local rebuilds.

`skills/` is committed and **is not generated** — it is hand-authored markdown, and the only
home the guidance has. Nothing in `src/` contains it.

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
src/humanize.ts        enum wire values -> words, plus the derived `state` (pure, tested)
src/client.ts          the only code that makes HTTP requests
src/login.ts           loopback browser login
src/local-tools.ts     serverInfo — the one tool answered in-process
src/install.ts         `install` / `uninstall` — the ~/.claude/skills/nortezh symlink
skills/nortezh/        the guidance: a Claude Code plugin, plain markdown, hand-authored
src/index.ts           MCP server, stdio transport
```

## The guidance lives in the skill, and nowhere else

⚠️ **Only a skill reaches the shell.** `docker build`, `docker push` and reading a credential
store never touch an MCP tool, so nothing inside the server can observe them — let alone stop
them. Anything that enforces at a tool call arrives after the damage. A skill's frontmatter is
in context from the first token of the turn, which is the only place early enough.

Two mechanisms were built for this job and removed once the skill existed:

- a **`GuideGate`** that refused the first mutating tool call — it fired at
  `deploymentCreate`, long after the image had been built and pushed;
- **MCP prompts** (`/nortezh:deployer`, `/nortezh:resources`) and a **`deployGuide`** tool,
  which delivered the same text a second and third way. The prompts needed a generator and a
  drift-check to stay equal to the skill; `deployGuide` cost ~90 tokens of description on
  every request. Both were duplicated work once `skills/nortezh/` existed.

So the server ships **tools only**, and `skills/nortezh/` is the single home for the
procedure. The trade is real and worth stating: an MCP client that does not load Claude Code
plugins — Cursor, Zed, Claude Desktop — gets the 55 tools and no guidance at all.

### skills/nortezh/ is a plugin, not one skill

`.claude-plugin/plugin.json` with `skills: ["./"]` is what makes each `skills/<name>/SKILL.md`
invocable as `nortezh:<name>`. Landing the directory at `~/.claude/skills/nortezh` is enough
for Claude Code to auto-load it as `nortezh@skills-dir` — no marketplace, no
`claude plugin install`. The root `SKILL.md` stays an ordinary always-on skill and routes
between the rest.

Measured by `claude plugin details nortezh@skills-dir` — use it rather than guessing from
file size, which undercounts:

```
                                always-on   on-invoke
SKILL.md                             ~60        ~700    router + the invariants
skills/resources/SKILL.md           ~100       ~5.7k    nortezh:resources
skills/deployer/SKILL.md             ~90      ~22.4k    nortezh:deployer
skills/reporter/SKILL.md             ~90       ~1.4k    nortezh:reporter
skills/troubleshooter/SKILL.md      ~120       ~1.8k    nortezh:troubleshooter
                                    ----
                            total   ~393   every session
```

Cost is graduated: only the descriptions are always on, and a body loads when it applies. A
read-only question costs the router plus `resources`; a real deploy pulls `deployer` too and
lands near 28k. One flat file would spend all of that answering "how much does a disk cost?".

⚠️ Adding a skill means adding a line to the router by hand. Nothing discovers a sibling.

`deployer` **references** `nortezh:resources` rather than inlining it — a skill can name
another skill, so duplicating would double the cost and give the next edit two places to
drift apart.

The router carries the invariants that must survive even if no capability is loaded — the same
ones that govern Bash, which is why they live in the always-loaded file.

Installed with `nortezh-mcp install`, an explicit command rather than an npm
`postinstall`: a package writing into someone's Claude config unasked is invisible to
uninstall.

### What the procedure guarantees

`deployer` is seven fixed steps, and two properties are load-bearing rather than stylistic:

- **Steps 1–5 are read-only.** The first mutating call happens in Step 6, after the user
  approves a written plan. Anything that would let a create slip earlier — a rule saying
  "there is no fixed sequence", an operation described before the gate — is a bug, and
  `test/guidance.test.ts` asserts against it.
- **The plan and report templates are part of the contract.** Their sections are asserted,
  including the ones people delete as noise: `Explicitly not doing`, `Not done`, `To undo`.
  A report that silently omits what did not run reads as success.

A third property is enforced by the **allowlist**, not the text: `pullsecretCreate` is
withheld. Its inputs are a registry `serverUrl`, `username` and `password`, so exposing it
means the credentials have to travel through the conversation to reach it. Instructing the
model not to call a tool it has is weaker than not shipping the tool — the skill explains the
reasoning so the next person does not add it back, and `WITHHELD_TOOLS` in
`test/guidance.test.ts` lets it name the tool without the existence check objecting.

The same logic covers images: the skill forbids `docker build` / `docker push` outright. A
laptop build pushes fine and the cluster pulls it happily — that is the problem: it is
unreviewed, unreproducible, and pushing it needs a **write** credential that does not belong
in the session. CI owns images: a deployment is created pointing at the tag CI will push,
fails once because nothing is there yet, and goes green when the workflow runs. Both rules are
written as the route that works rather than as a list of forbidden commands — a blocklist
cannot enumerate podman, nerdctl or whatever is next, and leaves the model to improvise an
alternative.

Output goes to a **terminal**, not a markdown viewer, so the templates use fenced blocks
rather than pipe tables, and emoji chips only on plain lines — never inside the box-drawing
diagram, where a double-width glyph breaks the boxes. Reference tables the model reads are
exempt; the rule is scoped to what reaches the user.

Write into a skill only what the tool schemas **cannot** carry:

- the order operations must happen in, and what depends on what
- which failures are expected rather than wrong (`CAN_MAP_ONLY_WEB_SERVICE` on a Worker,
  `DEPLOYMENT_CLUSTER_NOT_SUPPORT_TRIAL` on trial billing)
- asynchrony — that `deploymentGet` must be polled until its `state` leaves `deploying`
- steps that leave this API entirely: DNS records, GitHub secrets, service-account keys

Do **not** restate a single call's parameters. That comes from the generated schema, and a
copy only goes stale.

`test/guidance.test.ts` asserts the skill text directly — including that every tool it names
is actually exposed, and that the embedded GitHub Actions workflow is intact. That workflow
used to live inside a TypeScript template literal, where `${{ … }}` needed escaping and one
backslash too many shipped `\${{ secrets.X }}` — a workflow that reviewed fine and failed at
run time. It is plain markdown now, which is most of why the file moved.

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

## Status enums are translated on the way out

The API ships four encodings of "how far along is this": `api/deployment.ActionStatus` as a
name, `pkg/api.ActionStatus` (disk, database) as a bare `1`/`2`, route and pull-secret
`status` as `1`/`2`, and a revision's `status` as `1`/`2`/`3` where **`2` means deploying,
not success**. A report built straight off that JSON reads `actionStatus "success"` on one
line and `status 2` on the next for the same idea, which is what prompted this.

`src/humanize.ts` normalizes the result before it is serialized:

- `actionStatus` is emitted under the name **`status`**, always a name, never an integer.
- a derived **`state`** says what the resource *is* — `running`, `deploying`, `paused`,
  `pausing`, `deleting`, `deleted`, `ready`, `pending`, `verifying`, `failed` — by folding
  `action` together with the status. "success" answers whether the deployer converged;
  `state` answers the question that was actually asked. A **deployment or a database**
  reaches `running` (both are workloads); a disk, route or pull secret reaches `ready`,
  since nothing in them runs.
- `action` is passed through untouched.
- an unmapped value is passed through rather than guessed at. A new enum member translated
  into a name that happens to exist is a wrong answer nothing downstream can spot.

The mapping is **per tool**, not per field name — `TOOL_SHAPES` covers every allowlisted
operation whose 200-response schema carries `status` or `actionStatus`. Keying on the field
name alone would make a revision's `2` mean "success".

⚠️ The generated tool descriptions come from the backend's annotations and still say things
like "poll deployment.get's actionStatus". `outputNote()` appends the reconciling line at
`ListTools` time — not into `src/generated/tools.ts`, which is generated and never
hand-edited. A new tool with a status field needs an entry in `TOOL_SHAPES`; `test/
humanize.test.ts` fails if an entry names a tool that is not exposed, but nothing can detect
a tool that *should* have an entry and does not.

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
