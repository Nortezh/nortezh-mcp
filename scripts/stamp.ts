// Writes dist/build-info.json — the stamp that tells one build from the next.
//
// Every change to this server ships as version 0.1.0, so the only way to tell whether a
// client is running the current build has been to count tools and look for one that was
// removed. That works exactly once per removal.
//
// So: an integer that increases on every `npm run build`, plus the commit it came from.
//
// It is written to dist/ rather than src/ on purpose. scripts/check-generated.ts verifies
// that the committed generated artifact matches what the generator produces, and a stamp
// containing a timestamp and a counter differs on every run by design — putting it in src/
// would make that check fail forever.
//
// The counter lives in .build-number at the repo root (gitignored) so `rm -rf dist` does not
// reset it, and so two clones do not fight over a committed value.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const counterPath = resolve(root, '.build-number')
const previous = existsSync(counterPath) ? Number.parseInt(readFileSync(counterPath, 'utf8').trim(), 10) : 0
const build = Number.isFinite(previous) && previous > 0 ? previous + 1 : 1
writeFileSync(counterPath, `${build}\n`)

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version?: string }
const version = pkg.version ?? '0.0.0'

/** Short commit, with -dirty when the tree has uncommitted changes. Absent outside a repo. */
function describeCommit(): string | null {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    const dirty =
      execFileSync('git', ['status', '--porcelain'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() !== ''
    return dirty ? `${sha}-dirty` : sha
  } catch {
    // No git, no repo, or a tarball. The build number alone still orders builds.
    return null
  }
}

const commit = describeCommit()
const builtAt = new Date().toISOString()

const target = resolve(root, 'dist/build-info.json')
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, `${JSON.stringify({ version, build, commit, builtAt }, null, 2)}\n`)

// Semver build metadata: everything after `+` is ignored for precedence, so a client that
// parses this still reads 0.1.0 while a human sees which build it is.
const full = commit === null ? `${version}+build.${build}` : `${version}+build.${build}.${commit}`
console.log(`stamp: ${full}`)
