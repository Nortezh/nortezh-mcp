import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PROMPTS } from '../src/prompts.js'
import { TOOLS } from '../src/generated/tools.js'

const deployStack = PROMPTS.find((prompt) => prompt.name === 'deploy-stack')

/** Every property name across every tool schema — these are fields, not tool names. */
const FIELD_NAMES = new Set(
  TOOLS.flatMap((tool) => Object.keys((tool.inputSchema as { properties?: object }).properties ?? {})),
)

test('deploy-stack exists and names its arguments', () => {
  assert.ok(deployStack !== undefined)
  assert.deepEqual(
    deployStack.arguments.map((argument) => argument.name),
    ['project', 'name', 'image', 'location', 'domain', 'repo'],
  )
  // Every argument is optional: the prompt has to be usable bare, as a slash command with
  // no arguments typed.
  assert.equal(deployStack.arguments.some((argument) => argument.required === true), false)
})

test('supplied arguments appear in the rendered text', () => {
  const text = deployStack!.render({ project: 'acme', name: 'api', image: '' })
  assert.match(text, /- project: acme/)
  assert.match(text, /- name: api/)
  // Blank values are dropped rather than rendered as an empty line the model must parse.
  assert.equal(text.includes('- image:'), false)
})

test('with no arguments it sends the model to the interview', () => {
  assert.match(deployStack!.render({}), /nothing up front/)
})

test('readiness is described differently for deployments and for databases/disks', () => {
  // The single most dangerous thing to get wrong here: api/deployment.ActionStatus
  // marshals as a name and has "failed", while pkg/api.ActionStatus (databases, disks)
  // ships as a bare integer 1/2 with no failure value. Treating them alike either moves
  // on before a database exists or waits forever for a "failed" that cannot arrive.
  const text = deployStack!.render({})
  assert.match(text, /\*\*string\*\* `"success"`/)
  assert.match(text, /\*\*number `2`\*\*/)
  assert.match(text, /no failure value at all/)
})

test('the first deploy is expected to fail, and that is stated as expected', () => {
  // The deployment is created pointing at <registry>/<path>:latest before CI has pushed
  // anything, so the pull fails. A model that reads "failed" as a problem will retry it,
  // dig through logUrl, or swap in nginx to get a green status — each of which breaks the
  // flow at the point where it is working correctly.
  const text = deployStack!.render({})
  const flat = text.replace(/\s+/g, ' ')
  assert.match(text, /<registry>\/<path>:latest/)
  assert.match(flat, /Say it will fail before it does/)
  assert.match(flat, /do not swap in `nginx` for a green status/)
  assert.match(flat, /A failed deployment here is the flow working/)
  assert.match(text, /deploymentCreate/)
  assert.match(text, /deploymentDeploy/)
})

test('the deployment flow is drawn, not only described', () => {
  // Three actors and an expected failure in the middle. Prose makes the reader hold the
  // handoffs in their head; the diagram shows which of them is acting at each step.
  const text = deployStack!.render({})
  assert.match(text, /you {24}user {18}github actions/)
  assert.match(text, /actionStatus "failed" {3}⚠️ EXPECTED — nothing to pull/)
  assert.match(text, /push <registry>\/<path>:<sha>/)
  assert.match(text, /deployment\.create-revision/)
  assert.match(text, /poll deploymentGet until actionStatus "success"/)
})

test('the pull secret must exist before CI pushes, not before the first deploy', () => {
  // Both deploys fail without it, but only the second one is supposed to. A missing pull
  // secret hides inside the expected failure and then surfaces as an infinite wait.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /The pull secret must exist before CI pushes, not before this create/)
  assert.match(flat, /hides inside the expected failure/)
})

test('it tells the model to ask with options rather than assume', () => {
  // The text wraps, so collapse whitespace before matching the phrase.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /Never pick a project, location, engine, size, port or domain on their behalf/)
})

test('the placeholder is always substituted', () => {
  for (const prompt of PROMPTS) {
    for (const rendered of [prompt.render({}), prompt.render({ project: 'x' })]) {
      assert.equal(/\{\{[A-Z_]+\}\}/.test(rendered), false, `${prompt.name} left a placeholder`)
    }
  }
})

/**
 * Tool ids the prompts name deliberately to say they are NOT available.
 *
 * Withholding a tool only works if the prompt explains why, otherwise the next reader adds
 * it back. So "pullsecretCreate is deliberately not one of your tools" has to be sayable
 * without the existence check below treating it as an instruction to call it.
 */
const WITHHELD_TOOLS = new Set(['pullsecretCreate'])

test('every tool the prompt instructs the model to call actually exists', () => {
  // The prompt names tools in prose, so a rename or an allowlist change could leave it
  // telling the model to call something that is not there.
  const names = new Set(TOOLS.map((tool) => tool.name))
  const text = PROMPTS.map((prompt) => prompt.render({})).join('\n')

  const referenced = [...text.matchAll(/`([a-z][A-Za-z]+)`/g)]
    .map((match) => match[1] as string)
    .filter((candidate) => !WITHHELD_TOOLS.has(candidate))
    // Only check things that look like our tool ids and are plausibly meant as calls.
    .filter((candidate) => /^(project|deployment|disk|db|envgroup|route|domain|pullsecret|cluster|auth)[A-Z]/.test(candidate))
    // Field names share the prefix-plus-capital shape (projectSlug, deploymentId). Only
    // flag identifiers that are not a parameter of any tool.
    .filter((candidate) => !FIELD_NAMES.has(candidate))

  assert.ok(referenced.length > 10, 'expected the prompt to name tools')
  for (const name of referenced) {
    assert.ok(names.has(name), `prompt references ${name}, which is not an exposed tool`)
  }
})

test('the embedded workflow YAML is emitted verbatim, not escaped', () => {
  // This broke once. The YAML lives inside a TypeScript template literal, so `${{ }}` has
  // to be escaped in the source — and one backslash too many ships `\${{ secrets.X }}`,
  // which GitHub Actions treats as a literal string rather than a secret, and `\\` where
  // the shell needs a single line continuation. Both produce a workflow that looks right
  // in review and fails at run time.
  const text = deployStack!.render({})

  assert.match(text, /\$\{\{ secrets\.NORTEZH_SA_EMAIL \}\}/)
  assert.match(text, /\$\{\{ secrets\.GOOGLE_CREDENTIALS \}\}/)
  assert.match(text, /\$\{\{ steps\.auth\.outputs\.access_token \}\}/)
  assert.equal(/\\\$\{\{/.test(text), false, 'a backslash leaked in front of ${{')
  // The tag comes from the shell env, not an expression, so it must survive unescaped too.
  assert.match(text, /image_name=<registry-host>\/<image-path>:\$GITHUB_SHA/)
  assert.equal(/\\\$GITHUB_SHA/.test(text), false, 'a backslash leaked in front of $GITHUB_SHA')

  const yaml = text.slice(text.indexOf('```yaml') + 8)
  const body = yaml.slice(0, yaml.indexOf('```'))
  assert.equal(/\\\\\s*$/m.test(body), false, 'double backslash where one continuation was meant')
})

test('the workflow deploys with the official action, not a hand-rolled call', () => {
  const text = deployStack!.render({})
  assert.match(text, /Nortezh\/nortezh-action@v[\d.]+/)
  assert.match(text, /SA_AUTH_EMAIL: \$\{\{ secrets\.NORTEZH_SA_EMAIL \}\}/)
  assert.match(text, /SA_AUTH_KEY: \$\{\{ secrets\.NORTEZH_SA_KEY \}\}/)
  // The action owns the API call, so nothing should be curling the endpoint by hand.
  assert.equal(/curl .*deployment\./.test(text), false)
})

test('the image tag is computed once and passed between jobs', () => {
  // Writing the registry path in both the build tag and the deploy input is how the two
  // silently drift and a deploy points at an image that was never pushed.
  const text = deployStack!.render({})
  assert.match(text, /image_name: \$\{\{ steps\.image\.outputs\.image_name \}\}/)
  assert.match(text, /image: \$\{\{ needs\.build\.outputs\.image_name \}\}/)
})

test('the service account setup comes before the GitHub secrets', () => {
  // Ordering matters: the secrets cannot be set until the key exists, and the workflow
  // must not be written until both are done.
  const text = deployStack!.render({})
  const account = text.indexOf('A Nortezh service account')
  const secrets = text.indexOf('Three GitHub secrets')
  const workflow = text.indexOf('### Then write')
  assert.ok(account > 0 && secrets > account && workflow > secrets)
})

test('the prompt does not promise tools that are deliberately excluded', () => {
  const text = deployStack!.render({})
  // serviceaccount* and cicd* are not exposed; the prompt must hand those steps to the
  // user rather than instruct the model to call them.
  assert.equal(/`serviceaccount[A-Z]/.test(text), false)
  assert.equal(/`cicd[A-Z]/.test(text), false)
})

test('it routes on intent instead of assuming a build-from-scratch', () => {
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /Patch an existing deployment/)
  assert.match(flat, /Creating a resource that already exists is a failure, not a step/)
  assert.match(flat, /Take inventory before proposing anything/)
})

test('the destructive env-replacement footgun is called out', () => {
  // deployment.go:1076 — `if p.Env != nil { env = p.Env }` replaces the whole inline map.
  // Recommending `env` for a one-key patch would silently delete every other variable.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /replaces the entire inline env map/)
  assert.match(flat, /use `addEnv` \(upsert\) and `removeEnv` \(delete\)/)
})

test('it says an env group edit needs a redeploy to take effect', () => {
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /baked into the revision at deploy time/)
})

test('it reads the codebase before interrogating the user', () => {
  // The repo already states the topology, ports, dependencies and env vars. Asking a user
  // to recite their own architecture is both slower and less accurate than deriving it.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /Understand the project, its services, and their configuration/)
  assert.match(flat, /This is the step that matters/)
  assert.match(flat, /docker-compose\.yml/)
  assert.match(flat, /\.env\.example/)
  assert.match(flat, /Build a service inventory/)
  // And it must not treat its own reading as authoritative.
  assert.match(flat, /Do not proceed on your reading alone/)
})

test('every question must carry choices and a free-text escape', () => {
  // Options without an escape force the user to accept an answer that is merely close.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /always ask with choices/)
  assert.match(flat, /2–4 concrete options/)
  assert.match(flat, /A final option that is free text\*\*, always/)
  assert.match(flat, /never optional and never omitted/)
  assert.match(flat, /Something else — tell me/)
  // And it must not double up when the client already provides the escape.
  assert.match(flat, /do not also write your own "Other" option/)
})

test('existing resources are offered ahead of creating new ones', () => {
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /existing resources come first, before any "create a new one" option/)
})

test('a project is described as holding many deployments and databases', () => {
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /A Nortezh \*\*project\*\* is not one application/)
  assert.match(flat, /one project with three deployments/)
  assert.match(flat, /Most names are unique \*\*within\*\* the project/)
  // Domains and (domain, path) are the platform-wide exception.
  assert.match(flat, /unique across the \*\*whole platform\*\*/)
})

test('per-service configuration is treated as its own step', () => {
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /Every environment variable it reads/)
  assert.match(flat, /Which of those are secrets/)
  assert.match(flat, /Which are shared and which are per-service/)
  // The compose-name translation is the classic cause of a stack that deploys but cannot
  // talk to itself.
  assert.match(flat, /Addresses change when they leave compose/)
  assert.match(flat, /internalUrl/)
})

test('the domain cdn flag is asked about, with its real gating', () => {
  // domain.go:116 — cdn defaults to false; cdn=true is billing-feature-gated and rejected
  // outright for a trial account. Silently sending true fails for reasons that read like
  // a permissions bug.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /`cdn: false` \(\*\*the default\*\*, recommend it\)/)
  assert.match(flat, /DOMAIN_TRIAL_BILLING_CANNOT_CREATE_CDN_DOMAIN/)
})

test('the cname is read from domainGet, not written from memory', () => {
  // domain.go:433 — Get branches on x.CDN: a CDN domain gets cname.nortezh.com, a non-CDN
  // domain gets its own cluster's cname. One hardcoded hostname breaks half the cases.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /cname value differs by the `cdn` flag/)
  assert.match(flat, /always read it, never write one from memory/)
})

test('who terminates TLS follows the cdn flag, not a fixed answer', () => {
  // From a real run (session b8fc25a2, carmateauto.vip): the Nortezh ingress serves a
  // self-signed cert (CN=parapet-ingress-controller) and 301s HTTP to HTTPS. So on a
  // cdn=false domain the customer's Cloudflare proxy IS what terminates TLS publicly —
  // grey cloud leaves the site unreachable, and Full (strict) rejects the origin with 526.
  // The prompt previously said grey cloud always, and named Full (strict) as the fix.
  const text = deployStack!.render({})
  const flat = text.replace(/\s+/g, ' ')
  assert.match(flat, /Who terminates TLS depends on `cdn`/)
  assert.match(text, /cdn=false {3}customer's Cloudflare must PROXY \(orange cloud\)/)
  assert.match(text, /SSL\/TLS mode = Full {10}← not Full \(strict\), not Flexible/)
  assert.match(text, /cdn=true {4}DNS only \(grey cloud\)/)
  assert.match(flat, /strict rejects it with \*\*526\*\*/)
  assert.match(flat, /Grey cloud on a `cdn=false` domain leaves the site down/)
  // The old wrong advice must not come back.
  assert.equal(/set it to \*\*DNS only\*\* \(grey cloud\), not Proxied/.test(flat), false)
})

test('the workflow does not pass pull_secret to nortezh-action', () => {
  // Observed in CI: nortezh-action@v1.2.0 logs "Unexpected input(s) 'pull_secret'" and
  // ignores it. The deployment already stores pullSecret from its create, and an omitted
  // field is preserved on a revision.
  const text = deployStack!.render({})
  assert.equal(/^\s+pull_secret:/m.test(text), false, 'pull_secret is still in the template')
  const flat = text.replace(/\s+/g, ' ')
  assert.match(flat, /Do not add a `pull_secret` input/)
  assert.match(flat, /Unexpected input\(s\) 'pull_secret'/)
})

// A test asserting "DNS only (grey cloud), not Proxied" and "Full (strict)" used to live
// here. Both were wrong, and the test held them in place through several reviews — it
// checked that the prompt said a thing, never that the thing was true. Superseded by
// "who terminates TLS follows the cdn flag", which encodes what the origin actually serves.

test('manual steps are handed over short, then waited on', () => {
  // Front-loading the explanation buries the instruction. The rule is: say what to do,
  // give the exact values, stop, and keep the reasoning for when it is actually needed.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /Some steps are theirs, not yours/)
  assert.match(flat, /as a short numbered list\. Three or four steps, not a page/)
  assert.match(flat, /Leave the explanation out/)
  assert.match(flat, /Then stop and wait/)
  assert.match(flat, /could they act on your message without reading anything else/)
})

test('the long-form detail is parked behind "keep in reserve"', () => {
  const text = deployStack!.render({})
  const reserves = [...text.matchAll(/Keep in reserve/g)]
  assert.ok(reserves.length >= 2, 'expected the DNS and credential handoffs to both defer detail')
})

test('route target is documented as a deployment:// URI, not a bare name', () => {
  // route.go:42-44 allows exactly one prefix and route.go:621 rejects anything else, so
  // `target: "api"` fails with "target is invalid". Easy to get wrong from the field name.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /`target` is a URI, not a name/)
  assert.match(flat, /deployment:\/\/<name>/)
  assert.match(flat, /`path` must start with `\/`/)
})

test('projectCreate is described as possible, with where billingId comes from', () => {
  // An earlier version claimed no exposed tool returns a billingId, so project creation was
  // impossible. False: project.go:302 puts billingId on GetResult, and both projectGet and
  // projectOverview are exposed. The real constraint is only the very first project.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /`projectGet` or `projectOverview` returns/)
  assert.match(flat, /never invent the UUID/)
  assert.equal(/You cannot create a project/.test(flat), false)
})

test('metric ranges are enumerated, since the schema does not', () => {
  // deployment.go:2055 — a closed set. "1d"/"7d"/"30d" look right and all fail.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /`1hagg`/)
  assert.match(flat, /`30dagg`/)
})

test('secrets are kept out of env groups', () => {
  // envgroup.go:151-155 — "stored and returned as PLAIN TEXT (never masked) — do not put
  // real secrets in an env group". Only mountDataSecretPaths censors (deployment.go:911).
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /Only `mountDataSecretPaths` masks anything/)
  assert.match(flat, /do not put real secrets in an env group/)
  assert.match(flat, /mountData` \+ `mountDataSecretPaths`/)
  // And nothing may still be routing a password into an env group.
  assert.equal(/put it straight into the env group/.test(flat), false)
})

test('envgroupUpdate is described as a wholesale replace', () => {
  // envgroup.go:141-143 — Data replaces the whole map; any key left out is removed, and a
  // nil data empties the group outright (Valid() substitutes an empty map).
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /`envgroupUpdate` REPLACES the whole map/)
  assert.match(flat, /omitting `data` entirely empties the group/)
  assert.match(flat, /Read with `envgroupGet`, change, send it all back/)
})

test('absent envGroups and empty envGroups are distinguished', () => {
  // deployment.go:370-372 — nil leaves the links unchanged, [] clears them. Sending [] to
  // mean "unchanged" strips the deployment's entire shared configuration.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /`envGroups` absent means \*\*leave links alone\*\*/)
  assert.match(flat, /`\[\]` means \*\*unlink every group\*\*/)
})

test('$-sequences in argument values cannot splice the template', () => {
  // String.replace interprets $&, $`, $' and $n in a replacement STRING. A project name
  // containing one re-injected the {{GIVEN}} token, or spliced 83 characters of the
  // template's own prefix into the rendered prompt.
  const amp = deployStack!.render({ project: 'acme$&x' })
  assert.equal(amp.includes('{{GIVEN}}'), false)
  assert.match(amp, /- project: acme\$&x/)

  const tick = deployStack!.render({ project: "acme$`END" })
  assert.match(tick, /- project: acme\$`END/)
  assert.equal(tick.length, deployStack!.render({ project: 'acme$`END' }).length)
})

test('deploymentDeploy is not described as send-only-what-changes', () => {
  // deployment.go:399 — image is required on every call, alongside project/location/name.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /Always required, even on a one-field change/)
  assert.match(flat, /read the current image with `deploymentGet` and send it back/)
  assert.equal(/send \*\*only what changes\*\*/.test(flat), false)
})

test('type is documented as immutable after creation', () => {
  // updateDeployment has no b.Set("type"), so the placeholder recipe must set the real
  // type at create time or a Worker can never stop being a WebService.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /cannot be changed at all:\*\* `type`/)
  // It is the one field a later CI deploy cannot correct, so it has to be right at create
  // even though the image it points at does not exist yet.
  assert.match(flat, /\*\*`type` is immutable\*\* — the one field a later CI deploy cannot fix/)
  })

test('omitting mountDataSecretPaths is flagged as destructive', () => {
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /deletes the stored value of every secret-marked mounted file/)
})

test('a non-CDN domain is not described as needing verification', () => {
  // domain.go:116-126 — inserted StatusSuccess with verification '{}'.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /written `success` at create/)
  assert.match(flat, /no verification at all/)
  assert.match(flat, /`ipv4` and `ipv6` are always empty/)
})

test('protocol is limited to http and https for a WebService', () => {
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /a `WebService` accepts only \*\*`http` or `https`\*\*/)
})

test('the database engines are not treated as returning the same fields', () => {
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /\*\*no `user`, no `database`\*\*/)
  assert.match(flat, /cpu \*\*0\.5–4\*\* cores/)
})

test('rollback is not promised as a clean undo', () => {
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /does \*\*not\*\* create a new revision/)
  assert.match(flat, /partial undo, not a time machine/)
})

test('route readiness appears in the convergence table', () => {
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /\| route \| `routeGet` \|/)
})

const resources = PROMPTS.find((prompt) => prompt.name === 'resources')

test('the resource model prompt exists and takes no arguments', () => {
  assert.ok(resources !== undefined)
  assert.deepEqual(resources.arguments, [])
  assert.ok(resources.render({}).length > 5000)
})

test('the resource model covers every exposed resource', () => {
  const text = resources!.render({})
  for (const heading of [
    '## Project', '## Cluster', '## Deployment', '## Revision', '## Env group',
    '## Disk', '## Managed database', '## Pull secret', '## Domain', '## Route',
  ]) {
    assert.ok(text.includes(heading), `missing ${heading}`)
  }
})

test('each resource states dependencies, readiness and mutability', () => {
  const text = resources!.render({})
  assert.ok(text.split('**Depends on:**').length - 1 >= 7, 'dependencies')
  assert.ok(text.split('**Ready:**').length - 1 >= 8, 'readiness')
  assert.ok(text.split('**Mutable:**').length - 1 >= 6, 'mutability')
})

test('the resource model does not contradict deploy-stack on the sharp facts', () => {
  const model = resources!.render({}).replace(/\s+/g, ' ')
  // Each of these was a confirmed error in deploy-stack at some point; the model must
  // state the corrected version, or the two prompts will disagree in the same session.
  assert.match(model, /Immutable: `type`/)
  assert.match(model, /non-CDN\*\* domain is written `success` at create/)
  assert.match(model, /`target` is a \*\*URI\*\*: `deployment:\/\/<name>`/)
  assert.match(model, /replaces the whole map/)
  assert.match(model, /do not put real secrets in one/)
  assert.match(model, /any number of deployments — a disk is \*\*not exclusive\*\*/)
  assert.match(model, /`projectGet` or `projectOverview`/)
})

test('deploy-stack INLINES the resource model rather than pointing at it', () => {
  // An MCP prompt cannot fetch another prompt: prompts are user-invoked slash commands and
  // the model has no prompts/get. A pointer would be advice it could never act on.
  const text = deployStack!.render({})
  assert.ok(text.includes(resources!.render({})), 'the model is not embedded verbatim')
  assert.equal(text.includes('{{RESOURCE_MODEL}}'), false)
})

// Facts that were wrong in deploy-stack at some point and are now stated in the resource
// model. The model is canonical: if a fact leaves it, the procedure is the only place it
// lives and the next edit can contradict it silently — which is exactly how the original
// twelve errors survived review.
const CANONICAL_FACTS: Array<[string, RegExp]> = [
  ['deployment type is immutable', /Immutable: `type`/],
  ['env group update replaces', /replaces the whole map/],
  ['env groups are not for secrets', /do not put real secrets in one/],
  ['non-CDN domain needs no verification', /written `success` at create/],
  ['dnsConfig is one CNAME', /`ipv4` and `ipv6` are always empty/],
  ['route target is a URI', /`target` is a \*\*URI\*\*: `deployment:\/\/<name>`/],
  ['route targets WebService only', /CAN_MAP_ONLY_WEB_SERVICE/],
  ['disks are shared', /any number of deployments — a disk is \*\*not exclusive\*\*/],
  ['db engines differ', /Postgres adds `user` and `database`; Mongo adds `user` only/],
  ['billingId is readable', /`projectGet` or `projectOverview`/],
  ['DISK_IN_USE is unreliable', /`DISK_IN_USE` does not protect you/],
  ['domains can fail', /`error` is a real outcome/],
  ['rollback is partial', /does \*\*not\*\* create a new revision/],
  ['deploy always needs image', /even for a one-field change/],
]

test('every sharp fact is stated in the resource model, not only in the procedure', () => {
  // Flattened: the source wraps at 90 columns, so a fact can straddle a line break.
  const model = resources!.render({}).replace(/\s+/g, ' ')
  for (const [name, pattern] of CANONICAL_FACTS) {
    assert.match(model, pattern, `the model no longer states: ${name}`)
  }
})

test('every resource in the model answers the same questions', () => {
  const model = resources!.render({})
  const sections = model.split(/\n## /).slice(1)
  const resourceSections = sections.filter(
    (s) => !/^(The dependency graph|Things that are true)/.test(s),
  )
  assert.ok(resourceSections.length >= 11, 'expected at least 11 resource sections')

  for (const section of resourceSections) {
    const name = section.split('\n')[0]!.trim()
    // Cluster is the one root with nothing above it, so it has no dependencies to state.
    if (!name.startsWith('Cluster')) {
      assert.match(section, /\*\*Depends on:\*\*/, `${name} does not state its dependencies`)
    }
    assert.match(section, /\*\*Ready:\*\*/, `${name} does not state readiness`)
    assert.match(section, /\*\*Mutable:\*\*/, `${name} does not state mutability`)
  }
})

// ---------------------------------------------------------------------------------------
// The seven-step flow.
//
// The spine of the prompt: nothing mutating may happen before the user approves a written
// plan, and the report must describe what ran rather than what was planned.
// ---------------------------------------------------------------------------------------

const STEPS = [
  '## Step 1 — Take the request',
  '## Step 2 — Ask which project',
  '## Step 3 — The loop',
  '## Step 4 — Write the plan',
  '## Step 5 — Get explicit approval',
  '## Step 6 — Execute the plan',
  '## Step 7 — Report what actually happened',
]

test('the seven steps appear once each, in order', () => {
  const text = deployStack!.render({})
  let previous = -1
  for (const step of STEPS) {
    const at = text.indexOf(step)
    assert.ok(at > previous, `${step} is missing or out of order`)
    assert.equal(text.indexOf(step, at + 1), -1, `${step} appears more than once`)
    previous = at
  }
})

test('the project question is unconditional and comes before the work', () => {
  // The slug rides on every later call. Guessing it builds a correct stack in the wrong
  // tenancy — and the request naming a project is not the same as the user confirming it.
  const text = deployStack!.render({})
  const flat = text.replace(/\s+/g, ' ')
  assert.match(flat, /\*\*Always ask, every run, before anything else\.\*\*/)
  assert.match(flat, /Nothing else happens until this is answered/)
  assert.ok(text.indexOf(STEPS[1]!) < text.indexOf(STEPS[2]!))
})

test('the loop will not exit while anything is unresolved', () => {
  // "probably 8080" is how a plan acquires a value nobody chose. The exit condition has to
  // be stated as absolute, or the model satisfies it by lowering its own bar.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /no unknowns, no assumptions, no guesses/)
  assert.match(flat, /If you cannot cite where a value came from/)
  assert.match(flat, /It is a loop, not a sequence/)
})

test('step 5 is a hard gate that read-only tools alone may precede', () => {
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /\*\*Steps 1 to 5 change nothing\*\* — read-only tools only/)
  assert.match(flat, /you may call read-only tools and nothing else/)
  assert.match(flat, /Silence is not approval/)
  // An amendment agreed in chat must go back into the document, or the approved artifact
  // and the executed one are different things.
  assert.match(flat, /the approved artifact and the thing you execute must be the same/)
})

test('the plan template carries a section per resource kind', () => {
  const text = deployStack!.render({})
  const start = text.indexOf('### The plan template')
  const end = text.indexOf('### End of the plan template')
  assert.ok(start > 0 && end > start, 'the plan template is not delimited')
  const template = text.slice(start, end)

  for (const section of [
    '## Your project, as I understand it',
    '## Overview',
    '## Databases',
    '## Config',
    '## Deployments',
    '## Domains',
    '## Routes',
    '## Order and waiting',
    '## Steps only you can do',
    '## Risks',
    '## Explicitly not doing',
  ]) {
    assert.ok(template.includes(section), `the plan template is missing ${section}`)
  }
  assert.match(template, /Unresolved: none\./)
  assert.match(template, /\*\*Approve to run exactly this\*\*/)
})

test('the report template is built from what ran, not from the plan', () => {
  const text = deployStack!.render({})
  const start = text.indexOf('### The report template')
  const end = text.indexOf('### End of the report template')
  assert.ok(start > 0 && end > start, 'the report template is not delimited')
  const template = text.slice(start, end)

  for (const section of ['## Still yours', '## Not done', '## To undo']) {
    assert.ok(template.includes(section), `the report template is missing ${section}`)
  }
  const flat = text.replace(/\s+/g, ' ')
  assert.match(flat, /built from \*\*what actually ran\*\*, never from the plan/)
  assert.match(flat, /A silent omission reads as success/)
  // Citing the check is what separates a claim from an audit trail, and the checks differ
  // per resource — a deployment reports a string, a disk reports 2.
  assert.match(flat, /\*\*State how you know\*\*/)
})

test('red is not overloaded between deletion and failure', () => {
  // 🔴 already means delete. Reusing it for a failed step would make "deleted" and "broke"
  // the same colour in a report whose whole job is telling them apart.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /Red already means \*delete\*/)
  assert.match(flat, /❌ failed/)
  assert.match(flat, /⏸ not run/)
})

test('output formatting forbids pipe tables without forbidding its own', () => {
  // The prompt itself uses pipe tables as reference material for the model. The rule is
  // about what reaches the user's terminal, where a pipe table has no renderer — so the
  // rule has to scope itself or it reads as self-contradictory.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /Never use a markdown pipe table in output/)
  assert.match(flat, /The tables in this prompt are reference material for you/)
  assert.match(flat, /Every listing is its own fenced block/)
})

test('chips are kept out of the diagram, which uses the sign markers', () => {
  // Emoji are double-width in most terminals and single-width in some, so one inside a box
  // breaks the box. The two notations have to mean the same four things.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /🟢 add · 🟡 edit · 🔴 delete · ⚪ untouched/)
  assert.match(flat, /\*\*No chips inside the diagram\*\*/)
  assert.match(flat, /The chip is the first character of the line/)
})

// ---------------------------------------------------------------------------------------
// Contradiction tests.
//
// Every test above checks that a fact is STATED somewhere. That is what let four errors
// survive the last review: the model was corrected and the procedure kept the old claim, so
// the same prompt asserted both. These check the procedure does not contradict the model.
// ---------------------------------------------------------------------------------------

test('the rules do not deny the flow they sit above', () => {
  // Rule 3 used to open "There is no fixed sequence", written when the prompt was a menu.
  // With Steps 1-7 in place that reads as permission to skip the approval gate — the two
  // strongest instructions in the prompt, contradicting each other on page one.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.equal(/There is no fixed sequence/.test(flat), false)
  assert.match(flat, /The seven steps are fixed; the operations inside them are not/)
  assert.match(flat, /Never work through 6\.1–6\.5 because they are numbered/)
})

test('the procedure agrees with the model on which resources can fail', () => {
  // domain/status.go declares StatusError and domain.go:209 enums it as a string. Saying
  // "only the deployment can fail" made the model treat a domain stuck in `error` as a
  // domain still converging, and wait on something that will never change.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.equal(/only the deployment can fail/i.test(flat), false)
  assert.equal(/Only the deployment reports a string/i.test(flat), false)
  assert.match(flat, /the same two can fail: deployment and domain/)
  assert.match(flat, /\| domain, CDN \| `domainGet` \| `status` is the \*\*string\*\* `"success"` \| yes/)
})

test('the procedure does not present DISK_IN_USE as protection', () => {
  // GetBindingDeployments (disk.go:700) queries jsonb_each(extra_disk_mount_data) and never
  // reads the `disk` column, and disk.delete refuses only when that list is non-empty. B1
  // used to say "diskDelete fails with DISK_IN_USE while any still does" — which reads as a
  // guarantee and licenses deleting a mounted volume.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.equal(/`diskDelete` fails with `DISK_IN_USE` while any still does/.test(flat), false)
  assert.match(flat, /neither `diskGet` nor `DISK_IN_USE` will tell you about most of them/)
  assert.match(flat, /check its `disk` field yourself/)
})

test('the ground rules do not license sending only the changed fields', () => {
  // deployment.go:399 requires image on every call, and an omitted mountDataSecretPaths
  // wipes secret file values — so "send the fields that differ and nothing else" is the
  // data-loss path, stated as a rule.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.equal(/send the fields that differ and nothing else/.test(flat), false)
  assert.match(flat, /is \*\*not\*\* safe here/)
})

test('every destructive tool is named in the confirm-first rule', () => {
  // Derived from the generated annotations rather than a hand-written list, so adding a
  // destructive route to the allowlist fails here until the prompt mentions it.
  const text = deployStack!.render({})
  for (const tool of TOOLS.filter((candidate) => candidate.destructive)) {
    // The three engine deletes are covered by one `db*Delete` wildcard.
    const needle = /^db[A-Z]/.test(tool.name) ? 'db*Delete' : tool.name
    assert.ok(text.includes(needle), `${tool.name} is destructive but the prompt never names it`)
  }
})

// SCREAMING_SNAKE tokens in the prompt that are environment variables or secret names, not
// API error codes. Everything else in that shape is checked against what the tools can
// actually return — a code the model is told to react to but no route emits is advice it
// can never use, and it reads exactly like a real one.
const NOT_ERROR_CODES = new Set([
  'EXPOSE',
  'README',
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'STRIPE_KEY',
  'NORTEZH_SA_EMAIL',
  'NORTEZH_SA_KEY',
  'GOOGLE_CREDENTIALS',
  'SA_AUTH_EMAIL',
  'SA_AUTH_KEY',
  // GitHub Actions secrets used by the registry login variants.
  'GITHUB_TOKEN',
  'DOCKERHUB_USERNAME',
  'DOCKERHUB_TOKEN',
])

test('every error code the prompts cite is one an exposed tool can return', () => {
  const returnable = new Set(TOOLS.flatMap((tool) => tool.errorCodes))
  const text = PROMPTS.map((prompt) => prompt.render({})).join('\n')

  const cited = new Set(
    [...text.matchAll(/`([A-Z][A-Z0-9_]{4,})`/g)]
      .map((match) => match[1] as string)
      .filter((candidate) => !NOT_ERROR_CODES.has(candidate)),
  )

  assert.ok(cited.size > 20, 'expected the prompts to name error codes')
  for (const code of cited) {
    assert.ok(
      returnable.has(code),
      `the prompts tell the model to expect ${code}, which no exposed tool declares in ` +
        'x-error-codes. Either it is not a real code, or it belongs to a route that is not ' +
        'in the allowlist. (If it is an env var, add it to NOT_ERROR_CODES.)',
    )
  }
})

test('deploymentGet.url is not described as always working', () => {
  // An external ingress exists only for a non-internal WebService, but `url` is populated
  // for every type — so "every deployment already has a working URL" sent the model off to
  // verify a Worker over HTTP.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.equal(/Every deployment already has a working URL/.test(flat), false)
  assert.match(flat, /it only \*resolves\* for a \*\*non-internal WebService\*\*/)
})

test('the rules heading counts the rules that are actually there', () => {
  const text = deployStack!.render({})
  assert.match(text, /## The six rules that matter most/)
  assert.match(text, /\*\*6\. /)
  assert.equal(/\n\*\*7\. /.test(text), false)
  assert.match(text, /And underneath all six:/)
})

test('the image route is stated as a procedure, not as a prohibition', () => {
  // Stated as "do not run docker build", the rule is a blocklist: it cannot enumerate
  // podman, nerdctl, a Makefile target, or whatever comes next, and it leaves the model
  // without an alternative so it improvises. Stating the one route that works covers every
  // tool including the ones nobody has written yet.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /Images reach Nortezh one way: CI builds and pushes, then updates the deployment/)
  assert.match(flat, /the \*\*full real config\*\*/)
  assert.match(flat, /That workflow builds the image, pushes it, and sets the real tag on the deployment/)
  assert.match(flat, /"Already exists" means already pushed/)
  // Observed for real on build 13: the model built linux/amd64 locally and pushed to GHCR
  // with the laptop's docker credential. The rule's justification had been "an image on
  // your machine cannot be deployed", which is simply false — push it and the cluster pulls
  // it. A reason the model can disprove invites the workaround it is meant to stop.
  assert.match(flat, /Not \*"it would not work"\* — it would/)
  assert.match(flat, /unreviewed and unreproducible/)
  assert.match(flat, /needs a \*\*write\*\* credential that rule 6 keeps out of this session/)
  // And the pressure that produced it: no workflow yet, user wants it deployed now.
  assert.match(flat, /"There is no CI yet" is not an exception — it is the normal starting state/)
  assert.match(flat, /the lever is getting the workflow pushed, not bypassing it/)
  // This path has to read as the default, not as a workaround.
  assert.match(flat, /\*\*This is the normal path, not a fallback\.\*\*/)
})

test('credentials are governed by one positive invariant, not a blocklist', () => {
  // "Never create a pull secret" plus "never ask for one" plus "never run gh auth token"
  // plus "never read ~/.docker/config.json" is a list that can never be finished. "You work
  // in names, never values" covers all of them, and the credentials nobody has invented yet.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /Every credential travels one path: the user creates it, and tells you only its name/)
  assert.match(flat, /You work in \*\*names\*\*, never values/)
  // Each credential says where the user makes it and what comes back.
  assert.match(flat, /Nortezh console → Pull Secrets/)
  assert.match(flat, /the registry, then GitHub Secrets/)
  // The old prohibitions are kept, but derived — including the local-credential probing
  // (gh auth token, ~/.docker/config.json) that prompted this rewrite.
  assert.match(flat, /consequences rather than extra rules/)
  assert.match(flat, /You never need a credential's value\*\*, so never ask for one/)
  assert.match(flat, /A credential on this machine is the wrong one\*\*, so there is nothing to look for/)
  assert.match(flat, /The line is whether the file is checked in/)
  assert.match(flat, /should be rotated/)
  // And the handoff has to be actionable, not just a refusal. The credential does not
  // exist yet when the console form asks for it, so "make the token" has to be its own
  // step — otherwise the instruction dead-ends at a field the user cannot fill.
  assert.match(flat, /\*\*1\. Make a token\.\*\*/)
  assert.match(flat, /Tokens \(classic\)\*\* → Generate new token/)
  assert.match(flat, /\*\*2\. Create the pull secret\.\*\* Nortezh console/)
  assert.match(flat, /Tell me the name you used\*\* — the name only, never the token/)
  // Ask which registry before handing over, or the user does the choosing.
  assert.match(flat, /Ask which registry before handing over/)
  // Public images need none; offering the step anyway makes the real ones look optional.
  assert.match(flat, /deployment pulling only public images never needs one/)
})

test('a withheld tool is never resolved by making something public', () => {
  // Observed for real: with pullsecretCreate gone, a model concluded "make the GHCR package
  // public after first push, so no pull secret is needed". Removing a capability creates
  // pressure to route around it, and publishing is the cheapest route — it trades a console
  // step for permanently exposing every layer, build arg and baked-in file of the image.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /Blocked is not a reason to weaken something else/)
  assert.match(flat, /Registries are private by default and stay that way/)
  assert.match(flat, /Never remove the thing that made it require permission/)
  // The user's own image is private by default; "public needs no pull secret" is a fact
  // about third-party images and must not read as a suggestion.
  assert.match(flat, /\*\*The user's own application image is private by default\.\*\*/)
  assert.match(flat, /not\*\* a suggestion to publish the user's own/)
})

test('the CI push credential is created by the user, in GitHub Secrets', () => {
  // Push (Actions, write) and pull (cluster, read) are different credentials with different
  // scopes, and conflating them is the common mistake. Neither passes through the chat: the
  // user pastes the value into GitHub Secrets and tells the model only the name.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /\*\*2\. A push credential for the registry\.\*\*/)
  assert.match(flat, /straight into GitHub Secrets, never through you/)
  assert.match(flat, /Paste each value straight in — do not send them to me/)
  assert.match(flat, /Push is Actions' and needs \*\*write\*\*; pull is the cluster's and needs only \*\*read\*\*/)
  assert.match(flat, /Never reuse one for both/)
})

test('the registry login style is asked, not inferred from the registry', () => {
  // Artifact Registry does both: oauth2accesstoken via google-github-actions/auth, or
  // _json_key as an ordinary username/password. GHCR does both too. Picking from the
  // registry name alone silently makes a security decision the user never saw.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /How the build job logs in is a choice, not a property of the registry/)
  assert.match(flat, /\*\*OAuth2 — a short-lived token minted during the run\.\*\*/)
  assert.match(flat, /\*\*Username and password \(or token\)\.\*\*/)
  assert.match(flat, /so do not decide from the registry name/)
  // The reason OAuth2 is the recommendation, not just that it is.
  assert.match(flat, /expires in an hour, so a leaked build log ages out/)
})

test('the workflow variants swap only the login step', () => {
  // The deploy job authenticates to Nortezh, not the registry, so it is identical across
  // every option. Saying "adapt it" invites rewriting the parts that must not change.
  const text = deployStack!.render({})
  const flat = text.replace(/\s+/g, ' ')
  assert.match(flat, /\*\*Only the login changes between options\.\*\*/)
  assert.match(text, /username: \$\{\{ github\.actor \}\}/)
  assert.match(text, /password: \$\{\{ secrets\.GITHUB_TOKEN \}\}/)
  assert.match(text, /username: _json_key/)
  assert.match(text, /password: \$\{\{ secrets\.DOCKERHUB_TOKEN \}\}/)
  // The omission that fails as a 403 and looks like a bad credential.
  assert.match(flat, /GHCR also needs `permissions: packages: write` on the build job/)
  // Same escaping trap as the main workflow block — one backslash too many ships a literal.
  assert.equal(
    /\\\$\{\{ (github|secrets|steps|needs)\./.test(text),
    false,
    'a backslash leaked into the registry login snippets',
  )
})

test('the credential question is which secret to use, not how to obtain one', () => {
  // Observed for real, from a stale build: the model offered "I'll paste user + token" and
  // "reuse local docker login" as menu options. That is rule 1 faithfully generating a list
  // of rule 6 violations — nothing said the options had to be things it may do. A menu
  // reads as "I will do whichever you pick", so listing it is offering it.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /Offer only what you can actually do/)
  assert.match(flat, /the question is never \*how should I get your secret\*/)
  assert.match(flat, /\*\*"which pull secret should I use\?"\*\*/)
  assert.match(flat, /The user creates it and names it; you pick from names/)
  // And after the handoff, the name is theirs to state rather than yours to assume.
  assert.match(flat, /\*\*Then ask which one to use\*\* — do not infer it/)
})

test('the pull secret flow is drawn, including the reuse and public exits', () => {
  // Same reason as the deployment flow: three actors, and two branches that end the
  // procedure early. Written as prose the "one already exists, reuse it" path is the one
  // that gets skipped, and a second secret gets requested for no reason.
  const text = deployStack!.render({})
  assert.match(text, /whose image is it\?/)
  assert.match(text, /someone else's, public ──▶ no pull secret\. done\./)
  assert.match(text, /one exists here ──▶ reuse its name/)
  assert.match(text, /then STOP and wait/)
  assert.match(text, /reply with the NAME/)
  assert.match(text, /pullsecretList {2}⚠️ confirm it is really there, in this location/)
  // The ordering constraint that ties it back to the deployment flow.
  const flat = text.replace(/\s+/g, ' ')
  assert.match(flat, /has to exist before CI pushes, not before `deploymentCreate`/)
})

test('the pull secret handoff has reserve detail for other registries', () => {
  // Rule 4 keeps the handoff itself to a few steps, which only works if the detail exists
  // somewhere to draw on. Without it, "a token with read:packages" is a dead end for the
  // registries that are not GHCR, and for the failures that look like a bad token but are
  // not.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /_json_key/)
  assert.match(flat, /Artifact Registry Reader/)
  assert.match(flat, /https:\/\/index\.docker\.io\/v1\//)
  // The two failures that do not look like what they are.
  assert.match(flat, /does not grant that account access to the \*package\*/)
  assert.match(flat, /Wrong location is the silent one/)
})

test('pullsecretCreate is not an exposed tool', () => {
  // The structural half of rule 6. Instructing against it is weaker than not shipping it.
  assert.equal(TOOLS.some((tool) => tool.name === 'pullsecretCreate'), false)
  // The read and delete routes stay — none of them takes a credential as input.
  for (const name of ['pullsecretList', 'pullsecretGet', 'pullsecretDelete']) {
    assert.ok(TOOLS.some((tool) => tool.name === name), `${name} should still be exposed`)
  }
})

test('the model does not claim the API annotation contradicts it', () => {
  // nortezh-backend 13c1283 corrected revision.go's rollback annotation to say it rewinds.
  // The parenthetical telling the model to distrust the generated tool description outlived
  // the thing it described.
  const model = resources!.render({}).replace(/\s+/g, ' ')
  assert.equal(/the API's own annotation is wrong/.test(model), false)
})

test('an argument value cannot expand the other placeholder', () => {
  // Two chained replaces let the first substitution's OUTPUT become the second's subject,
  // so an argument of literally "{{RESOURCE_MODEL}}" was expanded — splicing the whole
  // reference into the user-said block and leaving the real placeholder unfilled.
  const rendered = deployStack!.render({ project: '{{RESOURCE_MODEL}}' })
  assert.match(rendered, /- project: \{\{RESOURCE_MODEL\}\}/)
  assert.equal(rendered.split(resources!.render({})).length, 2, 'the model must appear exactly once')

  // And the reverse ordering.
  const other = deployStack!.render({ project: '{{GIVEN}}' })
  assert.match(other, /- project: \{\{GIVEN\}\}/)
})
