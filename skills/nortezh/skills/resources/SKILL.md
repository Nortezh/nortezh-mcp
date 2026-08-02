---
name: resources
description: The Nortezh resource model — what each resource is, what it depends on, how to tell it is ready, and what can still be changed after it exists. Load before answering any question about the state of Nortezh resources; readiness is reported differently by nearly every one of them.
---

Reference: what each Nortezh resource is, what it depends on, how you know it is ready,
and what can still be changed after it exists.

Read this when you are unsure what something *is* — as opposed to which call to make, which
the tool schemas already describe. Every claim here was checked against the API source.

## How readiness is reported

Every asynchronous resource answers with two fields, and both are words:

- **`status`** — how far the deployer has got: `pending`, then `success` or, where the
  resource can fail, `failed`. A domain uses `pending` / `verify` / `success` / `error`.
- **`state`** — what the resource **is**, folding `status` together with `action` (the
  recorded intent): `running`, `deploying`, `paused`, `pausing`, `deleting`, `deleted`,
  `ready`, `pending`, `verifying`, `failed`. This is the field to quote to a user.
  Deployments and managed databases reach **`running`** — they are workloads. Disks, routes
  and pull secrets reach **`ready`**: nothing in them runs.

⚠️ The raw API is not this tidy, and reading it directly will not match: disks, databases,
routes and pull secrets return a bare integer (`1` pending, `2` success), a revision's
integer means something else again (`1` pending, `2` **deploying**, `3` deployed), and the
field is called `actionStatus` on deployments, disks and databases. **The MCP server
translates all of it** — it renames `actionStatus` to `status`, converts every integer to
its name, and derives `state`. `action` is passed through untouched.

## The dependency graph

Read an arrow as "must exist first".

```
billing account ─▶ project ─┬─▶ env group ────┐
   (not a tool)             ├─▶ pull secret ──┼─▶ deployment ─┐
                            ├─▶ disk ─────────┘               ├─▶ route
                            ├─▶ domain ───────────────────────┘
                            └─▶ managed database   (feeds config only — no platform link)

cluster / location ─▶ deployment, disk, database, domain, route, pull secret
```

A **route** is the only resource with two parents: a domain and a deployment.

⚠️ A **managed database is not connected to a deployment by the platform.** No foreign key,
no join table, nothing in the deployer. The only connection is the values you copy out of
`db*Get` into the deployment's configuration — so nothing stops a deployment pointing at a
database that was deleted, or at the wrong one.

## Project

**Is** a tenancy boundary: billing, membership, and the namespace most resource names are
unique within. Not one application — it holds **many** deployments, databases, disks, env
groups and domains.

- **Depends on:** an **active** billing account. `projectCreate` takes its `billingId`
  (a UUID), which you can read from `projectGet` or `projectOverview` on a project the user
  already has. Only if they have no project at all is this a console handoff.
- **Depended on by:** everything.
- **Ready:** immediately. Synchronous.
- **Mutable:** `projectEdit` changes the display name — ⚠️ **owner-only**; a non-owner gets
  `PROJECT_NOT_FOUND`, which looks like the project is missing. The **slug is the identity**
  every other call uses and cannot be changed.
- **Members:** `projectListMember` reads them; adding and removing are **not exposed**.
  ⚠️ The `role` it returns is meaningless — `projectListMember` reports `"Owner"` for every
  member and `projectOverview` reports `"-"`. The API accepts a role on add but never
  persists or enforces one, so every member is equivalent except the single owner.
- **Deleting** is not exposed. It is owner-only, a *soft* delete, and cascades **only**
  deployments — routes, disks, domains, databases, env groups and pull secrets are left
  behind.

## Cluster (a "location")

**Is** a place to run things. Every deployment, disk, database, domain, route and pull
secret names one, by the cluster's `id`.

- **Depended on by:** all of the above.
- **Ready:** always — you only ever list them.
- **Mutable:** not by you. Operator-managed; `clusterList` is the only route.
- ⚠️ **Pass `projectSlug` to `clusterList`.** Without it you get every enabled cluster,
  including ones this project's billing cannot use — and the create then fails with
  `DEPLOYMENT_ACCESS_DENIED` / `DISK_ACCESS_DENIED` / `DATABASE_PROJECT_ACCESS_DENIED`.
- **Carries:** the `cpu` and `memory` lists (resource requests must be exact string members
  of them), `features` (a capability hint, **not** the gate), and `isTrial` (a property of
  the cluster — "accepts trial workloads" — not of the caller's billing).
- ⚠️ **Nothing moves between locations.** Changing where something runs is delete and
  recreate.

## Deployment

**Is** a running workload — the thing that serves your code.

- **Depends on:** a project and a cluster. Optionally an env group, a disk, a pull secret.
- **Depended on by:** routes. ⚠️ **Deleting a deployment silently deletes its routes** — the
  FK cascades, there is no in-use check and no warning.
- **Ready:** `deploymentGet` until `state` is **`running`** (`status` `"success"`).
  `state` **`failed`** is a real outcome, not a placeholder. `paused` and `deleting` are the
  other states you will see.
- **Mutable:** most things, via `deploymentDeploy` — which always requires `project`,
  `location`, `name` **and `image`**, even for a one-field change.
- ⚠️ **Immutable: `type`.** Written at create, never updated. A `WebService` cannot become a
  `Worker` — delete and recreate.
- ⚠️ **Fields that destroy rather than patch:**
  - `env` **when supplied** replaces the whole inline map. Omitting it is safe and keeps
    the stored one; use `addEnv` (upsert) and `removeEnv` (delete) to change single keys.
  - `mountDataSecretPaths` **when omitted** drops every secret-marked file's value. This is
    the one that bites on a patch.
  - `envGroups: []` unlinks every group; absent leaves them alone.
- **Four shapes**, by `type`: `WebService` (HTTP, the only thing a route can target),
  `Worker` (no ingress), `CronJob` (needs `schedule`), `InternalTCPService`
  (cluster-internal; needs a real `port` or it silently gets `0`).
- ⚠️ **`deploymentGet.url` is always populated but does not always resolve.** It is a bare
  hostname with no scheme, and an external ingress exists only for a **non-internal
  WebService**. A Worker, a CronJob, an InternalTCPService or a WebService with
  `internal: true` gets a URL string that serves nothing.
- `internal: true` on a WebService **deletes its external ingress** — the one field that
  silently takes a service off the internet.
- `maxReplica` tops out at **20**.

## Revision

**Is** a numbered snapshot of a deployment's spec. Not something you create — every deploy
makes one.

- **Depends on:** a deployment. No independent existence; deleted with it.
- **Depended on by:** nothing. `deploymentRollback` names one by number.
- **Ready:** no state of its own — the deployment's `state` is the answer. A revision's own
  `status` is historical: `pending`, `deploying`, `deployed`.
- **Mutable:** no. A snapshot; deploying again makes a new one.
- ⚠️ `deploymentRollback` **rewinds** `deployments.revision` to an earlier number. It does
  **not** create a new revision, and does **not** restore env-group links or `type`. A
  partial undo.
- `deploymentLogRevision` lists them, which is how you find a number to roll back to.

## Env group

**Is** a named set of environment variables, shared by any deployment in the project that
lists it. The right home for values several services need.

- **Depends on:** a project.
- **Depended on by:** deployments listing it in `envGroups`. `envgroupDelete` is refused
  with **`ENVGROUP_LINKED`** while any still does; `envgroupGet.linkedDeployments` names
  them.
- **Ready:** immediately. Synchronous.
- **Mutable:** ⚠️ `envgroupUpdate` **replaces the whole map** — any key left out is deleted,
  and omitting `data` empties the group. Read with `envgroupGet`, change, send it all back.
  The **name is immutable** (lowercase, 3–27 chars).
- ⚠️ **Plain text, never masked.** The API says it outright: do not put real secrets in one.
- ⚠️ **Baked at deploy time.** Editing a group does not change a running deployment until it
  is redeployed.

## Disk

**Is** persistent storage, mounted into a deployment at a path. `size` is in **MB**.

- **Depends on:** a project and a cluster. Gated on the **billing account's** disk feature —
  a refusal is `ACCESS_DENIED`.
- **Depended on by:** any number of deployments — a disk is **not exclusive**.
- **Ready:** `diskGet` until `state` is **`ready`** (`status` `"success"`). No failure value
  — a stuck disk sits at `pending` forever and no error ever arrives.
- **Mutable:** `diskUpdate` **grows** it. Shrinking fails `DISK_CANNOT_DECREASE_SIZE`.
  Location and name are fixed.
- ⚠️ **`DISK_IN_USE` does not protect you.** The in-use check reads **only**
  `extraDiskMountData`; a deployment mounting the disk through the primary
  `disk: {name, mountPath, subPath}` field is invisible to it and to
  `diskGet.bindingDeployments`. So `diskDelete` will delete a disk out from under a running
  workload without complaint. **Before deleting a disk, check every deployment's `disk`
  field yourself.**
- If a disk is attached, send both `minReplica` and `maxReplica`. Omitting `maxReplica`
  trips a guard; note the guard does **not** catch a genuine `min=1,max=3` autoscaler, which
  will happily put several pods on one read-write-once volume.

## Managed database (Postgres / Redis / Mongo)

**Is** a provisioned database instance. Its connection details are the point.

- **Depends on:** a project, and a cluster whose `cluster_enabled_features` allow databases
  — a different table from `clusterList`'s `features`, so that can look fine and the create
  still fail with `DATABASE_CLUSTER_NOT_SUPPORTED`.
- **Depended on by:** nothing structurally. See the warning under the graph.
- **Ready:** `db*Get` until `state` is **`running`** *and* `host` is non-empty. `host` and
  `port` are empty strings until then. No failure value — a stuck database sits at
  `pending`.
- **Mutable:** nothing. No resize, no password rotation, and the image is fixed by the
  platform (`postgres:16`, `redis:8`, `mongo:8.2`). Getting it wrong means create another
  and migrate.
- ⚠️ **You supply the password at create**, and `db*Get` returns it in plain text forever.
- **Sizes are required and bounded:** cpu **0.5–4** cores, memory **256–4096** MiB, plus
  `storageSize` in MB.
- ⚠️ **The engines return different fields.** All three give `host, port, password,
  storageSize, cpu, memory`. Postgres adds `user` and `database`; Mongo adds `user` only;
  Redis adds neither.
- ⚠️ **Names collide across engines** — a Postgres called `cache` blocks a Redis called
  `cache` in the same project.

## Pull secret

**Is** registry credentials, so the cluster can pull a private image.

- **Depends on:** a project and a cluster.
- **Depended on by:** deployments naming it in `pullSecret`. Nothing stops you deleting one
  that is still referenced — the next pull just fails.
- **Ready:** `pullsecretGet` — `state` is **`ready`**, same shape as disk.
- **Mutable:** nothing; there is no update route. Rotate by creating another.
- ⚠️ Names are unique per **(project, location)** — the same name can exist twice in one
  project, in different locations. A secret in the wrong location will not be found.
- ⚠️ **Creating one is a user handoff.** `pullsecretCreate` is deliberately not exposed:
  it takes `serverUrl`, `username` and `password`, so calling it would mean live registry
  credentials passing through the conversation. You can list, read and delete them; the user
  creates them in the console. See rule 6.
- ⚠️ `pullsecretGet` returns `username` and `password` **decoded**, so anyone who can read
  the project can read the credentials — and reading one puts them in the transcript. Prefer
  `pullsecretList`, which answers "does it exist" without that.
- **Only private images need one.** Public images pull without any credential, so a
  deployment pulling only public images never needs one. ⚠️ That is a fact about third-party
  images, **not** a suggestion to publish the user's own — see rule 6. Their application
  image is private by default and stays private.

## Domain

**Is** a custom hostname registered to a project. Registering it does **not** route anything
— that is what a route does.

- **Depends on:** a project and a cluster.
- **Depended on by:** routes. Refused with `DOMAIN_IN_USED` while a route in that location
  still needs it, and `DOMAIN_CAN_NOT_DELETE` while it is pending. ⚠️ Deleting a domain that
  does not exist **returns success**.
- **Ready:** `state` is **`ready`**; `status` is `pending`, `success`, `error` or `verify`.
  ⚠️ **`state` `failed` means `status` is `error`, and `error` is a real outcome**, so a
  domain is the one non-deployment resource that can fail. A **non-CDN** domain is written
  `success` at create with an empty `verification`
  object — nothing to verify and nothing to poll. Only `cdn: true` is asynchronous.
- **Mutable:** nothing. Delete and recreate.
- ⚠️ **Domains are globally unique across the whole platform.** `DOMAIN_NOT_AVAILABLE` can
  mean someone else's project already registered it.
- `cdn` defaults to `false`; `cdn: true` is billing-feature-gated and rejected outright for
  a trial account. `wildcard: true` on `example.com` lets routes be made for
  `api.example.com` without registering that separately.
- `domainGet.dnsConfig` carries **one CNAME**; `ipv4` and `ipv6` are always empty. The cname
  value differs by the `cdn` flag — always read it, never write one from memory.

## Route

**Is** the mapping that sends traffic for a domain and path to a deployment. What actually
makes a custom domain serve.

- **Depends on:** a deployment, and normally a registered domain — ⚠️ but
  `skipDomainVerify: true` bypasses the ownership check entirely, so a route can exist for a
  domain nobody registered. It exists for tests; do not set it.
- **Ready:** `routeGet` until `state` is **`ready`**. No failure value.
- **Mutable:** nothing — delete and recreate.
- ⚠️ `target` is a **URI**: `deployment://<name>`. A bare name fails validation.
- ⚠️ Only a `WebService` can be a target — anything else is `CAN_MAP_ONLY_WEB_SERVICE`.
- ⚠️ **`(domain, path)` is globally unique**, not per project.
- `path` must start with `/`. `config.rewritePath` rewrites before proxying, and
  `config.basicAuth` adds HTTP basic auth — returned in plain text by `routeGet`.
- Every deployment already has a hostname without any route; routes and domains are only for
  custom ones.

## Service account (not exposed here)

**Is** a non-expiring credential for programmatic access — what CI should authenticate with,
since user tokens last 7 days. It is a user row with an email of the form
`<slug>@<project>.service-account.nortezh.com`, which is why it can be a project member.

- **Depends on:** a project, and **membership of it**. ⚠️ Without membership every call fails
  with a code that reads like the resource is missing: `PROJECT_NOT_FOUND` on project,
  database, disk, envgroup, route and pullsecret routes; `DEPLOYMENT_PROJECT_ACCESS_DENIED`
  on deployment routes; `CLUSTER_PROJECT_NOT_FOUND` then `FORBIDDEN` on cluster; and on
  domain routes `PROJECT_NOT_FOUND` when the slug does not exist, `FORBIDDEN` when it does
  but the caller is not a member.
- **Depended on by:** nothing in the platform — but any CI using its key breaks when it goes.
- **Ready:** immediately. Synchronous.
- **Mutable:** the account, no. Keys are added and revoked independently, up to 10.
- Keys are created separately from the account and readable in full afterwards, so having an
  account is not having a key.
- **Creating one is a console handoff** — these tools are deliberately not exposed.

## Things that are true everywhere

- **Most names are unique within a project** — but ⚠️ **domains and `(domain, path)` routes
  are globally unique across the platform**, pull secrets are unique per
  (project, location), and database names collide across engines.
- **A domain error is HTTP 200 with `ok:false`.** The MCP layer already converts those into
  tool errors — if a call errors, it really failed.
- **Only deployments and domains can report failure.** Database, disk, route and pull secret
  have no failure value at all — the API models them as `1` pending / `2` success and
  nothing else — so anything stuck sits at `state` `pending` indefinitely and no error will
  ever arrive for it. Bound those waits and report.
- **Nothing moves between projects or locations.** Both mean delete and recreate.
- **Deletes are quieter than you expect.** A deployment takes its routes with it, a project
  delete leaves most of its resources behind, deleting a missing domain succeeds, and
  `DISK_IN_USE` misses the common kind of disk mount.
