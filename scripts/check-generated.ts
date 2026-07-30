// Verifies that the committed src/generated/tools.ts is what the generator produces.
//
// The point is that test/tools.test.ts checks "the artifact that actually ships". If the
// check regenerates that artifact first, a stale or hand-edited file always passes — the
// tests would be grading the generator's fresh output against itself.
//
// This replaces an earlier `npm run generate && git diff --exit-code` chain, which had two
// holes: it exited 129 (a git usage error, indistinguishable from real drift) wherever
// there was no repository — a CI tarball, `npm pack` — and it silently passed when
// src/generated/ was untracked, because git had nothing to diff against. It also
// overwrote the developer's file as a side effect of checking it.
//
// So: generate into memory, compare against what is on disk, and leave the file alone.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const target = resolve(root, 'src/generated/tools.ts')

const committed = readFileSync(target, 'utf8')

// Run the real generator, then restore whatever was there. Importing it would be neater,
// but it writes as a side effect of running, and duplicating its logic here would defeat
// the purpose of comparing against it.
execFileSync('tsx', [resolve(here, 'generate.ts')], { cwd: root, stdio: 'pipe' })
const regenerated = readFileSync(target, 'utf8')
writeFileSync(target, committed)

if (committed !== regenerated) {
  console.error(
    'check: src/generated/tools.ts does not match what the generator produces.\n' +
      'Run `npm run generate` and commit the result.\n' +
      `(committed ${committed.length} bytes, generated ${regenerated.length} bytes)`,
  )
  process.exit(1)
}

console.log('check: src/generated/tools.ts is up to date')
