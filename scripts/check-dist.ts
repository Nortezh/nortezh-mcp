// Fails if the committed dist/ is not what the current source compiles to.
//
// dist/ is committed because this package is installed straight from git, and `npm i -g`
// does not install devDependencies — so there is no tsx and no tsc at install time and
// nothing can be built there. Shipping the build output is what makes the install work.
//
// The cost of that decision is staleness: change src/, forget `npm run build`, and every
// user gets yesterday's server while the diff looks perfectly fine. Nothing about the
// source tree reveals it. So this compiles to a temporary directory and compares.
//
// build-info.json is excluded — it carries a timestamp and a counter that change on every
// build by design. Source maps are excluded too: they embed the outDir path, so a temp
// build never matches, and they cannot drift independently of the .js they describe.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const dist = resolve(root, 'dist')

/** Every .js file under a directory, as paths relative to it. */
function jsFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith('.js')) out.push(relative(dir, full))
    }
  }
  walk(dir)
  return out.sort()
}

const temp = mkdtempSync(join(tmpdir(), 'nortezh-dist-'))
try {
  execFileSync('npx', ['tsc', '--outDir', temp, '--sourceMap', 'false'], {
    cwd: root,
    stdio: 'pipe',
  })

  const fresh = jsFiles(temp)
  const committed = jsFiles(dist)

  const missing = fresh.filter((file) => !committed.includes(file))
  const extra = committed.filter((file) => !fresh.includes(file))
  // The committed build carries sourcemaps, the temp one does not, so every file would
  // differ by its trailing sourceMappingURL comment. Strip it from both before comparing —
  // it is a pointer to a sibling file, not code that can drift on its own.
  // trimEnd matters: stripping the comment leaves the committed file without its trailing
  // newline while the temp build keeps one, so every file would differ by a single byte.
  const code = (path: string) =>
    readFileSync(path, 'utf8')
      .replace(/\/\/# sourceMappingURL=.*$/m, '')
      .trimEnd()

  const changed = fresh
    .filter((file) => committed.includes(file))
    .filter((file) => code(join(temp, file)) !== code(join(dist, file)))

  if (missing.length > 0 || extra.length > 0 || changed.length > 0) {
    console.error('check: dist/ does not match the current source.\n')
    for (const file of missing) console.error(`  missing from dist/  ${file}`)
    for (const file of extra) console.error(`  stale in dist/      ${file}`)
    for (const file of changed) console.error(`  out of date         ${file}`)
    console.error('\nRun `npm run build` and commit dist/.')
    console.error('dist/ is committed because `npm i -g` from git cannot compile it.')
    process.exit(1)
  }

  console.log(`check: dist/ matches the source (${fresh.length} files)`)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
