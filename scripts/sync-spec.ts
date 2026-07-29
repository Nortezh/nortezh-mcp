// Copies the committed OpenAPI spec out of the nortezh-backend checkout into spec/.
//
// The spec is VENDORED rather than read from ../nortezh-backend at build time, so this
// repo builds standalone and in its own CI, and so an API change shows up as a reviewable
// diff here instead of silently reshaping the generated tools. Run this deliberately,
// after `make docs` in nortezh-backend, then re-run `npm run generate`.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

// The default assumes the sibling-submodule layout of nortezh-workspace. Override for any
// other checkout: `npm run sync-spec -- /path/to/swagger.json`
const source = process.argv[2] ?? resolve(root, '../nortezh-backend/api/docs/swagger.json')
const target = resolve(root, 'spec/swagger.json')

if (!existsSync(source)) {
  console.error(`sync-spec: source spec not found: ${source}`)
  console.error('sync-spec: run `make docs` in nortezh-backend first, or pass an explicit path.')
  process.exit(1)
}

mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)
console.log(`sync-spec: ${source} -> ${target}`)
