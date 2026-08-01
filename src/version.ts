// Resolving what to report as this server's version.
//
// The semver in package.json barely moves, so on its own it cannot answer "is the client
// running the build I just made" — which is the question that actually gets asked. The build
// stamp written by scripts/stamp.ts carries a counter that increases every build, plus the
// commit it came from.
//
// Read at runtime rather than imported, deliberately: the stamp is generated into dist/ and
// is absent when running from source (tsx, tests, a fresh clone before `npm run build`).
// A missing stamp is normal, not an error — so this falls back instead of throwing.

import { readFileSync } from 'node:fs'

/** Kept in step with package.json; the build counter is what distinguishes two builds. */
export const VERSION = '0.1.0'

export interface BuildInfo {
  version: string
  /** Increases on every `npm run build`. 0 means "running from source, never stamped". */
  build: number
  /** Short commit, `-dirty` suffixed when the tree had uncommitted changes. */
  commit: string | null
  builtAt: string | null
}

const UNSTAMPED: BuildInfo = { version: VERSION, build: 0, commit: null, builtAt: null }

export function readBuildInfo(): BuildInfo {
  try {
    // Next to the compiled entrypoint, so this resolves in dist/ and simply misses in src/.
    const raw = readFileSync(new URL('./build-info.json', import.meta.url), 'utf8')
    const parsed = JSON.parse(raw) as Partial<BuildInfo>
    if (typeof parsed.build !== 'number') return UNSTAMPED
    return {
      version: typeof parsed.version === 'string' ? parsed.version : VERSION,
      build: parsed.build,
      commit: typeof parsed.commit === 'string' ? parsed.commit : null,
      builtAt: typeof parsed.builtAt === 'string' ? parsed.builtAt : null,
    }
  } catch {
    return UNSTAMPED
  }
}

/**
 * What goes in `serverInfo.version`, and what `nortezh-mcp version` prints.
 *
 * Semver build metadata — everything after `+` is ignored for version precedence, so a
 * client that parses this still sees 0.1.0, while a human reading it in `/mcp` can tell
 * build 12 from build 11.
 */
export function versionString(info: BuildInfo = readBuildInfo()): string {
  if (info.build === 0) return `${info.version}+source`
  if (info.commit === null) return `${info.version}+build.${info.build}`
  return `${info.version}+build.${info.build}.${info.commit}`
}
