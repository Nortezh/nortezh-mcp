// The build stamp exists to answer one question: is the connected client running the build
// I just made? Every change ships as 0.1.0, so before this the only signal was counting
// tools and noticing one that had been removed — which works once per removal.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readBuildInfo, versionString, VERSION } from '../src/version.js'

test('a missing build stamp falls back instead of throwing', () => {
  // Running from source — tsx, these tests, a clone before `npm run build` — has no
  // dist/build-info.json. That is normal, not an error: index.ts calls this during startup,
  // and a throw there takes the whole server down before it can report why.
  const info = readBuildInfo()
  assert.equal(info.build, 0)
  assert.equal(info.commit, null)
  assert.equal(info.version, VERSION)
  assert.equal(versionString(info), `${VERSION}+source`)
})

test('the semver prefix stays parseable whatever the stamp says', () => {
  // serverInfo.version reaches clients that may parse it. Everything after `+` is semver
  // build metadata, ignored for precedence — so the counter cannot break a client that
  // reads this as a version.
  for (const info of [
    { version: '0.1.0', build: 12, commit: 'abc1234', builtAt: null },
    { version: '0.1.0', build: 12, commit: 'abc1234-dirty', builtAt: null },
    { version: '0.1.0', build: 12, commit: null, builtAt: null },
    { version: '0.1.0', build: 0, commit: null, builtAt: null },
  ]) {
    const rendered = versionString(info)
    assert.equal(rendered.split('+')[0], '0.1.0', rendered)
    assert.ok(rendered.includes('+'), rendered)
  }
})

test('the rendered forms are the ones a human reads in /mcp', () => {
  assert.equal(
    versionString({ version: '0.1.0', build: 12, commit: 'abc1234', builtAt: null }),
    '0.1.0+build.12.abc1234',
  )
  // No git — a tarball or an exported source drop. The counter still orders builds.
  assert.equal(
    versionString({ version: '0.1.0', build: 12, commit: null, builtAt: null }),
    '0.1.0+build.12',
  )
  // A dirty tree is called out, because "build 12" from an edited tree is not reproducible.
  assert.match(
    versionString({ version: '0.1.0', build: 3, commit: 'deadbee-dirty', builtAt: null }),
    /-dirty$/,
  )
})

test('serverInfo is callable and reports the build', async () => {
  // The gap the stamp alone left: serverInfo.version goes to the CLIENT, and the model never
  // sees it. It sees tool names, descriptions and schemas — so without a tool, "am I talking
  // to the current build?" was only answerable when a tool had just been added or removed.
  const { LOCAL_TOOLS } = await import('../src/local-tools.js')
  const tool = LOCAL_TOOLS.find((candidate) => candidate.name === 'serverInfo')
  assert.ok(tool !== undefined, 'serverInfo is not registered')
  assert.equal(tool.readOnly, true)
  assert.deepEqual(tool.inputSchema, { type: 'object', properties: {} })

  const result = tool.run() as Record<string, unknown>
  assert.equal(typeof result.version, 'string')
  assert.equal(typeof result.build, 'number')
  // Names the bundled skill, since that is where the guidance lives now — a session can tell
  // whether the skill it is following came from this package.
  assert.match(String(result.skill), /^nortezh \(/)
  // Counts have to include this tool, or the number disagrees with tools/list.
  const { TOOLS } = await import('../src/generated/tools.js')
  assert.equal(result.apiRoutes, TOOLS.length)
  assert.equal(result.tools, TOOLS.length + LOCAL_TOOLS.length)
})

test('a local tool name cannot collide with a generated one', async () => {
  // index.ts checks local tools first, so a collision would silently shadow an API route.
  const { LOCAL_TOOLS } = await import('../src/local-tools.js')
  const { TOOLS } = await import('../src/generated/tools.js')
  const generated = new Set(TOOLS.map((tool) => tool.name))
  for (const tool of LOCAL_TOOLS) {
    assert.equal(generated.has(tool.name), false, `${tool.name} shadows a generated tool`)
  }
})

test('the declared VERSION matches package.json', async () => {
  // Two places state the version; the stamp copies package.json and this constant is the
  // fallback when there is no stamp. If they drift, running from source reports a different
  // version than running a build, which is exactly the confusion this file exists to end.
  const pkg = (await import('../package.json', { with: { type: 'json' } })) as {
    default: { version: string }
  }
  assert.equal(pkg.default.version, VERSION)
})
