// `nortezh-mcp install-skill` — link the bundled skill into ~/.claude/skills.
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

import { lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
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

export function installSkill(): void {
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
    rmSync(link)
  }

  symlinkSync(target, link, 'dir')
  console.error(`Installed: ${link} -> ${target}`)
  console.error('Run this again after every update — on pnpm the link does not follow one.')
  console.error('Remove with: rm ~/.claude/skills/nortezh')
}
