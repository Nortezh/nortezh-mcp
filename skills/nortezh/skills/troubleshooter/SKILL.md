---
name: troubleshooter
description: Work out why something on Nortezh is failing or not behaving as expected — a deployment that will not start, a URL that does not resolve, a database stuck pending, an env change that had no effect, routes that vanished. Use for "why is X failing", "X is down", "this did not work". Read-only diagnosis; the fix goes through nortezh:deployer.
---

# Diagnosing Nortezh

Diagnosis is **read-only**. Finding the cause is this job; applying the fix is not — once you
know what is wrong, load `nortezh:deployer` and go through its plan-and-approve steps like any
other change.

⚠️ **Never resolve a blocked step by weakening something else.** "Make the image public so no
pull secret is needed" publishes the application image permanently to save a console step.

Load `nortezh:resources` first if you have not already.

## Check these first, in this order

**1. Is this the expected first-deploy failure?** A stack built by `nortezh:deployer` creates
the deployment pointing at the tag CI will push, **before CI has pushed anything**, so the
first deploy fails by design. If the deployment is new and that tag has never been pushed,
nothing on Nortezh is broken — the questions are whether the GitHub Actions run happened,
whether it succeeded, and whether it set the real tag. Look there, not here.

**2. Is it actually failed, or just pending?** Only **deployments** and **domains** can report
failure. A disk, database, route or pull secret only ever leaves `state` `pending` for
`ready` (`running`, for a database) — there is **no failure value**, so a broken one sits at
`pending` forever and no error is ever produced.
"Stuck at pending" means *look at what it depends on* — not *wait longer*.

**3. Is a pull secret missing?** This one hides inside case 1. The pull secret must exist
before **CI pushes**, not before the deployment is created — the create fails either way, so a
missing pull secret looks exactly like the expected failure, then resurfaces as a wait that
never ends. `pullsecretList` for that project and location. The user creates it; you only need
its name.

**4. What does the deployment itself say?** `deploymentGet` for `state` — `running`,
`deploying`, `paused` or `failed` — then `deploymentLogRevision` for the revision history
(each revision's own `status` is `pending`, `deploying` or `deployed`).
⚠️ A `statusUrl` is a **10-minute signed token**: refetch it, never reuse one from earlier in
the conversation.

## Causes that look like something else

- **"I changed the env group and nothing happened."** ⚠️ Env group values are **baked into a
  revision at deploy time**. Editing the group does not reach a running deployment until it is
  redeployed.
- **"The secret files are empty now."** ⚠️ `mountDataSecretPaths` **when omitted on a patch
  drops every secret-marked file's value** — so a patch that sent "only the fields that
  changed" did this. Same family: `env` when supplied replaces the whole inline map, and
  `envGroups: []` unlinks every group.
- **"The URL does not resolve."** ⚠️ `url` is always populated. An external ingress exists only
  for a **non-internal WebService** — a `Worker`, `CronJob`, `InternalTCPService`, or a
  WebService with `internal: true` gets a hostname that serves nothing. Check the type is what
  the user thinks it is: **`type` is immutable**, so a `Worker` that should have been a
  `WebService` has to be deleted and recreated.
- **"It went off the internet and I changed nothing else."** `internal: true` on a WebService
  **deletes its external ingress**. It is the one field that silently takes a service off the
  internet.
- **"My routes disappeared."** ⚠️ **Deleting a deployment silently deletes its routes** — the
  FK cascades, with no in-use check and no warning. Nothing else removed them.
- **"The rollback did not fix it."** ⚠️ `deploymentRollback` rewinds the revision number. It
  does **not** create a new revision, and does **not** restore env-group links or `type`. It is
  a partial undo, so a problem caused by either of those survives it.
- **"The name is taken but I cannot see it."** `DEPLOYMENT_NAME_ALREADY_EXISTS`,
  `DISK_NAME_NOT_AVAILABLE` and `DATABASE_NAME_NOT_AVAILABLE` usually mean the thing already
  exists rather than that a new name is needed. Domains and `(domain, path)` routes are unique
  **across the whole platform**, not just the project, so the collision may not be the user's
  at all.
- **"The call errored, let me retry."** A domain error is HTTP 200 with `ok:false`, which the
  MCP layer converts into a real tool error. An identical retry fails identically — read the
  code, fix the input, or ask.
- **"Deleting the project should have cleaned this up."** A project delete leaves most of its
  resources behind, and deleting a domain that does not exist succeeds. Deletes here are
  quieter than you expect in both directions.

## Reporting the diagnosis

State the **cause**, the **evidence** (which call, which field, which value), and the **one
next action**. If that action changes anything, say so and hand over to `nortezh:deployer`
rather than doing it here.

If the evidence does not identify a cause, say that. A confident wrong diagnosis costs more
than an open question.
