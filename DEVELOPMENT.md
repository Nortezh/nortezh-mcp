# Development

Everything user-facing is in [README.md](./README.md). This is the part that matters if
you are changing the server.

```bash
npm run check      # generate + typecheck + test
```

## Layout

```
scripts/allowlist.ts   which operations become tools — the only hand-maintained list
scripts/generate.ts    spec + allowlist -> src/generated/tools.ts
scripts/sync-spec.ts   vendor swagger.json from ../nortezh-backend
src/spec-types.ts      the Swagger 2.0 subset this spec actually uses
src/schema.ts          Swagger 2.0 -> JSON Schema (pure, tested)
src/envelope.ts        arpc envelope -> tool result or tool error (pure, tested)
src/client.ts          the only code that makes HTTP requests
src/login.ts           loopback browser login
src/index.ts           MCP server, stdio transport
```

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
the current 56 cost ~9k tokens, and `npm run generate` prints the figure each run. Model
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
