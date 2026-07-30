import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PROMPTS } from '../src/prompts.js'
import { TOOLS } from '../src/generated/tools.js'

const deployStack = PROMPTS.find((prompt) => prompt.name === 'deploy-stack')

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
  assert.match(text, /no failed value at all/)
})

test('the placeholder-first deployment sequence is spelled out', () => {
  const text = deployStack!.render({})
  assert.match(text, /nginx:latest/)
  assert.match(text, /deploymentCreate/)
  assert.match(text, /deploymentDeploy/)
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

test('every tool the prompt instructs the model to call actually exists', () => {
  // The prompt names tools in prose, so a rename or an allowlist change could leave it
  // telling the model to call something that is not there.
  const names = new Set(TOOLS.map((tool) => tool.name))
  const text = PROMPTS.map((prompt) => prompt.render({})).join('\n')

  const referenced = [...text.matchAll(/`([a-z][A-Za-z]+)`/g)]
    .map((match) => match[1] as string)
    // Only check things that look like our tool ids and are plausibly meant as calls.
    .filter((candidate) => /^(project|deployment|disk|db|envgroup|route|domain|pullsecret|cluster|auth)[A-Z]/.test(candidate))

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
  assert.match(flat, /unique \*\*within\*\* the project, not globally/)
})

test('per-service configuration is treated as its own step', () => {
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /Every environment variable it reads/)
  assert.match(flat, /Which of those are secrets/)
  assert.match(flat, /shared across services and which are per-service/)
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
  assert.match(flat, /`cdn: false` \(\*\*the default\*\*\)/)
  assert.match(flat, /DOMAIN_TRIAL_BILLING_CANNOT_CREATE_CDN_DOMAIN/)
})

test('the cname is read from domainGet, not written from memory', () => {
  // domain.go:433 — Get branches on x.CDN: a CDN domain gets cname.nortezh.com, a non-CDN
  // domain gets its own cluster's cname. One hardcoded hostname breaks half the cases.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /cname value differs by the `cdn` flag/)
  assert.match(flat, /always read it, never write one from memory/)
})

test('Cloudflare proxy guidance is explicit', () => {
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  // The grey-cloud instruction rides along with the handoff itself, because getting it
  // wrong wastes the whole DNS round trip. The reasoning stays in reserve.
  assert.match(flat, /set it to \*\*DNS only\*\* \(grey cloud\), not Proxied/)
  assert.match(flat, /Full \(strict\)/)
})

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

test('it does not tell the model to create a project it cannot create', () => {
  // project.go:162,183 — projectCreate requires a billingId UUID, and every billing route
  // is excluded from the exposed tools, so there is no way to obtain one. Instructing the
  // model to call it produces either a VALIDATE_ERROR or an invented UUID.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /You cannot create a project/)
  assert.match(flat, /Do not call `projectCreate` and do not invent a UUID/)
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
  assert.match(flat, /Env groups are plain text and are never masked/)
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
  assert.match(flat, /read the group with `envgroupGet` first/)
})

test('absent envGroups and empty envGroups are distinguished', () => {
  // deployment.go:370-372 — nil leaves the links unchanged, [] clears them. Sending [] to
  // mean "unchanged" strips the deployment's entire shared configuration.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /`envGroups` absent means \*\*leave the current links alone\*\*/)
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
  assert.match(flat, /The placeholder is the image, and only the image/)
})

test('omitting mountDataSecretPaths is flagged as destructive', () => {
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /deletes the stored value of every secret-marked mounted file/)
})

test('a non-CDN domain is not described as needing verification', () => {
  // domain.go:116-126 — inserted StatusSuccess with verification '{}'.
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /stored as success the moment it is created/)
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
  assert.match(model, /non-CDN domain is stored as success the moment it is created/)
  assert.match(model, /`target` is a \*\*URI\*\*: `deployment:\/\/<name>`/)
  assert.match(model, /replaces the whole map/)
  assert.match(model, /do not put real secrets in one/)
  assert.match(model, /any number of deployments\*\* — a disk is not exclusive/)
  assert.match(model, /no exposed tool returns one/)
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
  ['non-CDN domain needs no verification', /stored as success the moment it is created/],
  ['dnsConfig is one CNAME', /`ipv4` and `ipv6` are always empty/],
  ['route target is a URI', /`target` is a \*\*URI\*\*: `deployment:\/\/<name>`/],
  ['route targets WebService only', /CAN_MAP_ONLY_WEB_SERVICE/],
  ['disks are shared', /any number of deployments\*\* — a disk is not exclusive/],
  ['db engines differ', /no `user`, no `database`/],
  ['project creation is blocked', /no exposed tool returns one/],
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
