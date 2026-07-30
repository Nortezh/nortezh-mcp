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

test('with no arguments it tells the model to ask incrementally', () => {
  assert.match(deployStack!.render({}), /no details up front/)
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
  assert.match(text, /\$\{\{ github\.sha \}\}/)
  assert.equal(/\\\$\{\{/.test(text), false, 'a backslash leaked in front of ${{')

  const yaml = text.slice(text.indexOf('```yaml') + 8)
  const body = yaml.slice(0, yaml.indexOf('```'))
  assert.equal(/\\\\\s*$/m.test(body), false, 'double backslash where one continuation was meant')
})

test('the workflow checks the envelope rather than trusting the HTTP status', () => {
  // curl exits 0 on the HTTP 200 that carries ok:false, so without this the job would
  // report a failed deploy as a success.
  assert.match(deployStack!.render({}), /grep -q '"ok":true'/)
})

test('the prompt does not promise tools that are deliberately excluded', () => {
  const text = deployStack!.render({})
  // serviceaccount* and cicd* are not exposed; the prompt must hand those steps to the
  // user rather than instruct the model to call them.
  assert.equal(/`serviceaccount[A-Z]/.test(text), false)
  assert.equal(/`cicd[A-Z]/.test(text), false)
})
