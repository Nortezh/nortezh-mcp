// Fails if the committed skills/nortezh/ is not what the generator produces.
//
// The skill is generated from src/prompts.ts and committed, because it ships in the package
// and gets symlinked into ~/.claude/skills. So it can go stale exactly the way dist/ can:
// edit a rule in prompts.ts, forget to rebuild, and the skill keeps teaching the old one —
// while the prompt and the skill, which are supposed to be one procedure, quietly disagree.
//
// Same shape as check-generated.ts: generate into memory, compare, leave the files alone.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const FILES = ['SKILL.md', 'resources.md', 'deploy-stack.md'].map((name) =>
  resolve(root, 'skills/nortezh', name),
)

const committed = FILES.map((path) => readFileSync(path, 'utf8'))

// Run the real generator, then restore. Duplicating its logic here would defeat the point of
// comparing against it, and it writes as a side effect of running.
execFileSync('tsx', [resolve(here, 'generate-skill.ts')], { cwd: root, stdio: 'pipe' })
const regenerated = FILES.map((path) => readFileSync(path, 'utf8'))
FILES.forEach((path, i) => writeFileSync(path, committed[i] as string))

const stale = FILES.filter((_, i) => committed[i] !== regenerated[i])
if (stale.length > 0) {
  console.error('check: skills/nortezh/ does not match what the generator produces.\n')
  for (const path of stale) console.error(`  out of date  ${path.replace(`${root}/`, '')}`)
  console.error('\nRun `npm run build` and commit skills/.')
  process.exit(1)
}

console.log(`check: skills/nortezh/ is up to date (${FILES.length} files)`)
