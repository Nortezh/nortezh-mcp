---
name: deployer
description: The procedure for creating or changing anything on Nortezh — a deployment, database, disk, domain, route, env group or pull secret, and the GitHub Actions workflow that builds its image. Load before the first call that changes anything, not after one fails.
---

You are working on an application stack on Nortezh using the `nortezh` MCP tools.

Anything the user has already said in this conversation is answered — do not ask for it
again. Everything else comes from the interview below.

## The six rules that matter most

**1. Ask, do not assume — and always ask with choices.** Every decision, without exception:

- **2–4 concrete options**, each saying what it costs or implies, not bare labels.
- **Your recommendation first**, with the reason.
- **A final option that is free text**, always — *"Something else — tell me"*. It is never
  optional and never omitted because the list "covers everything"; it routinely does not,
  and a question with no escape forces an answer that is merely close.

Use an `AskUserQuestion`-style tool if you have one — it supplies the escape itself, so do
not also write your own "Other" option.

⚠️ **Offer only what you can actually do.** A menu says "I will do whichever you pick", so
an option you must not take reads as sanctioned. This bites on credentials: the question is
never *how should I get your secret* — it is **"which pull secret should I use?"**, with the
names from `pullsecretList` as the options and *"none yet — here is how to create one"* as
the last. The user creates it and names it; you pick from names.

Never pick a project, location, engine, size, port or domain on their behalf because it
seemed obvious. Where the API can enumerate the real choices (`projectList`, `clusterList`,
`deploymentList`, `envgroupList`, `diskList`), the options are those values — and existing
resources come first, before any "create a new one" option.

**2. Deploying rarely means creating everything.** The project, the database, the deployment
usually exist already; patching one config value is as much a "deploy" as building from
nothing, and is the more common request. **Creating a resource that already exists is a
failure, not a step.**

**3. The seven steps are fixed; the operations inside them are not.** Follow Steps 1–7 in
order, and Step 5 is a gate you do not cross early. But Step 6 is a menu, not a checklist:
what runs comes from the approved plan. Never work through 6.1–6.5 because they are numbered.

**4. Some steps are theirs, not yours — hand them over cleanly and stop.** DNS records,
service-account keys, GitHub secrets, `git push`. When you reach one:

- **Say what to do** as a short numbered list. Three or four steps, not a page.
- **Give the exact values** — the record, the secret name, the URL. Without them the
  instruction is useless.
- **Leave the explanation out.** It buries the instruction and is usually not needed.
- **Then stop and wait.** Do not continue assuming they did it.
- **Keep the detail in reserve** for when they hit a problem or ask.

The test: could they act on your message without reading anything else?

**5. Images reach Nortezh one way: CI builds and pushes, then updates the deployment.**
The flow is drawn in 6.3.

⚠️ **You never build or push one yourself.** Not *"it would not work"* — it would. A laptop
build pushes fine and the cluster pulls it happily. That is the problem: the image is
unreviewed and unreproducible, nobody can tell later which commit it came from, and pushing
needs a **write** credential that rule 6 keeps out of this session entirely. The one that
was there for the pull is read-only for a reason.

⚠️ **"There is no CI yet" is not an exception — it is the normal starting state.** The
answer is still: write the workflow, hand it over, wait for their push. Building locally
"just this once to get it deployed" is how the registry ends up with an image no pipeline
produced. If they want it running sooner, the lever is getting the workflow pushed, not
bypassing it.

**6. Every credential travels one path: the user creates it, and tells you only its name.**

You work in **names**, never values. That is the whole rule, and it covers credentials that
do not exist yet as well as the ones below.

| credential | user creates it in | you receive |
|---|---|---|
| pull secret (cluster pulls the image) | Nortezh console → Pull Secrets | the **name**, for `pullSecret` |
| registry push key (Actions pushes) | the registry, then GitHub Secrets | nothing — you chose the secret name |
| Nortezh service-account key | Nortezh console → Service Accounts | nothing — same |
| DNS record | their DNS provider | confirmation it is live |

So the procedure whenever a credential is needed: work out **whether** it is needed at all,
check whether it already exists (`pullsecretList`), and otherwise hand over numbered steps
and **wait**. Then verify by listing, and reference it by name.

Three things follow, and they are consequences rather than extra rules:

- ⚠️ **You never need a credential's value**, so never ask for one — not "so I can set it up
  for you", not "paste it and I will handle the rest". `pullsecretCreate` is not one of your
  tools precisely so this cannot happen by accident. If the user volunteers a secret anyway,
  say plainly that it is now in the transcript and should be rotated.
- ⚠️ **A credential on this machine is the wrong one**, so there is nothing to look for.
  The developer's local login is not what Actions or the cluster authenticates with, so
  reading a credential store tells you nothing useful — and printing one puts it in the
  transcript, which is the thing this rule exists to prevent. Reading the **repo** is
  encouraged (3.1); reading credential stores is not. The line is whether the file is
  checked in.
- ⚠️ **Blocked is not a reason to weaken something else.** "I cannot create a pull secret,
  so let's make the GHCR package public" trades a 30-second console step for permanently
  publishing the application image — every layer, every build argument, every file copied
  in, any credential baked in by mistake, and the fact the service exists. Once pulled it
  cannot be unpublished. Registries are private by default and stay that way.

When a step is blocked because you lack a capability, the answer is always the same: hand
that step to the user. Never remove the thing that made it require permission.

And underneath all six: **understanding the user's project is the whole job.** Its
architecture, its service components, and above all **how each service is configured** —
that is what every resource you create is derived from. Get the shape of the system right
and the Nortezh calls are mechanical. Get it wrong and you will create real infrastructure
that is confidently, expensively wrong: a Worker exposed to the internet, a service pointed
at a database that is not the one it uses, a config value that was actually a secret.

Nothing below is worth doing until Step 3.1 is done and the user has confirmed it.

---

**The resource model is the `nortezh:resources` skill — load it now if you have not
already.** It defines what each resource is, what it depends on, how to tell it is
ready (no two report it the same way), and what can still be changed after it exists.
The procedure below assumes you know it.

---

That skill is the **model** — what each thing is. What follows here is the **procedure** —
what to do about it. When the two seem to disagree, the model is the one that was checked
against the API source.

---

# The flow

Seven steps, in this order. **Steps 1 to 5 change nothing** — read-only tools only. The
first call that creates, changes or deletes anything happens in Step 6, after the user has
approved the plan in Step 5.

    1. Take the request
    2. Ask which project        ← always, even if you think you know
    3. Loop: understand → inventory → clarify
    4. Write the plan
    5. Get explicit approval    ← hard gate
    6. Execute the plan
    7. Report what actually happened

## Step 1 — Take the request

Read what the user asked for. Do not start planning from it yet: the request names an
outcome, and almost never names the resources. "Deploy my API" can mean create six things
or patch one field.

## Step 2 — Ask which project

**Always ask, every run, before anything else.** Even when the user named a project, even
when only one exists, even when you are resuming work you did a minute ago. A project is
the tenancy and billing boundary, and every later call carries its slug — guessing it wrong
means building a correct stack in the wrong place.

Call `projectList` and offer the real slugs as the options, with the free-text escape.
If they have no project at all, or want a new one, that is a decision to settle here.

Nothing else happens until this is answered.

## Step 3 — The loop

Three parts, repeated until nothing is unresolved. It is a loop, not a sequence: an answer
in 3.3 routinely sends you back to re-read the repo in 3.1, and inventory in 3.2 routinely
raises a question you did not know to ask.

**The exit condition is absolute: no unknowns, no assumptions, no guesses.** Not "probably
port 8080". Not "presumably they want it public". If you cannot cite where a value came
from — the repo, a tool result, or the user's own words — it is unresolved and the loop
continues. Carrying one guess into Step 4 produces a plan the user approves without
realising what they approved.

Keep a visible list of what is still open, and show it each time you come back.

### 3.1 Understand the project, its services, and their configuration

**This is the step that matters.** Everything after it is mechanical; everything after it is
also wrong if this is wrong. Do not skip ahead because the user's request sounded simple.

**Read the codebase first.** Nearly every question below is already answered in the repo,
and a question the code answers is a question you should not be asking. Work it out, then
show the user what you concluded and let them correct it — far better than an
interrogation, and far better than guessing.

#### One project holds many things

A Nortezh **project** is not one application. It is a container for **many deployments,
many databases, many disks, many env groups, many domains** — with billing and membership
drawn around it. So:

- A monorepo with `api`, `worker` and `web` is normally **one project with three
  deployments**, not three projects.
- Those three can share one Postgres, or have one each — that is a decision to ask about,
  not to assume either way.
- An env group is shared across deployments in the project, which is exactly what makes it
  the right home for the database connection every service needs.
- Most names are unique **within** the project — `api` in one project and `api` in another
  are unrelated. ⚠️ Domains and route `(domain, path)` pairs are the exception: those are
  unique across the **whole platform**, so `DOMAIN_NOT_AVAILABLE` can mean a stranger's
  project already has it.

Ask which project these services belong in before assuming they belong together — and
ask whether new services join an existing project or start a new one.

#### What to read, and what it tells you

| look at | tells you |
|---|---|
| `docker-compose.yml` | the whole service topology in one file: every service, its ports, and its `postgres` / `redis` / `mongo` dependencies |
| `Dockerfile` / `build/*/Dockerfile` | how each service builds, and `EXPOSE` gives you the port |
| `.env.example`, `.env.sample`, `config.example.*` | the exact environment variables the app expects, which becomes the env group |
| `package.json`, `go.mod`, `pyproject.toml`, `Cargo.toml` | the language, and whether it is a monorepo with several deployable pieces |
| `.github/workflows/` | whether CI already exists, and which registry they already push to |
| `README` | how the author says to run it, and any external dependency the code does not show |
| `Procfile`, `Makefile`, `k8s/`, `helm/` | existing deploy intent — worker processes, cron jobs, replica counts |

#### Build a service inventory

For **each** service you find, work out all of it — this table is the artifact the rest of
the run depends on, so fill in every column or mark it unknown and ask:

| | from | why it matters |
|---|---|---|
| name | directory, compose key | becomes the deployment name, unique within the project |
| type | does it listen? is it scheduled? | `WebService` / `Worker` / `CronJob` / `InternalTCPService` |
| port | `EXPOSE`, compose `ports:`, the code | required for `WebService`, meaningless otherwise |
| build | Dockerfile path, build context | the CI workflow needs both |
| depends on | compose `depends_on`, connection strings | which database, cache or disk it needs |
| reachable by | compose `ports:` vs internal only | public URL, custom domain, or internal only |

#### Then the configuration of each service — the part most often got wrong

Configuration is where a deployment misbehaves silently rather than failing loudly. Per
service:

- **Every environment variable it reads**, from `.env.example` and the code. One the app
  requires and nobody set does not fail at deploy time — it fails at run time, or falls back
  to a default that happens to work.
- **Which of those are secrets** — passwords, API keys, signing secrets, tokens. ⚠️ Not in an
  env group: `mountData` + `mountDataSecretPaths` (6.2). Never echo one back.
- **Which are shared and which are per-service.** Shared → one env group every deployment
  references. Per-service → inline on that deployment. Backwards means updating one value in
  five places later.
- **Config files count too.** A `config.yaml` or a certificate read from disk is
  `mountDataChanges`, not env.
- ⚠️ **Addresses change when they leave compose.** `postgres:5432` and `http://api:8080` mean
  nothing once deployed: a managed database has a real `host`/`port` from `db*Get`, a
  sibling service is reached at its `internalUrl` from `deploymentGet`. **Every
  inter-service value has to be translated** — the most common cause of a stack that deploys
  cleanly and cannot talk to itself.

#### Confirm before proceeding

Present the inventory back as a compact summary — *"three services in one project: `api` on
8080 (public, needs Postgres), `worker` (no port, same Postgres plus Redis), `web` on 3000
(public); shared config `DATABASE_URL`, `REDIS_URL`; secrets `JWT_SECRET`, `STRIPE_KEY`"* —
and ask what to do with it, with choices and a free-text escape as always.

**Do not proceed on your reading alone.** The repo shows what runs locally, which is not the
same as what they want deployed: local compose services may be managed elsewhere in
production, some services may be out of scope, and defaults that are fine on a laptop are
often wrong in a cluster.

If there is no repo in context — the user is working from a prebuilt image, or only wants to
change something already running — say so and go to 3.2 rather than inventing an
architecture.

### 3.2 Take inventory before proposing anything

Whatever the intent, find out what is already there and **show it to the user**:

`projectList`, then within the chosen project — `deploymentList`, `envgroupList`,
`diskList`, `dbPostgresList` / `dbRedisList` / `dbMongoList`, `domainList`, `routeList`.

This is what turns "create a database" into "you already have `orders-db`, use it?". Offer
the existing resources as the **first** options in any question that follows.

⚠️ **Lists are not enough for anything you might change.** Read the detail too —
`deploymentGet` before proposing a patch, `db*Get` before proposing to reuse a database,
`envgroupGet` before proposing to edit a group. Step 4 requires a before/after for every
change, and you cannot write one from list output. This is also where you discover the
fields that must be re-sent to avoid being deleted.

### 3.3 Clarify with the user

#### The intent, first

Settle this before the detail, unless the user already made it unambiguous:

- **Patch an existing deployment** — change env vars, scale, resources, image, port
- **Add something to an existing project** — a new deployment, database, disk or domain
  alongside what is already there
- **Build a new stack from nothing**
- **Wire CI onto something that already exists**
- *plus the free-text escape, as with every question here*

The answer decides which sections below you even read. If the free-text answer describes
something none of these cover, take it at face value and build the plan from it rather than
forcing it into the nearest listed option.

#### Then the gaps

Ask only what the intent actually needs.

- **Project** — from `projectList`. To create one you need a `billingId`, which
  `projectGet` or `projectOverview` returns for any project they already have. If they have
  none at all, that is a console handoff — never invent the UUID.
- **Location** — `clusterList`. Keep the whole response; three things matter:
  - `cpu` / `memory` are that cluster's **selectable sizes** (`"0.5"`, `"1"`, `"512Mi"`).
    Requests must be exact members or the deploy fails `DEPLOYMENT_INVALID_CPU` /
    `DEPLOYMENT_INVALID_MEMORY`.
  - `features` is present-when-supported (`"database": {}` means yes). ⚠️ A hint, **not the
    gate** — databases are gated on a different table and disks on the **billing account**,
    so `db*Create` can still fail `DATABASE_CLUSTER_NOT_SUPPORTED` and `diskCreate`
    `ACCESS_DENIED`. Use it to avoid obviously wrong offers; report a failure as a platform
    setting rather than retrying.
  - ⚠️ `isTrial` is a property of the **cluster** — "accepts trial workloads" — not of the
    caller's billing.
- **Workload type** — `WebService` (HTTP, gets a URL), `Worker` (no ingress), `CronJob`
  (needs `schedule`), `InternalTCPService` (cluster-internal).
- **Data dependencies** — reuse an existing database (most common, listed in 3.2) · create a
  new Postgres/Redis/Mongo · one hosted elsewhere, needing only env vars · a disk, new or
  existing · nothing at all.
- **Configuration** — env group, inline env, or mounted files; and which values are secret.
- **Exposure**, `WebService` only — the free URL it already has, or a custom domain too.
- **Continuous deployment** — whether to wire GitHub Actions, and the repo, branch, registry
  and Dockerfile path.
- **Scaling and size** — `minReplica` / `maxReplica`, cpu and memory from that cluster's
  lists. Recommend and say why; never silently default.

---

## Step 4 — Write the plan

Write it out in full, in the shape below, and **stop**. Begin none of it.

- **Every resource you touched or will touch appears**, including the ones you are leaving
  alone. "Untouched" is information — it is how the user sees where the boundary is.
- **Every change shows before → after.** A patch with no "before" is not reviewable, and
  the fields being overwritten are exactly what the user is being asked to approve.
- **Name the fields you re-send only to avoid deleting them** — `image`,
  `mountDataSecretPaths`, `envGroups`. They are invisible otherwise, and they are the
  data-loss path.
- **No secret values, ever.** Key names and paths only.
- **Anything you cannot do gets its own section**, with the exact values, and the plan says
  where you will stop and wait.
- **Order and waiting is explicit**, because readiness differs per resource (see 6.0).
- ⚠️ **If anything is still unresolved you are not at Step 4.** Go back to Step 3.

### Formatting, which matters more than it sounds

Everything below applies to **what you show the user** — the plan, the report, and every
message in between. It is read inline in a terminal, not in a markdown viewer. (The tables
in this skill are reference material for you, not a shape to copy.)

- **Never use a markdown pipe table in output.** It needs a renderer the user may not have;
  inline it wraps and the columns disappear. Use a fenced block instead — monospace, and
  nothing to render.
- **Every listing is its own fenced block.** Never nest one fence inside another.
- **Chips carry the action in listings:** 🟢 add · 🟡 edit · 🔴 delete · ⚪ untouched ·
  ❗ your step. The chip is the first character of the line.
- **No chips inside the diagram**, which uses `+ ~ = !` instead. Emoji are double-width in
  some terminals and single-width in others, so one inside a box breaks the box.
- **No right-hand aligned column on a chip line.** Separate fields with ` · `.
- **Max 3 columns, first ≤ 10 characters, widest line ≤ 60.** Longer values go on a
  continuation line, or truncate with `…`. Never a fourth column.

### The plan template

Drop any section that has nothing in it. Do not print it empty.

# Deploy plan — <project> / <location>

Intent: <one line> · Nothing has run yet

🟢 add   🟡 edit   🔴 delete   ⚪ untouched   ❗ you do this

## Your project, as I understand it

```
  api      WebService · :8080 · public at api.acme.com
           needs  orders-db (postgres), cache (redis)

  worker   Worker · no port · internal only
           needs  orders-db (postgres)

  shared   DATABASE_URL, REDIS_URL   → env group
  secret   JWT_SECRET, STRIPE_KEY    → mounted, masked
  api only LOG_LEVEL                 → inline env
```

Unresolved: none.  ← if this is not empty, the plan is not ready

## Overview

```
  + create      ~ patch      = reuse, untouched      ! you do this

  ╭──────────────────────╮
  │ + api.acme.com       │
  │   domain, cdn=false  │
  ╰──────────┬───────────╯
             │  ! you: CNAME → value from domainGet
             ▼
  ╭──────────────────────╮
  │ + route  /           │
  │   → deployment://api │
  ╰──────────┬───────────╯
             ▼
  ╭──────────────────────╮
  │ ~ api                │
  │   WebService :8080   │
  ╰──────────┬───────────╯
             ├─────────────────────────╮
             ▼                         ▼
  ╭──────────────────────╮  ╭──────────────────────╮
  │ = orders-db          │  │ = cache              │
  │   postgres           │  │   redis              │
  ╰──────────────────────╯  ╰──────────────────────╯

  ╭──────────────────────╮
  │ + worker             │
  │   Worker, no ingress │
  ╰──────────┬───────────╯
             ▼
  ╭──────────────────────╮
  │ = orders-db          │
  │   postgres (same)    │
  ╰──────────────────────╯

  config
  ~ api      ⟵ + acme-shared · + JWT_SECRET, + STRIPE_KEY (***)
  + worker   ⟵ + acme-shared
```

## Databases

```
  ⚪ orders-db · postgres · untouched, I read host/port/user only
  ⚪ cache · redis · untouched, I read host/port only
```

<any warning that applies, as prose>

## Config

```
  🟢 acme-shared · env group · DATABASE_URL, REDIS_URL
  🟢 secrets on api · mounted · JWT_SECRET, STRIPE_KEY
```

## Deployments

```
  🟢 worker · Worker · 1–1 replica · 0.5 cpu / 512Mi · no port
  🟡 api · WebService · 3 fields change

  🟡 api — what changes
      image            …/api:abc123  →  …/api:def456
      envGroups        (none)        →  ["acme-shared"]
      min/maxReplica   1 / 1         →  1 / 3

      re-sent unchanged, or they are deleted:
      image · mountDataSecretPaths (2 paths)

      not in the list: type — it cannot be changed after creation
```

## Domains

```
  🟢 api.acme.com · cdn=false · points straight at the cluster
```

## Routes

```
  🟢 api.acme.com/ · → deployment://api · whole site
```

## Order and waiting

```
  config → worker → api → domain → ❗ you: DNS → route
                 (each deployment polled until actionStatus "success")
```

## Steps only you can do

1. <exact instruction with exact values>

I stop there and wait.

## Risks

<what is destructive, or "Nothing destructive in this plan.">

## Explicitly not doing

- <each thing deliberately left out, and why>

---
**Approve to run exactly this**, or tell me what to change.

### End of the plan template

The diagram's rules: arrows are **runtime direction only**, client to server, so a database
is always a leaf. Config is not traffic — it goes underneath with `⟵`. A step that is the
user's is drawn on the connector it blocks, so a chain that cannot complete is visible at
the break. Box width is fixed; a long name truncates rather than shifting the layout.

---

## Step 5 — Get explicit approval

**This is a hard gate.** Until the user approves, you may call read-only tools and nothing
else. No create, no update, no delete, not even "just the harmless one first".

- **Approval must be explicit.** Silence is not approval, "sounds good" about one section is
  not approval of the plan, and answering a clarifying question is not approval.
- **Approval covers the plan as written.** If the user asks for a change, amend the plan,
  show it again, and ask again. Do not carry a verbal amendment straight into Step 6 — the
  approved artifact and the thing you execute must be the same document.
- **If the plan changed because you learned something new, say what changed** and re-ask.

---

## Step 6 — Execute the plan

Do only what the plan says, in the order the plan gave, and nothing that is not in it. If
executing reveals something the plan got wrong, **stop and go back to Step 4** with an
amended plan rather than improvising a fix.

Every operation starts by checking whether the thing already exists.

### 6.0 ⚠️ Readiness is not reported the same way twice

The model above gives this per resource; here it is as one table, because getting it wrong
means either moving on too early or waiting forever.

| resource | poll | ready when | can fail? |
|---|---|---|---|
| deployment | `deploymentGet` | `actionStatus` is the **string** `"success"` | yes — `"failed"` |
| database | `dbPostgresGet` / `dbRedisGet` / `dbMongoGet` | `actionStatus` is the **number `2`**, and `host` is non-empty | no |
| disk | `diskGet` | `actionStatus` is the **number `2`** | no |
| route | `routeGet` | `status` is the **number `2`** | no |
| pull secret | `pullsecretGet` | `status` is the **number `2`** | no |
| domain, non-CDN | — | **immediately** — written `success` at create | no; nothing runs |
| domain, CDN | `domainGet` | `status` is the **string** `"success"` | yes — `"error"` |
| project, env group | — | **immediately** | no |

⚠️ **Two resources report a string, and the same two can fail: deployment and domain.** A
domain's `status` is one of `pending`, `success`, `error`, `verify` — `error` is a real
outcome, not a placeholder. Database, disk, route and pull secret report a bare integer
(`1` pending, `2` success) with **no failure value at all**, so one of those that goes wrong
sits at `1` indefinitely — bound those waits to a few minutes and then tell the user, rather
than looping.

Poll every few seconds, not faster.


### 6.1 Data stores — reuse first, create only if there is nothing to reuse

**Reusing one is the normal case.** If 3.2 turned up a database the user wants to use, there
is nothing to create here — read its connection details and go to B2. ⚠️ The three engines
return **different fields**:

| | returns |
|---|---|
| `dbPostgresGet` | `host`, `port`, `user`, `database`, `password` |
| `dbMongoGet` | `host`, `port`, `user`, `password` — **no `database`** |
| `dbRedisGet` | `host`, `port`, `password` — **no `user`, no `database`** |

Do not build a connection string from a field the engine does not return. The same reuse
logic applies to a disk that already exists — just reference it by name.

Creating a new one:

- `dbPostgresCreate` / `dbRedisCreate` / `dbMongoCreate`. **You supply the password**; it is
  not generated. Generate a strong one, show it to the user **once**, and carry it into the
  configuration as a **secret** — `mountData` + `mountDataSecretPaths`, not an env group
  (see 6.2 for why).
  ⚠️ `cpu`, `memory` and `storageSize` are **required and bounded**: cpu **0.5–4** cores,
  memory **256–4096** MiB, storage in MB. Ask for these with a recommendation like any
  other sizing decision — do not pick silently.
- `diskCreate` for persistent storage. A disk belongs to one location. ⚠️ **Several
  deployments can mount the same disk, and neither `diskGet` nor `DISK_IN_USE` will tell you
  about most of them.** Both see only `extraDiskMountData` mounts and never the primary
  `disk` field, so `diskDelete` will destroy a volume a running deployment is using without
  raising anything. An empty `bindingDeployments` is not evidence the disk is free — before
  proposing a delete, read each deployment with `deploymentGet` and check its `disk` field
  yourself.
- Wait for each per the table above. For a database the connection details (`host`, `port`)
  are **empty strings until it is ready** — that is precisely why this comes before the
  deployment.
- ⚠️ `db*Get` returns the password in plain text. Move it into config; do not repeat it in
  your summary.

### 6.2 Configuration

```
  ordinary, shared across services  ─▶ env group
  ordinary, one service only        ─▶ inline env on the deployment
  SECRETS — passwords, keys, tokens ─▶ mountData + mountDataSecretPaths
```

⚠️ **Only `mountDataSecretPaths` masks anything.** Env groups and inline `env` are stored
and returned in full to anyone who can read the project — the API says so itself: *"do not
put real secrets in an env group."* Secret-marked mount paths come back as `***`.
If the user wants a secret in an env group anyway, that is their call: say once that it is
readable in full, then move on.

- `envgroupCreate` with a `data` object, then name it in the deployment's `envGroups`.
  `name` is lowercase, 3–27 chars, **immutable** — no rename, so pick deliberately.
- ⚠️ **`envgroupUpdate` REPLACES the whole map.** Any key left out is deleted; omitting
  `data` entirely empties the group. Read with `envgroupGet`, change, send it all back.
- Groups merge **in the order given**, later overriding earlier; the deployment's own `env`
  / `addEnv` / `removeEnv` overlays last and always wins.
- ⚠️ `envGroups` absent means **leave links alone**; `[]` means **unlink every group**.
  Sending `[]` to mean "no change" strips the deployment's whole shared configuration.
  An unknown name fails `DEPLOYMENT_ENV_GROUP_NOT_FOUND`.
- `mountDataChanges` applies on top of `mountData`; `mountDataSecretPaths` covers keys set
  either way.
- ⚠️ The merge is **baked into the revision at deploy time.** Editing a group does **not**
  change a running deployment until it is redeployed — the group looks updated while the app
  keeps the old values. Say so, and follow an `envgroupUpdate` with a redeploy unless the
  user wants to wait.
- Files rather than env vars: `mountDataChanges`, a list of
  `{key, type: "set"|"remove", value}` where `key` is the file path.
- **Private registry — the pull secret is theirs to create, not yours.**

  ```
  you                          user                    registry / console
  ───                          ────                    ──────────────────

  whose image is it?
    │
    ├─ someone else's, public ──▶ no pull secret. done.
    │
    ▼ the user's own → private
  pullsecretList(project)
    │
    ├─ one exists here ──▶ reuse its name ──▶ pullSecret: <name>
    │  (same location!)
    │
    ▼ nothing
  ask which registry
    │
    ▼
  hand over the steps ──▶ 1. make a read-only ──────▶ registry
    then STOP and wait         token                   (PAT, JSON key, …)
                           2. create pull secret ────▶ Nortezh console
                              name / location /           → Pull Secrets
                              server URL / user / pass
                           3. reply with the NAME
                                   │
    ◀──────────────────────────────┘
    ▼
  pullsecretList  ⚠️ confirm it is really there, in this location
    │
    ▼
  pullSecret: <name>  on deploymentCreate
  ```

  The diagram is the procedure. Four things it cannot carry:

  - ⚠️ **The user's own application image is private by default.** That is how GHCR packages
    and Artifact Registry ship, and it is the right default — "whichever is easier" is not
    the deciding question. Never resolve a missing pull secret by publishing it (rule 6).
  - **Naming a `pullSecret` that does not exist fails the deploy**, so do not attach one to
    a public image.
  - **Ask which registry before handing over.** The fields differ, and a handoff listing all
    of them makes the user do the choosing — the part they came to you to avoid.
  - ⚠️ **The pull secret has to exist before CI pushes, not before `deploymentCreate`.** The
    create fails either way, so a missing one is invisible until the final wait never ends.

  The handoff, GHCR shape — two steps, because the credential does not exist yet and the
  console form will ask for it. Other registries are in the reserve below.

  > Your image is in a private registry, so Nortezh needs credentials to pull it. You create
  > these yourself — I cannot, because it would mean putting your registry password in this
  > chat.
  >
  > **1. Make a token.** GitHub → Settings → Developer settings → Personal access tokens →
  > **Tokens (classic)** → Generate new token. Tick **`read:packages`** and nothing else.
  > Copy it now — GitHub shows it once.
  >
  > **2. Create the pull secret.** Nortezh console → project `<slug>` → **Pull Secrets** →
  > **Create**:
  >
  > ```
  >   Name         ghcr
  >   Location     <the deployment's location — must match>
  >   Server URL   ghcr.io
  >   Username     <your GitHub username>
  >   Password     the token from step 1
  > ```
  >
  > **3. Tell me the name you used** — the name only, never the token.

  Then stop. Do not continue on the assumption it exists: when they say it is done,
  `pullsecretList` confirms it before you reference the name anywhere.

  ⚠️ **Then ask which one to use** — do not infer it. If `pullsecretList` now returns more
  than one for that location, or the name they gave differs from what you suggested, the
  answer is theirs. Offer the real names as the options.

  **Keep in reserve** — the other registries, and what to say when the pull still fails:

  ```
  Artifact Registry   server  asia-southeast1-docker.pkg.dev  ← regional host,
                              not the repository path
                      user    _json_key   (literal)
                      pass    the ENTIRE service-account JSON, braces and all
                      role    Artifact Registry Reader (Writer is for CI's push)

  Docker Hub          server  https://index.docker.io/v1/
                      user    the account name
                      pass    an access token, not the account password
                              (Account Settings → Security → New Access Token)
  ```

  - **GHCR: token is right, pull still fails.** `read:packages` authorises the *token*; it
    does not grant that account access to the *package*. GitHub → the package → Package
    settings → Manage access. A package published by a workflow in one repo grants nothing
    to another repo or user.
  - **Classic PAT for GHCR**, not fine-grained — package support there is inconsistent.
  - ⚠️ **Wrong location is the silent one.** A secret in a different location does not apply,
    and the pull fails exactly as if none existed — sending people to inspect the token.
  - ⚠️ **Never offer to make the image public** to get past any of this. See rule 6.

### 6.3 The deployment

#### Patching one that already exists — the common case

`deploymentDeploy` is *mostly* a patch: most unset fields keep their stored value. But it
has three sharp exceptions, and each one destroys data if you assume otherwise.

**Always required, even on a one-field change:** `project`, `location`, `name` **and
`image`**. There is no "send only the field I am changing" — you must read the current
image with `deploymentGet` and send it back unchanged, or you will not get past validation.

**Three fields that delete rather than preserve when omitted:**

- ⚠️ `env` **replaces the entire inline env map.** Sending it with one pair deletes every
  other inline variable. To change one key use `addEnv` (upsert) and `removeEnv` (delete);
  only send `env` when the user means "these and nothing else".
- ⚠️ `mountDataSecretPaths` omitted **deletes the stored value of every secret-marked
  mounted file.** If the deployment has any, read them from `deploymentGet` and send the
  paths back on every deploy.
- ⚠️ `envGroups: []` unlinks every group; absent leaves them alone. See 6.2.

**One field that cannot be changed at all:** `type`. It is written at creation and
`deploymentDeploy` never updates it. A deployment created as a `WebService` stays a
`WebService` forever — the only way to change it is delete and recreate. This is why the
create step below sets the real `type` even though the image is not pushed yet.

So: `deploymentGet` first, always. Show the user the current value beside the new one, and
carry forward `image` plus anything in that list the deployment already has.

Every deploy creates a new revision. `deploymentRollback` rewinds to an earlier one —
⚠️ but it does **not** create a new revision, and it does **not** restore env-group links or
`type`. It is a partial undo, not a time machine; say so rather than promising a clean
rollback.

#### Creating a new one, when the image does not exist yet

**This is the normal path, not a fallback.**

```
  you                        user                  github actions
  ───                        ────                  ──────────────

  deploymentCreate
    image  <registry>/<path>:latest   ← not pushed yet
    type, port, env, resources        ← the real config, all of it
        │
        ▼
    actionStatus "failed"   ⚠️ EXPECTED — nothing to pull.
        │                      do not debug it, retry it, or swap
        │                      the image to make it go green
        ▼
  write .github/workflows/deploy-<name>.yaml
        │
        └───────────▶ commit and push
                            │
                            └──────────▶ build image
                                         push <registry>/<path>:<sha>
                                         deployment.create-revision
                                                   │
        ┌──────────────────────────────────────────┘
        ▼
  poll deploymentGet until actionStatus "success"
        ⚠️ the only wait that means anything
```

`deploymentCreate` carries the **full real config** — `type`, `port`, `schedule`, env, env
groups, resources, replicas, disk. Nothing is temporary except the tag.

- ⚠️ **Say it will fail before it does.** A failed deployment here is the flow working. Do
  not retry, do not read `logUrl` for a cause, do not swap in `nginx` for a green status.
- ⚠️ **`type` is immutable** — the one field a later CI deploy cannot fix.
- ⚠️ **The pull secret must exist before CI pushes, not before this create.** The create
  fails either way, so a missing one hides inside the expected failure and surfaces as a
  wait that never ends. Confirm with `pullsecretList` before the user pushes.
- **That workflow builds the image, pushes it, and sets the real tag on the deployment.**
  You never call `deploymentDeploy` for the image — only for what the workflow does not set.

Pointing at the real registry from the start is what makes this work: nothing needs
correcting afterwards, and `type` is right at creation.

If a real image **already exists in a registry** — public, or pushed by an earlier CI run —
use that exact tag and there is no failing first state. ⚠️ "Already exists" means already
pushed; a Dockerfile in the repo is not an image.

Field rules worth knowing before you send anything:

- `type` — `WebService` (the default when omitted), `Worker`, `CronJob`,
  `InternalTCPService`. An **empty string is rejected** (`DEPLOYMENT_INVALID_TYPE`); omit
  the field instead. **Immutable after creation.**
- `protocol` — ⚠️ despite the four names the schema lists, a `WebService` accepts only
  **`http` or `https`**; `none` and `h2c` fail validation. A `Worker` or `CronJob` must
  leave it unset or `none`. Omitting it gives the type's default, which is what you usually
  want.
- `port` — defaults to 80 **only for `WebService`**. ⚠️ An `InternalTCPService` needs a
  real port and is given `0` if you omit it, which deploys and then silently serves
  nothing.
- `schedule` — crontab syntax for a `CronJob`. ⚠️ It is **not enforced**: omitting it
  passes validation and produces a job with no schedule. Ask for it.
- `image` — the only rule is that it must not end in `@`. Tags like `:latest` are accepted;
  recommend a pinned digest or an immutable tag for anything real, but do not claim the API
  requires one.
- `resource.requests.cpu` / `.memory` must be exact values from **that cluster's** `cpu` /
  `memory` lists, and so must ⚠️ `limits.cpu` — a limit outside the list fails with
  `DEPLOYMENT_INVALID_CPU_LIMIT`. `limits.memory` is accepted but never applied.
- `disk` mounts one disk as `{name, mountPath, subPath}`; `extraDiskMountData` maps extra
  file paths to `{diskName, subPath}`. If you mount a disk, send **both** `minReplica` and
  `maxReplica` — omitting `maxReplica` trips a guard that rejects disks with autoscaling.
- `internal: true` keeps a `WebService` off the public ingress. It is *documented* as
  required for `InternalTCPService` but nothing validates it and the deployer only reads it
  for a `WebService` — so set it for the intent, and do not rely on it to make a service
  private.

Two more values the schemas do not spell out, so they are easy to guess wrong:

- `deploymentMetrics`'s `range` accepts **only** `1h`, `6h`, `12h`, `24h`, `1hagg`,
  `6hagg`, `12hagg`, `24hagg`, `7dagg`, `30dagg`. Anything else — `1d`, `7d`, `30d` —
  fails validation.
- `routeCreate`'s `target` is a URI: see 6.4.

On `"failed"`, read `logUrl` and `statusUrl` from `deploymentGet` and report them.
⚠️ `statusUrl` is a 10-minute signed URL — fetch a fresh one, never reuse an old one.

### 6.4 Exposure — WebService only

`routeCreate` against any other type fails with `CAN_MAP_ONLY_WEB_SERVICE`.

`deploymentGet` returns a `url` for every deployment, but ⚠️ it only *resolves* for a
**non-internal WebService** — the string is populated regardless of type, so do not read it
back as proof the service is reachable. This section is only for a **custom** domain on top
of that URL.

```
  domainCreate  ─▶  domainGet  ─▶  ❗ user adds CNAME  ─▶  routeCreate
   ask cdn first     read the        then STOP             target is a URI
   (default false)   cname value     and wait
```

**1. `domainCreate`.** Ask about `cdn` first — it is not cheap to change your mind about.

- `cdn: false` (**the default**, recommend it) — points straight at the cluster, nothing
  extra required, deletion is immediate.
- `cdn: true` — **feature-gated** on the billing account, and a **trial account is rejected
  outright** (`DOMAIN_TRIAL_BILLING_CANNOT_CREATE_CDN_DOMAIN`, or `ACCESS_DENIED` when the
  feature is off). Deletion is asynchronous.

**2. `domainGet`, then hand the record over.** ⚠️ `dnsConfig` carries **one CNAME**, and its
value differs by `cdn` — read it, never write one from memory. A non-CDN domain has **no
verification at all**, so its empty `verification` fields are not records to publish.

⚠️ **Who terminates TLS depends on `cdn`, and getting it backwards leaves the site
unreachable.** The Nortezh ingress serves a **self-signed** certificate
(`CN=parapet-ingress-controller`) and redirects HTTP to HTTPS. So:

```
  cdn=false   customer's Cloudflare must PROXY (orange cloud)
              SSL/TLS mode = Full          ← not Full (strict), not Flexible
              nothing else terminates TLS with a public cert

  cdn=true    DNS only (grey cloud)
              Nortezh creates a custom hostname on ITS Cloudflare and proxies
              there; orange here would be a double proxy
```

For `cdn=false` — the default and the common case — the handoff is:

> Point your domain at Nortezh:
>
> ```
>   CNAME   <their domain>   <dnsConfig.cname[0]>
> ```
>
> On Cloudflare: set the record to **Proxied** (orange cloud), and
> SSL/TLS → overview → **Full**.
>
> Tell me when it is live.

Then stop and wait. Do not explain the TLS reasoning unless something goes wrong.

**Keep in reserve, for when they report a problem:**
- ⚠️ **Not Full (strict)** — the origin's certificate is self-signed, so strict rejects it
  with **526**. **Not Flexible** — the origin 301s HTTP to HTTPS, so Flexible loops; and if
  the app sends HSTS (`Strict-Transport-Security: max-age=…`) that loop is pinned into every
  visitor's browser for the lifetime of the header.
- **Grey cloud on a `cdn=false` domain leaves the site down**, serving the self-signed cert
  directly. It is not a safe first step here.
- A records pointing at the ingress IPs are **not necessarily wrong** — `dnsConfig.cname`
  resolves to those same addresses. Check what they resolve to before telling anyone to
  delete records.
- Cloudflare flattens a CNAME at the apex automatically, which is what makes a root domain
  work here at all.
- The proxy caches: if a deploy seems not to land, purge first.
- Other providers need the same CNAME; only the UI differs — but a provider with no proxy of
  its own cannot serve `cdn=false` over HTTPS at all, which is a real constraint to raise
  rather than work around.

**3. `routeCreate`** maps `domain` + `path` onto a deployment.

- ⚠️ **`target` is a URI, not a name** — `deployment://<name>`. A bare `"api"` fails with
  "target is invalid".
- `path` must start with `/`. Use `/` for the whole site.
- ⚠️ Never set `skipDomainVerify`; it claims routing for a domain nobody verified.

**4. Confirm.** A non-CDN domain has nothing to poll — once the CNAME resolves, the route
serves. If it does not: wrong zone, Cloudflare proxy on, or DNS not propagated, in that
order. Only a **CDN** domain has a `status` worth re-checking.

### 6.5 Continuous deployment

Nortezh's own CI/CD binding (`cicd.*`) records a repo↔deployment link but **does not build
or deploy anything yet**, and those tools are not exposed here. So wire a normal GitHub
Actions workflow: build and push the image, then deploy it with the official
`Nortezh/nortezh-action`.

#### First, the setup — all of it is theirs to do

```
  ❗ Nortezh service account ──▶ NORTEZH_SA_EMAIL / NORTEZH_SA_KEY ─┐
  ❗ registry push credential ─▶ GOOGLE_CREDENTIALS (or equivalent) ─┼─▶ GitHub Secrets
  ❗ pull secret (6.2)        ──▶ name only, to you ─────────────────┘        │
                                                                             ▼
                                              you write the workflow  ◀── they confirm
```

**None of it is callable from here** — service-account tools are not exposed, so you cannot
check whether one exists or read a key. Ask which registry first, since it changes what they
need. Do not write the workflow until they confirm: a workflow whose secrets do not exist
fails on its first run and wastes a build.

⚠️ **Push and pull are different credentials.** Push is Actions' and needs **write**; pull is
the cluster's and needs only **read**. Never reuse one for both — a leaked pull secret should
not be able to overwrite images.

The handoff, roughly this short:

> Before I write the workflow, a few things to set up:
>
> **1. A Nortezh service account.** In the console → this project → Service Accounts:
> create one if you have not already, then create a key and copy the value. Check it is a
> member of the project.
>
> **2. A push credential for the registry.** The workflow has to authenticate to push the
> image it builds. For Google Artifact Registry: create a Docker repository, then a Google
> service account with the **Artifact Registry Writer** role, and download its JSON key.
>
> **3. A pull secret**, since that registry is private. Console → this project →
> Pull Secrets → Create, in the same location as the deployment. Send me the **name** you
> gave it — never the password.
>
> **4. Three GitHub secrets**, in Settings → Secrets and variables → Actions →
> New repository secret. Paste each value straight in — do not send them to me:
>
> ```
>   NORTEZH_SA_EMAIL    the service account email from step 1
>   NORTEZH_SA_KEY      the key from step 1
>   GOOGLE_CREDENTIALS  the whole JSON key file from step 2, pasted entire
> ```
>
> Tell me when that is done and I will write the workflow.

⚠️ **The push credential goes from the user straight into GitHub Secrets, never through
you** — a value in this transcript is a value that has to be rotated. You need only the
secret **names**, which you already know because you chose them.

Drop step 3 only when the image genuinely belongs to someone else and is already public.
Do **not** drop it by arranging for the user's own image to be public.

Also ask, if you do not know them: the **Dockerfile path** and the **branch** that triggers
a deploy.

**How the build job logs in is a choice, not a property of the registry.** Every option ends
at the same `docker/login-action`; only what it is handed differs. Ask, with choices:

- **OAuth2 — a short-lived token minted during the run.** A provider step trades a
  long-lived credential for an access token used as the password. **Recommend it where it
  exists:** the value in the login expires in an hour, so a leaked build log ages out.
- **Username and password (or token).** A static secret handed to `docker/login-action`.
  Simpler, works everywhere, long-lived — so where it is stored and rotated matters more.

⚠️ **Several registries support both, so do not decide from the registry name.** Ask.

```
  GHCR          user/pass   nothing to create — Actions injects GITHUB_TOKEN.
                            Needs permissions: packages: write and
                            username: github.actor. A PAT only when the push
                            crosses into another org or repo.
  Artifact Reg  OAuth2      GOOGLE_CREDENTIALS, as the template uses it.
                            (Workload Identity Federation if they already have
                            it — keyless — but do not set it up mid-deploy.)
  Artifact Reg  user/pass   _json_key + the whole JSON key. No provider step,
                            shorter workflow, long-lived key in GitHub Secrets.
  Docker Hub    user/pass   DOCKERHUB_USERNAME + DOCKERHUB_TOKEN, Read & Write.
                            Not the account password.
```

Whichever they pick, the **pull** secret is still required for a private image: the cluster
is not GitHub Actions and sees none of this.

**Keep in reserve, for when they ask or hit a problem:**
- It has to be a service account, not their own login: user bearer tokens expire after 7
  days, service account keys do not.
- Keys are created separately from the account, so having an account is not having a key.
  The value is shown in full at creation — treat it like a password.
- ⚠️ If the service account is not a member of the project, every call it makes fails with
  a code that reads like the resource is missing rather than like a permissions problem.
  Which code depends on the domain: project, database, disk, envgroup and route routes say
  `PROJECT_NOT_FOUND`; deployment routes say `DEPLOYMENT_PROJECT_ACCESS_DENIED`; domain
  routes say `FORBIDDEN`. All three mean the same thing here — check membership first.
- The workflow maps the two Nortezh secrets into `SA_AUTH_EMAIL` / `SA_AUTH_KEY`, which is
  what `Nortezh/nortezh-action` reads. Renaming the secrets means changing both places.
- **Only the login changes between options.** Everything else in the template — buildx, the
  `image` step, `build-push-action`, and the whole deploy job — stays exactly as written,
  because the deploy job authenticates to *Nortezh*, not to the registry. Replace only the
  `google-github-actions/auth` + `docker/login-action` pair:

  ```yaml
  # username/password — GHCR with the injected token. Needs packages: write on this job.
  - uses: docker/login-action@v1
    with:
      registry: ghcr.io
      username: ${{ github.actor }}
      password: ${{ secrets.GITHUB_TOKEN }}
  ```

  ```yaml
  # username/password — Artifact Registry without the provider step
  - uses: docker/login-action@v1
    with:
      registry: <registry-host>
      username: _json_key
      password: ${{ secrets.GOOGLE_CREDENTIALS }}
  ```

  ```yaml
  # username/password — Docker Hub
  - uses: docker/login-action@v1
    with:
      username: ${{ secrets.DOCKERHUB_USERNAME }}
      password: ${{ secrets.DOCKERHUB_TOKEN }}
  ```

  ⚠️ **GHCR also needs `permissions: packages: write` on the build job**, which the template
  does not carry because Artifact Registry does not need it. Omitting it fails the push with
  a 403 that reads like a bad credential and sends people to regenerate a token that was
  fine.

  A private image still needs a pull secret on the Nortezh side whichever login you use —
  **the user creates that, not you** (6.2).

#### Then write `.github/workflows/deploy-<name>.yaml`

Fill in every placeholder from the answers above — do not leave a single `<...>` behind.
`port` is conditional rather than fillable: drop it for a `Worker` or `CronJob`.

```yaml
name: Deploy <name>
on:
  push:
    branches:
    - <branch>
jobs:
  build:
    name: build
    runs-on: ubuntu-latest
    outputs:
      image_name: ${{ steps.image.outputs.image_name }}
    steps:
    - uses: actions/checkout@v3
    - uses: google-github-actions/auth@v1
      id: auth
      with:
        credentials_json: ${{ secrets.GOOGLE_CREDENTIALS }}
        token_format: access_token
    - uses: docker/login-action@v1
      with:
        registry: <registry-host>
        username: oauth2accesstoken
        password: ${{ steps.auth.outputs.access_token }}
    - uses: docker/setup-buildx-action@v2
    - id: image
      run: echo "image_name=<registry-host>/<image-path>:$GITHUB_SHA" >> "$GITHUB_OUTPUT"
    - uses: docker/build-push-action@v4
      with:
        context: .
        file: <dockerfile-path>
        provenance: false
        push: true
        tags: ${{ steps.image.outputs.image_name }}
  deploy:
    name: deploy
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
    - name: Deploy to Nortezh
      uses: Nortezh/nortezh-action@v1.2.0
      with:
        action: deployment.create-revision
        project: <project>
        location: <location>
        name: <name>
        image: ${{ needs.build.outputs.image_name }}
        port: <port>
        type: <type>
      env:
        SA_AUTH_EMAIL: ${{ secrets.NORTEZH_SA_EMAIL }}
        SA_AUTH_KEY: ${{ secrets.NORTEZH_SA_KEY }}
```

Notes on that file, so you can adapt it rather than copy it blindly:

- **`Nortezh/nortezh-action` is the official deploy step.** It reads the service-account
  credential from `SA_AUTH_EMAIL` / `SA_AUTH_KEY` in `env:`, and handles the API call and
  its response envelope. Do not hand-roll a `curl` when this exists.
- The **deploy job authenticates completely differently from the build job**, and needs no
  Google auth at all. Nortezh accepts a bearer token or service-account Basic auth; a
  Google access token is neither. A workflow passing a Google token to a Nortezh endpoint
  is wrong, whatever it looks like.
- The **build job is the house pattern** — Google auth, registry login with the minted
  access token, buildx, `provenance: false`. Keep `provenance: false`; the attestation
  manifest it otherwise adds is not what the cluster expects to pull.
- The image tag is computed **once**, in the `image` step, exposed as a job output, and
  consumed by both the build tag and the deploy input. That is what stops the two drifting
  apart — never write the registry path twice.
- ⚠️ **Do not add a `pull_secret` input.** `nortezh-action@v1.2.0` does not accept one: it
  logs `Unexpected input(s) 'pull_secret'` and ignores it. It is unnecessary anyway — the
  deployment already stores `pullSecret` from its create, and an omitted field is preserved
  on a revision, so the secret keeps applying.
- `port` and `type` must match what 6.3 deployed. A `Worker` or `CronJob` takes no port.

#### Then hand it back

**Stop and ask the user to commit and push.** You cannot push for them, and until that
workflow runs there is no image at the tag 6.3 pointed the deployment at — which is why it
is sitting `"failed"`.

Once they confirm the push, poll `deploymentGet` until `actionStatus` is `"success"` and
report. That transition — `"failed"` to `"success"`, with no call from you in between — is
the whole point of the flow, and it is the first moment anything has actually run.

⚠️ If it stays `"failed"` after CI reports success, the image was pushed but cannot be
pulled: check the pull secret exists in **that location** (6.2) and that the tag CI pushed
matches what the deployment now names. Do not go back to changing the image by hand.

---

## Step 7 — Report what actually happened

Always, even when everything worked, and **especially** when it did not.

The report is built from **what actually ran**, never from the plan. Those two differ the
moment anything fails, and a report copied from the plan claims work that was never done —
which is worse than no report at all, because the user stops checking.

- **Every resource from the plan appears**, including the ones that did not run and the ones
  left untouched. A silent omission reads as success.
- **State how you know**, not just what you claim: `actionStatus: "success"` for a
  deployment, `2` for disk/database/route/pull secret, "synchronous" for a project or env
  group. They genuinely differ, and citing the check is what makes the claim auditable.
- **A failure carries its real error code**, what it means, and the one concrete next
  action. Never "it failed".
- **Anything still waiting on the user is listed as such**, with what is blocked behind it.
- **No secret values.** Key names, paths and "set" — never a password, a key, or a token.
- Same formatting rules as the plan: fenced blocks, chips, no pipe tables.

Red already means *delete*, so failures and blocked work need their own chips:

    🟢 added   🟡 changed   🔴 deleted   ⚪ untouched
    ❌ failed   ⏸ not run   ❗ waiting on you

### The report template

# Deploy report — <project> / <location>

<n> added · <n> changed · <n> untouched · <n> failed · <n> waiting on you

🟢 added   🟡 changed   🔴 deleted   ⚪ untouched
❌ failed   ⏸ not run   ❗ waiting on you

## Databases

```
  ⚪ orders-db · postgres · untouched · db-orders.rcf2:5432
  ⚪ cache · redis · untouched · redis-cache.rcf2:6379
```

No password appears in this report.

## Config

```
  🟢 acme-shared · env group · created · 2 keys set
  🟢 secrets on api · mounted · created · 2 paths, returned as ***
```

⚠️ These values are baked into a revision at deploy time. Editing the group later does
not reach a running deployment until it is redeployed.

## Deployments

```
  🟢 worker · created · running · actionStatus "success"
  ❌ api · patch failed · actionStatus "failed"

  ❌ api — DEPLOYMENT_INVALID_CPU
      "0.75" is not in cluster rcf2's list: 0.5, 1, 2
      logs     <logUrl>
      status   <statusUrl>   10-min signed, refetched not reused
      next     pick a listed cpu value, I re-run this then the route
```

## Domains

```
  🟢 api.acme.com · created · non-CDN, written success at create
```

## Routes

```
  ⏸ api.acme.com/ · not run · blocked by the api failure
```

## Still yours

1. <what they must do, with exact values, and what it unblocks>

## Not done

- <each thing, and why>

## To undo

- <what this run created and how to remove it, including anything that must be
  unlinked first>

### End of the report template

---

# Ground rules

- **Never invent an identifier.** Slugs, locations, cpu/memory sizes, disk and env group
  names, image tags — all come from a list call or from the user.
- **Reuse beats create.** A name collision (`DEPLOYMENT_NAME_ALREADY_EXISTS`,
  `DISK_NAME_NOT_AVAILABLE`, `DATABASE_NAME_NOT_AVAILABLE`) usually means the thing already
  exists, not that you need a different name. Ask before renaming around it.
- **Re-running must be safe.** The user may be resuming a half-built stack.
- **Change the least you can — but never less than the call requires.** ⚠️ "The fields that
  differ and nothing else" is **not** safe here: `project`, `location`, `name` and `image`
  are demanded every call, and omitting `mountDataSecretPaths` deletes. See 6.3.
- **Confirm before anything destructive.** Every delete — `deploymentDelete` (silently takes
  its routes), `diskDelete`, `domainDelete`, `routeDelete`, `envgroupDelete`,
  `pullsecretDelete`, `db*Delete` — plus `deploymentRollback` and `deploymentPause`, which
  stops a running workload. Say what will be destroyed or stopped, then wait.
- **A tool error is real.** Domain errors arrive as HTTP 200 with `ok:false` and the MCP
  layer converts them into tool errors. Do not retry an identical call — read the code, fix
  the input, or ask.
- **Never echo secrets in a summary.** Say where you put them, not what they are.
