// Turning the API's enum wire values into words a developer can read.
//
// The backend ships four different encodings of "how far along is this", and the raw JSON
// reaches the model unexplained:
//
//   api/deployment.ActionStatus   string  pending | success | failed
//   pkg/api.ActionStatus          int     1 pending, 2 success        (disk, database)
//   route/pullsecret Status       int     1 pending, 2 success
//   deployment.RevisionItem       int     1 pending, 2 deploying, 3 deployed
//   domain.Status                 string  pending | success | error | verify
//
// So a report of a healthy project reads `actionStatus "success"` on one line and
// `status 2` on the next, for the same idea — and `2` means "deploying" on a revision and
// "success" everywhere else. This module normalizes all of it before the result is
// serialized:
//
//   - `actionStatus` is returned under the name `status`, never as a number.
//   - a derived `state` says what the resource IS — running, paused, deploying, ready —
//     a deployment and a database both `running`, a disk or route merely `ready` —
//     by folding `action` (the intent) together with the status (the progress). That is
//     the question being asked; "success" only answers whether the deployer converged.
//   - `action` is left alone. It already marshals as a name, and `state` is where the two
//     get combined.
//
// Pure functions, no IO, so the whole mapping is testable directly — same shape as
// envelope.ts.

/** Which of the API's status encodings a tool's result carries. */
export type ResultShape =
  | 'deployment'
  | 'database'
  | 'disk'
  | 'routeOrPullSecret'
  | 'domain'
  | 'revision'

/**
 * Tool -> the shape of its result.
 *
 * Derived by walking every allowlisted operation's 200-response schema in
 * spec/swagger.json for a `status` or `actionStatus` property; every one of them is here.
 * A tool that is absent is passed through untouched, which is the right default: inventing
 * a mapping for a field this table has not seen is how `2` would come to mean "success" on
 * a revision, where it means "deploying".
 */
export const TOOL_SHAPES: Readonly<Record<string, ResultShape>> = {
  deploymentGet: 'deployment',
  deploymentList: 'deployment',
  deploymentLogRevision: 'revision',
  diskGet: 'disk',
  diskList: 'disk',
  dbPostgresGet: 'database',
  dbPostgresList: 'database',
  dbRedisGet: 'database',
  dbRedisList: 'database',
  dbMongoGet: 'database',
  dbMongoList: 'database',
  routeGet: 'routeOrPullSecret',
  routeList: 'routeOrPullSecret',
  pullsecretGet: 'routeOrPullSecret',
  pullsecretList: 'routeOrPullSecret',
  domainGet: 'domain',
  domainList: 'domain',
}

/** pkg/api.ActionStatus, and route/pullsecret Status: the same two values. */
const ASYNC_STATUS: Readonly<Record<number, string>> = { 1: 'pending', 2: 'success' }

/** deployment.RevisionItem.Status — three values, and `2` is NOT "success" here. */
const REVISION_STATUS: Readonly<Record<number, string>> = {
  1: 'pending',
  2: 'deploying',
  3: 'deployed',
}

/** A resource whose only intent is "exist": pending until the deployer applies it. */
const ASYNC_STATE: Readonly<Record<string, string>> = { pending: 'pending', success: 'ready' }

/**
 * A database is a workload, not a piece of config — once provisioned it is a process
 * serving connections, so it reads `running` like a deployment does. Disks, routes and
 * pull secrets are `ready`: nothing in them runs.
 */
const DATABASE_STATE: Readonly<Record<string, string>> = { pending: 'pending', success: 'running' }

/** action x actionStatus -> what the deployment currently IS. */
const DEPLOYMENT_STATE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  deploy: { pending: 'deploying', success: 'running', failed: 'failed' },
  pause: { pending: 'pausing', success: 'paused', failed: 'failed' },
  delete: { pending: 'deleting', success: 'deleted', failed: 'failed' },
}

/** action x status -> what the domain currently IS. `error` is a real outcome. */
const DOMAIN_STATE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  create: { pending: 'pending', verify: 'verifying', success: 'ready', error: 'failed' },
  delete: { pending: 'deleting', verify: 'deleting', success: 'deleted', error: 'failed' },
}

/**
 * What to append to a tool's description, so the schema the model was given and the JSON it
 * gets back agree on the field name.
 *
 * The descriptions are generated from the backend's own annotations and say things like
 * "poll deployment.get's actionStatus" — a pointer at a field this server no longer emits.
 * Applied at read time rather than written into src/generated/tools.ts, which is generated
 * and must never be hand-edited.
 */
export function outputNote(toolName: string): string | undefined {
  const shape = TOOL_SHAPES[toolName]
  if (shape === undefined) return undefined

  switch (shape) {
    case 'deployment':
      return (
        'Output note: this server returns `actionStatus` under the name `status` (always a ' +
        'name: pending, success, failed) and adds a derived `state` — running, deploying, ' +
        'paused, pausing, deleting, deleted or failed — which folds `action` and the status ' +
        'together. Poll `state`, or `status`; there is no `actionStatus` field in the output.'
      )
    case 'database':
      return (
        'Output note: this server returns `actionStatus` under the name `status`, as a name ' +
        'rather than the API\'s raw integer (1 -> "pending", 2 -> "success"), and adds a ' +
        'derived `state`: "pending" or "running". There is no `actionStatus` field in the ' +
        'output, and no failure value exists for this resource — a database that never ' +
        'provisions stays "pending" forever.'
      )
    case 'disk':
      return (
        'Output note: this server returns `actionStatus` under the name `status`, as a name ' +
        'rather than the API\'s raw integer (1 -> "pending", 2 -> "success"), and adds a ' +
        'derived `state`: "pending" or "ready". There is no `actionStatus` field in the ' +
        'output, and no failure value exists for this resource.'
      )
    case 'routeOrPullSecret':
      return (
        'Output note: `status` is returned as a name rather than the API\'s raw integer ' +
        '(1 -> "pending", 2 -> "success"), plus a derived `state`: "pending" or "ready". No ' +
        'failure value exists for this resource.'
      )
    case 'revision':
      return (
        'Output note: each revision\'s `status` is returned as a name rather than the API\'s ' +
        'raw integer: 1 -> "pending", 2 -> "deploying", 3 -> "deployed". Note `2` here is ' +
        '"deploying", not "success".'
      )
    case 'domain':
      return (
        'Output note: this server adds a derived `state` next to `status` — ready, pending, ' +
        'verifying, deleting, deleted or failed — folding `action` and `status` together. ' +
        '`status` itself is unchanged (pending, success, error, verify).'
      )
  }
}

/**
 * Rewrites one tool result into the readable form.
 *
 * Unknown tool, or a value this module has no mapping for, is returned untouched: a wrong
 * translation is worse than an unreadable one, because it cannot be spotted downstream.
 */
export function humanize(toolName: string, result: unknown): unknown {
  const shape = TOOL_SHAPES[toolName]
  if (shape === undefined) return result
  return walk(result, shape)
}

function walk(value: unknown, shape: ResultShape): unknown {
  if (Array.isArray(value)) return value.map((entry) => walk(entry, shape))
  if (value === null || typeof value !== 'object') return value
  return rewrite(value as Record<string, unknown>, shape)
}

function rewrite(node: Record<string, unknown>, shape: ResultShape): Record<string, unknown> {
  const source = sourceKey(node, shape)
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(node)) {
    if (key !== source) {
      out[key] = walk(value, shape)
      continue
    }

    // Renaming into a key the object already uses would drop a real field, so in that
    // case the original name is kept. No response schema does this today; the guard is
    // here because a future field would otherwise lose data silently.
    const name = source === 'actionStatus' && !('status' in node) ? 'status' : source
    const readable = readableStatus(value, shape)
    out[name] = readable ?? value

    const state = deriveState(node, readable, shape)
    if (state !== undefined) out['state'] = state
  }

  return out
}

/** The key this shape carries its progress in — the one that gets rewritten. */
function sourceKey(node: Record<string, unknown>, shape: ResultShape): string | undefined {
  switch (shape) {
    case 'deployment':
    case 'database':
    case 'disk':
      return 'actionStatus' in node ? 'actionStatus' : undefined
    case 'routeOrPullSecret':
    case 'revision':
    case 'domain':
      return 'status' in node ? 'status' : undefined
  }
}

/** The status as a name, or undefined when there is no mapping for this value. */
function readableStatus(value: unknown, shape: ResultShape): string | undefined {
  switch (shape) {
    case 'deployment':
    case 'domain':
      // Already a name on the wire — nothing to translate.
      return typeof value === 'string' ? value : undefined
    case 'database':
    case 'disk':
    case 'routeOrPullSecret':
      return typeof value === 'number' ? ASYNC_STATUS[value] : undefined
    case 'revision':
      return typeof value === 'number' ? REVISION_STATUS[value] : undefined
  }
}

function deriveState(
  node: Record<string, unknown>,
  status: string | undefined,
  shape: ResultShape,
): string | undefined {
  if (status === undefined) return undefined

  switch (shape) {
    case 'deployment':
      return byAction(DEPLOYMENT_STATE, node['action'], status)
    case 'domain':
      return byAction(DOMAIN_STATE, node['action'], status)
    case 'database':
      return DATABASE_STATE[status]
    case 'disk':
    case 'routeOrPullSecret':
      return ASYNC_STATE[status]
    case 'revision':
      // A revision has no action of its own, and its status names already read as states.
      // A second field repeating the first would only be one more thing to disagree.
      return undefined
  }
}

function byAction(
  table: Readonly<Record<string, Readonly<Record<string, string>>>>,
  action: unknown,
  status: string,
): string | undefined {
  if (typeof action !== 'string') return undefined
  return table[action]?.[status]
}
