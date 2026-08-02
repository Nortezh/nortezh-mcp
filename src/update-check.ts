// Telling the user their nortezh-mcp is behind origin/main.
//
// The package installs straight from git and is never published to a registry, so there is
// no `npm outdated` to lean on and no version number to compare: every build ships as 0.1.0,
// and `.build-number` is gitignored, so an installed copy always stamps `build.1`. The only
// identity an installed copy carries is the COMMIT in dist/build-info.json.
//
// So the check is: ask the remote for the sha at HEAD and compare it to that commit.
//
// `git ls-remote` rather than the GitHub API, deliberately. The repository is PRIVATE — an
// unauthenticated api.github.com request answers 404 — and the alternatives all mean reading
// somebody's credential out of another tool. ls-remote goes through git's own credential
// helper or ssh agent, which is the exact same auth that made
// `pnpm i -g github:Nortezh/nortezh-mcp` work in the first place. It therefore succeeds
// precisely when the install succeeded, and this file never sees a token.
//
// ⚠️ It must never block and never prompt. Both ls-remote calls run with GIT_TERMINAL_PROMPT=0
// and ssh in BatchMode, plus a hard timeout: without those, a user whose credentials have
// lapsed gets a password prompt on a process whose stdout is the MCP transport, and the
// server hangs instead of serving tools.
//
// Everything here fails silently. A warning about a failed warning helps nobody, and this is
// a convenience running alongside the actual job.

import { execFile } from 'node:child_process'
import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readBuildInfo, type BuildInfo } from './version.js'

/** Set it to anything non-empty to switch the check off — CI, air-gapped, or just noise. */
export const UPDATE_CHECK_DISABLED_ENV = 'NORTEZH_NO_UPDATE_CHECK'

/** Where the package lives, whether that is dist/ (built) or src/ (tsx). */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Used when package.json cannot be read — the same repo the README installs from. */
export const FALLBACK_HTTPS_URL = 'https://github.com/Nortezh/nortezh-mcp.git'
export const SSH_URL = 'git@github.com:Nortezh/nortezh-mcp.git'

/** One day. A restart-heavy day should cost one network call, not one per restart. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000

const LS_REMOTE_TIMEOUT_MS = 5_000

export interface UpdateStatus {
  /** The commit this build was made from — the cache key as much as the comparison input. */
  current: string
  /** Full sha at the remote's HEAD. */
  latest: string
  outdated: boolean
  /** ISO 8601, for the TTL. */
  checkedAt: string
}

/**
 * Why this build cannot, or should not, be compared against the remote.
 *
 * Returns null when the check should run. Every one of these is a normal state, not an
 * error: a developer running from source has no stamp, a tarball install has no commit, and
 * a dirty tree is not a commit anybody could be "behind".
 */
export function skipReason(
  info: BuildInfo,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if ((env[UPDATE_CHECK_DISABLED_ENV] ?? '').trim() !== '') return `${UPDATE_CHECK_DISABLED_ENV} is set`
  if (info.build === 0) return 'running from source — no build stamp to compare'
  if (info.commit === null) return 'no commit in the build stamp — built outside a git repo'
  if (info.commit.endsWith('-dirty')) return 'built from an uncommitted tree'
  return null
}

/**
 * The remotes to try, in order.
 *
 * https first because that is what package.json declares and what a credential helper or PAT
 * covers; ssh second because a private repo is very often cloned over an ssh key and nothing
 * else. Trying both is the difference between the warning working for everyone and working
 * for whoever happens to share the author's git setup.
 */
export function remoteUrls(): string[] {
  let declared: string | null = null
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      repository?: { url?: string } | string
    }
    const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
    // package.json declares `git+https://…`; git itself wants it without the prefix.
    if (typeof raw === 'string' && raw !== '') declared = raw.replace(/^git\+/, '')
  } catch {
    declared = null
  }

  const urls = [declared ?? FALLBACK_HTTPS_URL, SSH_URL]
  return urls.filter((url, index) => urls.indexOf(url) === index)
}

/**
 * True when the installed commit is not the remote's HEAD.
 *
 * The stamp holds a SHORT sha and ls-remote answers with a full one, so this is a prefix
 * test. It can only prove "different", never "older" — an installed copy carries no git
 * history to order two commits with. Different is reported as out of date anyway: the case
 * it gets wrong is a developer sitting on their own commit, and they are the one person who
 * can read the two shas in the message and know why.
 */
export function isOutdated(currentCommit: string, remoteSha: string): boolean {
  const current = currentCommit.replace(/-dirty$/, '')
  if (current === '' || remoteSha === '') return false
  return !remoteSha.startsWith(current)
}

export function cachePath(): string {
  return join(tmpdir(), 'nortezh-mcp-update.json')
}

/**
 * The cached verdict, if it is still fresh AND was recorded for the build now running.
 *
 * Keyed on the commit because updating is exactly the event that invalidates it: without the
 * key, a user who updates and restarts keeps being told to update for up to a day.
 */
export function readCache(
  currentCommit: string,
  now: number = Date.now(),
  path: string = cachePath(),
): UpdateStatus | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<UpdateStatus>
    if (typeof parsed.current !== 'string' || parsed.current !== currentCommit) return null
    if (typeof parsed.latest !== 'string' || typeof parsed.checkedAt !== 'string') return null
    const age = now - Date.parse(parsed.checkedAt)
    if (!Number.isFinite(age) || age < 0 || age > CACHE_TTL_MS) return null
    return {
      current: parsed.current,
      latest: parsed.latest,
      outdated: parsed.outdated === true,
      checkedAt: parsed.checkedAt,
    }
  } catch {
    return null
  }
}

export function writeCache(status: UpdateStatus, path: string = cachePath()): void {
  // Written through a temp file: several MCP clients can be running this server at once, and
  // a half-written cache would be read as corrupt (harmless) or as a stale verdict (not).
  const temporary = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(status, null, 2)}\n`)
    renameSync(temporary, path)
  } catch {
    try {
      unlinkSync(temporary)
    } catch {
      /* nothing to clean up, and a cache that cannot be written is not worth a word */
    }
  }
}

/** `git ls-remote <url> HEAD` → the full sha, or null for any failure at all. */
export async function lsRemoteHead(url: string): Promise<string | null> {
  return await new Promise((resolvePromise) => {
    execFile(
      'git',
      ['ls-remote', url, 'HEAD'],
      {
        timeout: LS_REMOTE_TIMEOUT_MS,
        // ⚠️ stdout of THIS process is the MCP transport. git writes to its own pipes here,
        // but the prompts are the real hazard: an expired credential otherwise blocks the
        // process on a terminal that is not a terminal.
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -oBatchMode=yes',
        },
      },
      (error, stdout) => {
        if (error) {
          resolvePromise(null)
          return
        }
        // "<sha>\tHEAD" — one line, tab-separated.
        const sha = stdout.toString().trim().split(/\s+/)[0] ?? ''
        resolvePromise(/^[0-9a-f]{7,40}$/.test(sha) ? sha : null)
      },
    )
  })
}

/** The last verdict this process resolved, so serverInfo can answer without doing I/O. */
let resolved: UpdateStatus | null = null

/** Test seam — the module-level verdict is process-wide by design. */
export function setResolvedStatus(status: UpdateStatus | null): void {
  resolved = status
}

/**
 * The verdict for this process, if one is already known.
 *
 * Synchronous, because `serverInfo` answers in-process and must not become async for this.
 * Falls back to a fresh cache entry so a server whose background check has not landed yet —
 * or was never started, as in the CLI — still reports what the last one found.
 */
export function knownStatus(info: BuildInfo = readBuildInfo()): UpdateStatus | null {
  if (resolved !== null) return resolved
  if (skipReason(info) !== null || info.commit === null) return null
  return readCache(info.commit)
}

/**
 * Resolve the update status: cache if fresh, otherwise ask the remote.
 *
 * Returns null when the check does not apply or could not run — the two are deliberately
 * indistinguishable to callers, because neither is something to tell the user about.
 */
export async function checkForUpdate(info: BuildInfo = readBuildInfo()): Promise<UpdateStatus | null> {
  if (skipReason(info) !== null || info.commit === null) return null

  const cached = readCache(info.commit)
  if (cached !== null) {
    resolved = cached
    return cached
  }

  for (const url of remoteUrls()) {
    const latest = await lsRemoteHead(url)
    if (latest === null) continue
    const status: UpdateStatus = {
      current: info.commit,
      latest,
      outdated: isOutdated(info.commit, latest),
      checkedAt: new Date().toISOString(),
    }
    writeCache(status)
    resolved = status
    return status
  }

  return null
}

/**
 * What the user is told, in every surface.
 *
 * ⚠️ The `nortezh-mcp install` half is not optional advice. pnpm installs each version into
 * its own store directory, so after an update the plugin symlink still points at the old one
 * — or at nothing, which takes the TOOLS with it, not just the guidance. Omitting it turns
 * this warning into the cause of a worse problem than the one it reported.
 */
export function updateNotice(status: UpdateStatus): string {
  const latest = status.latest.slice(0, 7)
  return [
    `⚠️  A newer nortezh-mcp is available — this build is from ${status.current}, origin/main is now ${latest}.`,
    '    pnpm i -g --allow-build=nortezh-mcp github:Nortezh/nortezh-mcp && nortezh-mcp install',
    '    (npm: drop --allow-build.) Then restart Claude Code — `install` is not optional on pnpm.',
  ].join('\n')
}
