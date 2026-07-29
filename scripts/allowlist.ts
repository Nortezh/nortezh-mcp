// Which of the API's 98 operations become MCP tools.
//
// Deliberately a curated subset, not everything. Model tool-selection degrades well
// before 98 tools, and every tool's schema is paid for in context on every single
// request — the current 56 cost roughly 10k tokens. Add an id here and re-run
// `npm run generate`; the schema, the required[] and the safety hints all come from the
// spec, so there is nothing else to write.
//
// The ids are the spec's `operationId` values, which are the route name with dots removed
// and camelCased (`/db.postgres.list` -> `dbPostgresList`). They are the MCP tool names
// users and prompts will refer to, so treat them as permanent.

/** projects, deployments, env groups — "manage my apps" */
export const CORE_COMPUTE = [
  'authMe',
  'clusterList',
  'projectList',
  'projectGet',
  'projectOverview',
  'projectCreate',
  'projectEdit',
  'projectListMember',
  'deploymentCreate',
  'deploymentDelete',
  'deploymentDeploy',
  'deploymentGet',
  'deploymentList',
  'deploymentListName',
  'deploymentLogRevision',
  'deploymentMetrics',
  'deploymentPause',
  'deploymentResume',
  'deploymentRollback',
  'envgroupCreate',
  'envgroupDelete',
  'envgroupGet',
  'envgroupList',
  'envgroupUpdate',
] as const

/**
 * disks, managed databases, registry pull secrets
 *
 * NOTE: dbPostgresGet / dbRedisGet / dbMongoGet return the database password in plain
 * text, and it is passed through to the model unmodified — a deliberate choice, since it
 * is what lets the model assemble a connection string. The password therefore lands in
 * the conversation and anywhere the conversation is stored or logged.
 */
export const STORAGE_AND_DATA = [
  'diskCount',
  'diskCreate',
  'diskDelete',
  'diskGet',
  'diskList',
  'diskMetrics',
  'diskUpdate',
  'dbPostgresCreate',
  'dbPostgresDelete',
  'dbPostgresGet',
  'dbPostgresList',
  'dbRedisCreate',
  'dbRedisDelete',
  'dbRedisGet',
  'dbRedisList',
  'dbMongoCreate',
  'dbMongoDelete',
  'dbMongoGet',
  'dbMongoList',
  'pullsecretCreate',
  'pullsecretDelete',
  'pullsecretGet',
  'pullsecretList',
] as const

/**
 * exposing a deployment: routes and custom domains
 *
 * networkPolicyProjectIsolation* is deliberately not here.
 */
export const NETWORKING = [
  'routeCreate',
  'routeDelete',
  'routeGet',
  'routeList',
  'domainAll',
  'domainCreate',
  'domainDelete',
  'domainGet',
  'domainList',
] as const

export const ALLOWLIST: readonly string[] = [
  ...CORE_COMPUTE,
  ...STORAGE_AND_DATA,
  ...NETWORKING,
]
