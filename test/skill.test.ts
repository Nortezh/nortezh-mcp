// The skill is the only mechanism that reaches the model BEFORE it starts running Bash.
//
// Everything else is downstream of an MCP call, and arrives after the agent has already
// decided what to do. But `docker build` and reading a credential store never touch an MCP
// tool at all — so the failure that started this (an image built on a laptop and pushed with
// the keychain credential) is invisible to the server. The skill's frontmatter sits in context
// from the first token of the turn, which is the only place that can catch it. That is why
// the guidance lives here and the server carries none of it.
//
// skills/nortezh/ is a Claude Code PLUGIN, so each skills/<name>/SKILL.md is invocable as
// `nortezh:<name>` and the plugin root's SKILL.md is the always-on router.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { VERSION } from '../src/version.js'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../skills/nortezh')
const read = (name: string) => readFileSync(join(dir, name), 'utf8')

const router = read('SKILL.md')
const resources = read('skills/resources/SKILL.md')
const deployer = read('skills/deployer/SKILL.md')
const reporter = read('skills/reporter/SKILL.md')
const troubleshooter = read('skills/troubleshooter/SKILL.md')

const CAPABILITIES = ['resources', 'deployer', 'reporter', 'troubleshooter'] as const

test('the frontmatter fires on any Nortezh work, not only deploys', () => {
  // The router's description is the entire trigger surface for the whole plugin. Scoping it
  // to deploys would leave every read-only answer ungoverned — and readiness differs per
  // resource, so those answers are exactly where a confident wrong answer comes from.
  assert.match(router, /^---\nname: nortezh\ndescription: /)
  assert.match(router, /Use whenever the user mentions Nortezh/)
  assert.match(router, /deploying, inspecting or changing/)
})

test('the router names every capability, or the model cannot reach it', () => {
  // Nothing discovers a sibling skill. A capability missing from this list is a file that
  // ships and is never loaded.
  for (const name of CAPABILITIES) {
    assert.match(router, new RegExp(`\`nortezh:${name}\``), `the router does not mention ${name}`)
  }
})

test('every capability is a real skill with its own trigger', () => {
  // Frontmatter `name` has to match the directory, or the plugin loads it under a name the
  // router does not point at.
  const files: Array<[string, string]> = [
    ['resources', resources],
    ['deployer', deployer],
    ['reporter', reporter],
    ['troubleshooter', troubleshooter],
  ]
  for (const [name, text] of files) {
    assert.match(text, new RegExp(`^---\\nname: ${name}\\ndescription: `), `${name}: bad frontmatter`)
    const description = /description: (.*)/.exec(text)?.[1] ?? ''
    assert.ok(description.length > 80, `${name}: description too thin to match a request against`)
  }
})

test('the plugin manifest is what makes the names namespace', () => {
  const manifest = JSON.parse(read('.claude-plugin/plugin.json')) as {
    name: string
    version: string
    skills: string[]
  }
  assert.equal(manifest.name, 'nortezh', 'the prefix in nortezh:<skill> comes from here')
  // `./` is what makes the plugin scan its own directory for skills/<name>/.
  assert.deepEqual(manifest.skills, ['./'])
  // Generated from src/version.ts so a released plugin cannot claim a version the package
  // does not have.
  assert.equal(manifest.version, VERSION)
})

test('the plugin registers the server, so there is no separate mcp add step', () => {
  // Shipping .mcp.json is what collapses the install to one command, and it is also what
  // guarantees the tools and the guidance are the same build of the package.
  const mcp = JSON.parse(read('.mcp.json')) as { mcpServers: Record<string, { command: string }> }
  assert.deepEqual(Object.keys(mcp.mcpServers), ['nortezh'])
  // The bin name from package.json, resolved on PATH — the global install is what puts it
  // there, and it is the same install that provides this plugin.
  assert.equal(mcp.mcpServers.nortezh?.command, 'nortezh-mcp')
})

test('the invariants survive even if no capability is loaded', () => {
  // The router is the only part guaranteed to be in context once the skill fires. The rules
  // that cannot be missed have to be in it, not only in the 15k procedure.
  // Flattened: the source wraps at 90 columns, so a rule can straddle a line break.
  const flat = router.replace(/\s+/g, ' ')
  assert.match(flat, /Never build or push a container image/)
  assert.match(flat, /Never obtain, read or ask for a credential/)
  assert.match(flat, /Nothing is created, changed or deleted before the user approves/)
  assert.match(flat, /Never resolve a blocked step by weakening something else/)
  // The shell-specific ones, since this is the only surface that reaches them.
  assert.match(flat, /`gh auth token`, `~\/\.docker\/config\.json`/)
  assert.match(flat, /not a Makefile target that wraps one/)
})

test('cost is graduated — the point of splitting the plugin up', () => {
  // The router is paid for on every Nortezh mention; the rest only when it applies. One file
  // would load the whole procedure to answer "how much does a disk cost?".
  assert.ok(router.length < 4_500, `SKILL.md is ${router.length} chars — too big to load always`)
  assert.ok(resources.length > 10_000, 'resources should carry the whole model')
  assert.ok(deployer.length > 40_000, 'deployer should carry the whole procedure')
})

test('the read-only capabilities hand changes back to the deployer', () => {
  // Both are diagnosis/reporting. Left to themselves they would "just fix it", which walks
  // straight past the approval gate that only lives in the deployer procedure.
  for (const [name, text] of [
    ['reporter', reporter],
    ['troubleshooter', troubleshooter],
  ] as const) {
    assert.match(text, /read-only/i, `${name} does not say it is read-only`)
    assert.match(text, /`nortezh:deployer`/, `${name} does not hand changes to the deployer`)
  }
})

test('the reporter does not read a database password to build a report', () => {
  // db*Get returns it in plain text, and a report is exactly the situation where nobody
  // needs it and it would sit in the transcript for the rest of the session.
  assert.match(reporter, /Do not call `dbPostgresGet`/)
  assert.match(reporter, /password in plain text/)
})

test('the troubleshooter knows the first deploy fails on purpose', () => {
  // Without this it diagnoses the designed failure as a bug and "fixes" a working stack —
  // most likely by building the image locally, which is the one thing that must not happen.
  assert.match(troubleshooter, /expected first-deploy failure/)
  assert.match(troubleshooter, /before CI has pushed anything/)
  // And the pending-vs-failed distinction, which has no failure value at all to observe.
  assert.match(troubleshooter, /no failure value/)
})

test('the deployer references the resource model, it does not duplicate it', () => {
  // Skills can name each other, so duplicating would both double the cost and give the next
  // edit two places to drift apart.
  assert.equal(
    deployer.includes('Reference: what each Nortezh resource is'),
    false,
    'the model is inlined into the deployer skill',
  )
  assert.match(deployer, /The resource model is the `nortezh:resources` skill/)
})

