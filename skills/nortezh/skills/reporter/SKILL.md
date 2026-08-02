---
name: reporter
description: Report the current state of a Nortezh project — what is running, what is pending, what is failing, what it costs. Use for "how is my project doing", "what is deployed in X", "is anything down", a status summary, or a health check. Read-only; it changes nothing.
---

# Reporting a Nortezh project

Read-only. This creates, changes and deletes nothing. If the report turns up something the
user then wants fixed, that is a separate job with its own approval — load `nortezh:deployer`
and start at its Step 1.

Load `nortezh:resources` first if you have not already. Readiness is the whole substance of a
report, and no two resources report it the same way.

## What to gather

Ask which project first if it is not already clear, and which location if the project spans
more than one. Then read:

- `projectOverview` — the summary counts, so a resource missing from your report is obvious.
- `deploymentList` — every workload and its state.
- `dbPostgresList` / `dbRedisList` / `dbMongoList`, `diskList`, `envgroupList`, `domainList`,
  `routeList` — the rest of the stack.
- `deploymentMetrics` **only** for the deployments the user asked about, over the window they
  asked for. It is per-deployment, so pulling it for everything is slow and mostly unread.

⚠️ **Do not call `dbPostgresGet` / `dbRedisGet` / `dbMongoGet` for a report.** They return the
database password in plain text, and it then lives in the transcript for the rest of the
session. The `*List` calls give you name, engine and host without it.

## Say which check you ran

Flattening every resource into "ok / not ok" invents a fact, because they do not agree on what
those words mean:

Every asynchronous resource answers with `status` (how far the deployer got) and `state`
(what the thing **is**: `running`, `deploying`, `paused`, `deleting`, `ready`, `pending`,
`verifying`, `failed`). **Quote `state`** — it is the word that answers the question.

- **Deployment** — `state` `running`, `paused`, `deploying` or `failed`.
- **Domain** — can report failure too: `state` `failed` (`status` `error`).
- **Database** — `state` `running` once provisioned, `pending` until then.
- **Disk, route, pull secret** — `state` `ready` or `pending`; nothing in them runs.
- **Database, disk, route, pull secret** — those two words are all there is, **no failure
  value at all**. One sitting at `pending` is *pending*, not failed, and no error will ever
  arrive for it. Report it as still pending — never as failed, never as fine.
- **Project, env group** — synchronous. If the call returned, it exists.

⚠️ **A deployment's `url` is always populated and does not always resolve.** It is a bare
hostname with no scheme, and an external ingress exists only for a **non-internal
WebService**. A `Worker`, a `CronJob`, an `InternalTCPService`, or a WebService with
`internal: true` has a URL string that serves nothing. Never print one as if the user could
open it — say what the workload is instead.

## Rules for the report itself

- **Every claim comes from a call you made in this session** — not from the resource model,
  and not from what was deployed last time you looked.
- **No secret values.** Key names, mount paths, and the word "set" — never a password, a
  token, or the contents of an env group. Env group values are stored in plain text, which
  makes them easy to leak and no less damaging when leaked.
- **Anything you did not check is listed as not checked**, rather than omitted. A silent
  omission reads as "nothing there".
- Fenced blocks and chips, **no pipe tables** — this is read in a terminal, where a table
  wider than the pane wraps into noise.

```
🟢 healthy   🟡 pending   ❌ failed   ⏸ paused   ⚪ not checked
```

## The report template

# \<project\> — state as of now

\<n\> deployments · \<n\> databases · \<n\> disks · \<n\> domains · \<n\> routes

## Deployments

```
  🟢 api · WebService · running · api.acme.com
  ⏸ worker · Worker · paused · no external URL by design
  ❌ cron-nightly · CronJob · failed · see nortezh:troubleshooter
```

## Databases

```
  🟢 orders-db · postgres · running · db-orders.rcf2:5432
  🟡 cache · redis · pending · still provisioning; no failure state exists
```

## Disks, config, domains, routes

```
  🟢 uploads · 20 GB · ready · mounted on api at /data
  🟢 acme-shared · env group · 4 keys · values not shown
  🟢 api.acme.com/ · route · ready · to api
```

## Not checked

- \<anything skipped, and why\>

## What looks wrong

- \<each problem, the check that showed it, and the one next action\>

### End of the report template
