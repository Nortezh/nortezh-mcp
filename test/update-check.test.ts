// The update check exists because there is no registry to ask. The package installs from a
// PRIVATE git repo, every build ships as 0.1.0, and `.build-number` is gitignored so an
// installed copy always stamps `build.1` — the commit is the only identity there is.
//
// Nothing here touches the network. `git ls-remote` is exercised by hand (see DEVELOPMENT.md);
// what is tested is the part that decides whether to warn, and what it says.

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  CACHE_TTL_MS,
  FALLBACK_HTTPS_URL,
  isOutdated,
  readCache,
  remoteUrls,
  skipReason,
  SSH_URL,
  updateNotice,
  UPDATE_CHECK_DISABLED_ENV,
  writeCache,
  type UpdateStatus,
} from '../src/update-check.js'

const STAMPED = { version: '0.1.0', build: 12, commit: 'a1b2c3d', builtAt: null }

test('a build that cannot be compared is skipped, silently and by name', () => {
  // Every one of these is a NORMAL state. Warning about the failure to warn would be noise
  // on top of noise, so the reasons exist for a developer reading them, not for the user.
  assert.equal(skipReason(STAMPED, {}), null)
  assert.match(
    String(skipReason(STAMPED, { [UPDATE_CHECK_DISABLED_ENV]: '1' })),
    /NORTEZH_NO_UPDATE_CHECK/,
  )
  // An empty or whitespace value is not "set" — an unset var exported as "" is common.
  assert.equal(skipReason(STAMPED, { [UPDATE_CHECK_DISABLED_ENV]: '  ' }), null)
  // Running from source: tsx, these tests, a clone before `npm run build`.
  assert.match(String(skipReason({ ...STAMPED, build: 0, commit: null }, {})), /from source/)
  // A tarball or an export — a build number, but no commit to compare.
  assert.match(String(skipReason({ ...STAMPED, commit: null }, {})), /no commit/)
  // A dirty tree is not a commit anybody can be behind.
  assert.match(String(skipReason({ ...STAMPED, commit: 'a1b2c3d-dirty' }, {})), /uncommitted/)
})

test('the stamp holds a short sha and the remote answers with a full one', () => {
  // The comparison is a prefix test in one direction only. Getting this backwards reports
  // every up-to-date install as outdated, which is the failure mode that trains people to
  // ignore the warning.
  assert.equal(isOutdated('a1b2c3d', 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'), false)
  assert.equal(isOutdated('a1b2c3d', 'ffffffffffffffffffffffffffffffffffffffff'), true)
  // A full local sha still matches itself.
  assert.equal(isOutdated('a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'), false)
  // Never claim anything from missing data.
  assert.equal(isOutdated('', 'a1b2c3d4'), false)
  assert.equal(isOutdated('a1b2c3d', ''), false)
})

test('https is tried before ssh, and both are tried', () => {
  // A private repo is very often cloned over an ssh key and nothing else, while package.json
  // declares https. Trying one is the difference between the warning working for everyone
  // and working for whoever shares the author's git setup.
  const urls = remoteUrls()
  assert.equal(urls.length, 2)
  assert.match(String(urls[0]), /^https:\/\/github\.com\/Nortezh\/nortezh-mcp\.git$/)
  assert.equal(urls[1], SSH_URL)
  // `git+https://…` is package.json's spelling; git itself rejects the prefix.
  assert.ok(!urls[0]?.startsWith('git+'), urls[0])
  assert.ok(FALLBACK_HTTPS_URL.startsWith('https://'))
})

test('the cache is keyed on the running commit, not just on time', () => {
  // Updating is exactly the event that invalidates the verdict. Without the key, someone who
  // updates and restarts keeps being told to update for the rest of the day.
  const path = join(mkdtempSync(join(tmpdir(), 'nortezh-update-')), 'cache.json')
  const now = Date.parse('2026-08-02T12:00:00.000Z')
  const status: UpdateStatus = {
    current: 'a1b2c3d',
    latest: 'ffffffffffffffffffffffffffffffffffffffff',
    outdated: true,
    checkedAt: new Date(now).toISOString(),
  }
  writeCache(status, path)

  assert.deepEqual(readCache('a1b2c3d', now, path), status)
  // A different build was installed since — the cached verdict is about someone else.
  assert.equal(readCache('9999999', now, path), null)
  // Expired.
  assert.equal(readCache('a1b2c3d', now + CACHE_TTL_MS + 1, path), null)
  assert.notEqual(readCache('a1b2c3d', now + CACHE_TTL_MS - 1, path), null)
  // A clock that moved backwards is not a fresh cache entry.
  assert.equal(readCache('a1b2c3d', now - 60_000, path), null)
})

test('a corrupt or missing cache reads as no cache, never as a throw', () => {
  // This is read during a tool call. A parse error here must not surface as a tool failure.
  const dir = mkdtempSync(join(tmpdir(), 'nortezh-update-'))
  assert.equal(readCache('a1b2c3d', Date.now(), join(dir, 'absent.json')), null)

  const broken = join(dir, 'broken.json')
  writeFileSync(broken, '{not json')
  assert.equal(readCache('a1b2c3d', Date.now(), broken), null)

  const partial = join(dir, 'partial.json')
  writeFileSync(partial, JSON.stringify({ current: 'a1b2c3d' }))
  assert.equal(readCache('a1b2c3d', Date.now(), partial), null)
})

test('the cache is written atomically and leaves no temp file behind', () => {
  // Several MCP clients can run this server at once; a half-written file read as a verdict
  // is worse than no cache at all.
  const dir = mkdtempSync(join(tmpdir(), 'nortezh-update-'))
  const path = join(dir, 'cache.json')
  const status: UpdateStatus = {
    current: 'a1b2c3d',
    latest: 'ffffffffffffffffffffffffffffffffffffffff',
    outdated: true,
    checkedAt: new Date().toISOString(),
  }
  writeCache(status, path)
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), status)
})

test('the notice names both shas and does not stop at the package manager', () => {
  // ⚠️ `nortezh-mcp install` is not optional advice. pnpm installs each version into its own
  // store directory, so after an update the plugin symlink still points at the old one — or
  // at nothing, which takes the TOOLS with it. A notice that omitted it would cause a worse
  // problem than the one it reported.
  const notice = updateNotice({
    current: 'a1b2c3d',
    latest: 'ffffffffffffffffffffffffffffffffffffffff',
    outdated: true,
    checkedAt: new Date().toISOString(),
  })
  assert.match(notice, /a1b2c3d/)
  assert.match(notice, /fffffff/)
  // The full 40-char sha would swamp the line; seven is what git shows.
  assert.ok(!notice.includes('ffffffffffffffffffffffffffffffffffffffff'), notice)
  assert.match(notice, /nortezh-mcp install/)
  assert.match(notice, /--allow-build=nortezh-mcp/)
  assert.match(notice, /[Rr]estart/)
})

test('serverInfo omits the update fields when nothing is known', async () => {
  // These tests run from source, so there is no stamp and no verdict. Reporting
  // `updateAvailable: false` there would be a claim the server cannot support — "cannot
  // tell" and "up to date" are different answers.
  const { LOCAL_TOOLS } = await import('../src/local-tools.js')
  const tool = LOCAL_TOOLS.find((candidate) => candidate.name === 'serverInfo')
  assert.ok(tool !== undefined)
  const result = tool.run() as Record<string, unknown>
  assert.equal(result.updateAvailable, undefined)
  assert.equal(result.latestCommit, undefined)
})
