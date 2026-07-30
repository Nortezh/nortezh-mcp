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
  assert.match(text, /no failed state at all/)
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
    assert.equal(prompt.render({}).includes('{{GIVEN}}'), false, prompt.name)
    assert.equal(prompt.render({ project: 'x' }).includes('{{GIVEN}}'), false, prompt.name)
  }
})

test('every tool the prompt instructs the model to call actually exists', () => {
  // The prompt names tools in prose, so a rename or an allowlist change could leave it
  // telling the model to call something that is not there.
  const names = new Set(TOOLS.map((tool) => tool.name))
  const text = deployStack!.render({})

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
  const account = text.indexOf('Step 1 — the Nortezh service account')
  const secrets = text.indexOf('Step 2 — put it in GitHub')
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
  assert.match(flat, /replaces the entire inline env map wholesale/)
  assert.match(flat, /use `addEnv` \/ `removeEnv`/)
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
  assert.match(flat, /The cname differs by `cdn` flag/)
  assert.match(flat, /never write a hostname from memory/)
})

test('Cloudflare proxy guidance is explicit', () => {
  const flat = deployStack!.render({}).replace(/\s+/g, ' ')
  assert.match(flat, /"DNS only" \(the grey cloud\), not "Proxied"/)
  assert.match(flat, /Full \(strict\)/)
})
