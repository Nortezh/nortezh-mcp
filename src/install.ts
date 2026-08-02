// `nortezh-mcp install` — link the bundled plugin into ~/.claude/skills.
//
// What gets linked is a Claude Code PLUGIN, not a lone skill. Landing it at
// ~/.claude/skills/nortezh is what makes it auto-load as `nortezh@skills-dir` — no marketplace
// and no `claude plugin install` — while its `skills/<name>/SKILL.md` files become
// `nortezh:resources`, `nortezh:deployer`, `nortezh:reporter`, `nortezh:troubleshooter`.
// The root SKILL.md stays an ordinary always-on skill and routes between them.
//
// The plugin also carries `.mcp.json`, so this one command registers the SERVER as well and
// there is no `claude mcp add` step. That is not just convenience: the tools and the guidance
// then come from one directory, so they cannot be different builds of the package.
//
// ⚠️ It declares the server as `nortezh`, the same name `claude mcp add nortezh` would use.
// Anyone who registered it by hand should remove that registration or end up with two.
//
// Done explicitly rather than from an npm `postinstall`. A package writing into someone's
// Claude configuration behind their back is invisible to uninstall and surprising when it is
// found; one documented command costs a line in the README and can be reversed with `rm`.
//
// A SYMLINK, not a copy, and pointed at the installed package. On npm that means an update
// flows through with no re-install, because `npm i -g` replaces the package contents in
// place — a copy would silently serve the version that happened to be current on the day it
// was run.
//
// ⚠️ pnpm does NOT replace in place. Each version lands in its own content-addressed store
// directory, so after `pnpm i -g` the link still points at the previous version's directory,
// or at nothing if the store was pruned. Re-running this repoints it, which is why the
// closing message says to, and why a stale or dangling link is repaired rather than refused.

import { lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where the bundled skill lives inside the package: <root>/skills/nortezh. */
export function bundledSkillPath(): string {
  // This file runs from dist/, so the package root is one level up.
  return resolve(dirname(fileURLToPath(import.meta.url)), '../skills/nortezh')
}

export function skillLinkPath(): string {
  return join(homedir(), '.claude', 'skills', 'nortezh')
}

export function installPlugin(): void {
  const target = bundledSkillPath()
  const link = skillLinkPath()

  mkdirSync(dirname(link), { recursive: true })

  let existing: ReturnType<typeof lstatSync> | null = null
  try {
    existing = lstatSync(link)
  } catch {
    existing = null
  }

  if (existing !== null) {
    if (!existing.isSymbolicLink()) {
      // A real directory here is someone's own skill, or a copy from an older install.
      // Replacing it would delete work that is not ours.
      console.error(`refusing to replace ${link} — it is not a symlink.`)
      console.error('Move or remove it first, then run this again.')
      process.exitCode = 1
      return
    }
    if (readlinkSync(link) === target) {
      console.error(`Already installed: ${link} -> ${target}`)
      return
    }
    // Our own link, pointing somewhere stale — a previous checkout, or an older global
    // prefix. Repointing is the whole job of re-running this.
    //
    // ⚠️ unlinkSync, not rmSync. rmSync stats THROUGH the symlink, sees a directory, and
    // throws EISDIR — so every repoint failed with "Path is a directory". It stayed hidden
    // because the common cases return early: an identical target says "already installed",
    // and a fresh machine has no link at all. Which is exactly the pnpm update path.
    unlinkSync(link)
  }

  symlinkSync(target, link, 'dir')
  console.error(`Installed: ${link} -> ${target}`)
  console.error('This provides both the nortezh MCP server and the nortezh:* skills.')
  console.error('Restart Claude Code to pick it up, or /reload-plugins in a running session.')
  console.error('')
  console.error('If you previously ran `claude mcp add nortezh`, remove it — otherwise you')
  console.error('will have two servers by that name:  claude mcp remove nortezh --scope user')
  console.error('')
  console.error('Re-run after every update — on pnpm the link does not follow one.')
  console.error('Remove with: nortezh-mcp uninstall')
}

/**
 * `nortezh-mcp uninstall` — remove the link, and with it the server and the skills.
 *
 * Deleting the directory really is the supported removal path: `claude plugin uninstall`
 * refuses a plugin loaded from ~/.claude/skills, saying so outright ("no marketplace backing
 * — delete the directory to remove it"). This exists so the counterpart to `install`
 * is a command rather than a hand-typed `rm` against a path in the user's home directory.
 *
 * ⚠️ Only ever unlinks a SYMLINK. A real directory there is somebody's own skill, or a copy
 * from an install that predates this — deleting it would destroy work that is not ours, and
 * `rm -rf` on a path built from `homedir()` is exactly the code that must not guess.
 */
export function uninstallPlugin(): void {
  const link = skillLinkPath()

  let existing: ReturnType<typeof lstatSync>
  try {
    existing = lstatSync(link)
  } catch {
    console.error(`Nothing to remove — ${link} does not exist.`)
    return
  }

  if (!existing.isSymbolicLink()) {
    console.error(`refusing to delete ${link} — it is a real directory, not our symlink.`)
    console.error('Check what is in it and remove it by hand if you are sure.')
    process.exitCode = 1
    return
  }

  const target = readlinkSync(link)
  unlinkSync(link)
  console.error(`Removed: ${link} (was -> ${target})`)
  console.error('That takes the nortezh MCP server and the nortezh:* skills with it.')
  console.error('Restart Claude Code to apply.')
  console.error('')
  console.error('Still installed: the package itself (pnpm rm -g nortezh-mcp) and your')
  console.error('stored token (nortezh-mcp logout — run it before removing the package).')
}
