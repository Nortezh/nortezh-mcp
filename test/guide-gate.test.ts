// The gate exists because two softer mechanisms both failed in real runs.
//
// The guidance started as an MCP prompt, which is user-invoked only — a plain "deploy this to
// nortezh" loads none of it, and a run on a build containing every rule still built an image
// locally and pushed it with the laptop's docker credential. Adding a `deployGuide` tool
// raises the odds but does not close it: the model still has to choose to call it, and the
// failure being fixed is a model that did not.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { GuideGate } from '../src/guide-gate.js'
import { DEPLOY_STACK_GUIDE, LOCAL_TOOLS } from '../src/local-tools.js'
import { TOOLS } from '../src/generated/tools.js'

const read = { readOnly: true }
const write = { readOnly: false }
const gate = () => new GuideGate({ enabled: true, guidance: 'GUIDANCE-BODY' })

test('the first write is blocked and carries the guidance', () => {
  const g = gate()
  const blocked = g.check(write)
  assert.notEqual(blocked, null)
  // The text itself, not a pointer to it — a second round trip is a second chance to skip.
  assert.match(blocked as string, /GUIDANCE-BODY/)
  assert.match(blocked as string, /this call did NOT run/i)
})

test('the retry goes through', () => {
  // The guidance is in the blocked response, so the model has it. Blocking the retry too
  // would loop forever and make the server unusable.
  const g = gate()
  assert.notEqual(g.check(write), null)
  assert.equal(g.check(write), null)
  assert.equal(g.check(write), null)
})

test('read-only calls are never blocked', () => {
  // Blocking these would make the inventory step of the very procedure being taught
  // impossible: projectList and deploymentGet come before any write in the flow.
  const g = gate()
  assert.equal(g.check(read), null)
  assert.equal(g.check(read), null)
  assert.equal(g.satisfied, false, 'a read must not satisfy the gate either')
  assert.notEqual(g.check(write), null, 'the first write is still gated after reads')
})

test('delivering the guidance another way satisfies it', () => {
  // The user invoking the prompt, or the model calling deployGuide. Blocking a write after
  // someone deliberately read the rules would be pure friction.
  const g = gate()
  g.markDelivered()
  assert.equal(g.satisfied, true)
  assert.equal(g.check(write), null)
})

test('disabled means never blocked', () => {
  // NORTEZH_TOKEN — CI, where nobody reads a tool error and the blocked call is a failed
  // job step.
  const g = new GuideGate({ enabled: false, guidance: 'GUIDANCE-BODY' })
  assert.equal(g.check(write), null)
  assert.equal(g.satisfied, false)
})

test('what the gate serves is the deploy-stack procedure itself', () => {
  // One source: the slash command, deployGuide, and the gate all render the same constant,
  // so guidance cannot drift between the three doors it comes through.
  assert.match(DEPLOY_STACK_GUIDE, /## The six rules that matter most/)
  assert.match(DEPLOY_STACK_GUIDE, /## Step 5 — Get explicit approval/)
  // And the note correcting the prompt's "nothing said yet" opening, which is false when it
  // arrives mid-conversation as a tool result.
  assert.match(DEPLOY_STACK_GUIDE, /Treat anything they have stated as answered/)
})

test('deployGuide is registered, read-only, and returns the text', () => {
  const tool = LOCAL_TOOLS.find((candidate) => candidate.name === 'deployGuide')
  assert.ok(tool !== undefined, 'deployGuide is not registered')
  assert.equal(tool.readOnly, true, 'it must never be gated by itself')
  assert.equal(tool.run(), DEPLOY_STACK_GUIDE)
  // The description is the entire trigger surface — it has to exclude the read-only cases,
  // or 19k tokens load to answer "what is deployed?".
  assert.match(tool.description, /BEFORE any call that creates, changes or deletes/)
  assert.match(tool.description, /Do NOT call it for read-only questions/)
})

test('every mutating API tool is gated, every read-only one is not', () => {
  // Derived from the generated safety hints rather than a hand-written list, so a route
  // added to the allowlist is covered without anyone remembering to update this.
  const g = gate()
  const writes = TOOLS.filter((tool) => !tool.readOnly)
  const reads = TOOLS.filter((tool) => tool.readOnly)
  assert.ok(writes.length > 20 && reads.length > 20, 'expected both kinds in the tool set')

  for (const tool of reads) assert.equal(gate().check(tool), null, `${tool.name} was gated`)
  assert.notEqual(g.check(writes[0] as { readOnly: boolean }), null)
})
