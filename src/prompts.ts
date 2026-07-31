// MCP prompts — guided workflows that ship with the server.
//
// Prompts are the native way to bundle a "skill" with an MCP server: the client lists
// them over `prompts/list` and surfaces them as slash commands (in Claude Code,
// `/mcp__nortezh__deploy-stack`). Nothing to install beyond `claude mcp add`, and it works
// in any MCP client rather than only Claude Code.
//
// The content here is the part the tool schemas cannot carry: which resources depend on
// which, how to tell each one is ready (they do NOT agree with each other), which failures
// are expected rather than wrong, and the steps that leave this API entirely — DNS records,
// GitHub secrets, `git push`. Everything about a single call's shape already comes from the
// generated schemas; do not restate it here, a copy only goes stale.

export interface PromptArgument {
  name: string
  description: string
  required?: boolean
}

export interface PromptSpec {
  name: string
  description: string
  arguments: PromptArgument[]
  /** Builds the user-message text from the supplied arguments. */
  render: (args: Record<string, string>) => string
}

function given(args: Record<string, string>): string {
  const known = Object.entries(args)
    .filter(([, value]) => typeof value === 'string' && value.trim() !== '')
    .map(([key, value]) => `- ${key}: ${value}`)

  if (known.length === 0) {
    return 'The user gave nothing up front, so every answer has to come from the interview below.'
  }
  return `The user has already told you:\n${known.join('\n')}\n\nTreat these as answered and do not ask for them again.`
}

const DEPLOY_STACK = `You are working on an application stack on Nortezh using the \`nortezh\` MCP tools.

{{GIVEN}}

## The four rules that matter most

**1. Ask, do not assume — and always ask with choices.**

Every decision below goes to the user as a question shaped like this, without exception:

- **2–4 concrete options**, each saying what it means and what it costs or implies. Not
  bare labels — the user should be able to choose without reading the code.
- **One of them marked as your recommendation**, listed first, with the reason.
- **A final option that is free text**, always, for when none of the others is what they
  want. Word it plainly: *"Something else — tell me"*. It is never optional and never
  omitted because the listed options "cover everything"; they routinely do not, and a
  question with no escape forces the user to accept an answer that is merely close.

If you have an \`AskUserQuestion\`-style tool, use it — it supplies the free-text escape
itself, so do not also write your own "Other" option. If you are asking in plain prose,
write the escape yourself as the last item.

Never pick a project, location, engine, size, port or domain on their behalf because it
seemed obvious. Where you can enumerate the real choices from the API (\`projectList\`,
\`clusterList\`, \`deploymentList\`, \`envgroupList\`, \`diskList\`), the options must be those
real values, not invented ones — and existing resources come first, before any "create a
new one" option.

**2. Deploying rarely means creating everything.** Most of the time something already
exists: the project, the database, the deployment itself. Patching one config value on a
running deployment is as much a "deploy" as building a stack from nothing, and it is the
more common request. **Creating a resource that already exists is a failure, not a step.**

**3. There is no fixed sequence.** What follows is a dependency graph and a menu, not a
checklist. Build the plan from the user's answers, show it, then execute only that.

**4. Some steps are theirs, not yours — hand them over cleanly and stop.**

Parts of this cannot be done through the API: adding DNS records, creating a service
account and its key in the console, adding GitHub secrets, committing and pushing. When you
reach one:

- **Say plainly what they need to do**, as a short numbered list. Three or four steps, not
  a page.
- **Give the exact values** — the record, the secret name, the URL to open. Values are the
  payload, not detail; without them the instruction is useless.
- **Leave the explanation out.** Do not front-load why it works, what the alternatives are,
  or what might go wrong. It buries the instruction, and most of the time none of it is
  needed.
- **Then stop and wait.** Do not continue on the assumption they did it. Ask them to confirm
  when it is done.
- **Keep the detail in reserve.** If they hit a problem, or ask, *then* give the specifics
  for their situation. That is when it is useful and when they will actually read it.

The test is simple: could they act on your message without reading anything else? If yes,
send it. If it needs a paragraph of context first, you have written too much.

And underneath all four: **understanding the user's project is the whole job.** Its
architecture, its service components, and above all **how each service is configured** —
that is what every resource you create is derived from. Get the shape of the system right
and the Nortezh calls are mechanical. Get it wrong and you will create real infrastructure
that is confidently, expensively wrong: a Worker exposed to the internet, a service pointed
at a database that is not the one it uses, a config value that was actually a secret.

Nothing below is worth doing until Stage A0 is done and the user has confirmed it.

---

{{RESOURCE_MODEL}}

---

That was the **model** — what each thing is. The rest of this is the **procedure** — what to
do about it. When the two seem to disagree, the model is the one that was checked against
the API source.

---

# Stage A — Establish what is actually being asked

## A0. Understand the project, its services, and their configuration

**This is the step that matters.** Everything after it is mechanical; everything after it is
also wrong if this is wrong. Do not skip ahead because the user's request sounded simple.

**Read the codebase first.** Nearly every question below is already answered in the repo,
and a question the code answers is a question you should not be asking. Work it out, then
show the user what you concluded and let them correct it — far better than an
interrogation, and far better than guessing.

### One project holds many things

A Nortezh **project** is not one application. It is a container for **many deployments,
many databases, many disks, many env groups, many domains** — with billing and membership
drawn around it. So:

- A monorepo with \`api\`, \`worker\` and \`web\` is normally **one project with three
  deployments**, not three projects.
- Those three can share one Postgres, or have one each — that is a decision to ask about,
  not to assume either way.
- An env group is shared across deployments in the project, which is exactly what makes it
  the right home for the database connection every service needs.
- Most names are unique **within** the project — \`api\` in one project and \`api\` in another
  are unrelated. ⚠️ Domains and route \`(domain, path)\` pairs are the exception: those are
  unique across the **whole platform**, so \`DOMAIN_NOT_AVAILABLE\` can mean a stranger's
  project already has it.

Ask which project these services belong in before assuming they belong together — and
ask whether new services join an existing project or start a new one.

### What to read, and what it tells you

| look at | tells you |
|---|---|
| \`docker-compose.yml\` | the whole service topology in one file: every service, its ports, and its \`postgres\` / \`redis\` / \`mongo\` dependencies |
| \`Dockerfile\` / \`build/*/Dockerfile\` | how each service builds, and \`EXPOSE\` gives you the port |
| \`.env.example\`, \`.env.sample\`, \`config.example.*\` | the exact environment variables the app expects, which becomes the env group |
| \`package.json\`, \`go.mod\`, \`pyproject.toml\`, \`Cargo.toml\` | the language, and whether it is a monorepo with several deployable pieces |
| \`.github/workflows/\` | whether CI already exists, and which registry they already push to |
| \`README\` | how the author says to run it, and any external dependency the code does not show |
| \`Procfile\`, \`Makefile\`, \`k8s/\`, \`helm/\` | existing deploy intent — worker processes, cron jobs, replica counts |

### Build a service inventory

For **each** service you find, work out all of it — this table is the artifact the rest of
the run depends on, so fill in every column or mark it unknown and ask:

| | from | why it matters |
|---|---|---|
| name | directory, compose key | becomes the deployment name, unique within the project |
| type | does it listen? is it scheduled? | \`WebService\` / \`Worker\` / \`CronJob\` / \`InternalTCPService\` |
| port | \`EXPOSE\`, compose \`ports:\`, the code | required for \`WebService\`, meaningless otherwise |
| build | Dockerfile path, build context | the CI workflow needs both |
| depends on | compose \`depends_on\`, connection strings | which database, cache or disk it needs |
| reachable by | compose \`ports:\` vs internal only | public URL, custom domain, or internal only |

### Then the configuration of each service — the part most often got wrong

Configuration is where a deployment silently misbehaves rather than failing loudly, so go
through it deliberately, per service:

- **Every environment variable it reads**, from \`.env.example\` and from the code. A variable
  the app requires and nobody set does not fail at deploy time — it fails at run time, or
  worse, falls back to a default that happens to work.
- **Which of those are secrets** and which are ordinary config. Database passwords, API
  keys, signing secrets, tokens. ⚠️ These do **not** belong in an env group — those are
  plain text and never masked. They go in \`mountData\` with their paths in
  \`mountDataSecretPaths\` (see B2). Never echo one back in a summary.
- **Which are shared across services and which are per-service.** Shared ones — the database
  URL, a queue address — belong in one env group every deployment references. Per-service
  ones belong inline on that deployment. Getting this backwards means updating the same
  value in five places later.
- **Config files, not just variables.** A \`config.yaml\` or a certificate the app reads from
  disk is \`mountDataChanges\`, not env.
- ⚠️ **Addresses change when they leave compose.** In \`docker-compose\`, services reach each
  other by compose service name (\`postgres:5432\`, \`http://api:8080\`). Deployed, those names
  mean nothing: a managed database has a real \`host\` and \`port\` from \`db*Get\`, and a sibling
  service is reached at its \`internalUrl\` from \`deploymentGet\`. **Every inter-service value
  in the config has to be translated**, and this is the single most common cause of a stack
  that deploys cleanly and then cannot talk to itself.

### Confirm before proceeding

Present the inventory back as a compact summary — *"three services in one project: \`api\` on
8080 (public, needs Postgres), \`worker\` (no port, same Postgres plus Redis), \`web\` on 3000
(public); shared config \`DATABASE_URL\`, \`REDIS_URL\`; secrets \`JWT_SECRET\`, \`STRIPE_KEY\`"* —
and ask what to do with it, with choices and a free-text escape as always.

**Do not proceed on your reading alone.** The repo shows what runs locally, which is not the
same as what they want deployed: local compose services may be managed elsewhere in
production, some services may be out of scope, and defaults that are fine on a laptop are
often wrong in a cluster.

If there is no repo in context — the user is working from a prebuilt image, or only wants to
change something already running — say so and go to A1 rather than inventing an
architecture.

## A1. The intent

With A0 confirmed, this is the next thing to settle — before any call that changes anything,
and unless the user already made it unambiguous:

- **Patch an existing deployment** — change env vars, scale, resources, image, port
- **Add something to an existing project** — a new deployment, database, disk or domain
  alongside what is already there
- **Build a new stack from nothing**
- **Wire CI onto something that already exists**
- *plus the free-text escape, as with every question here*

The answer decides which sections below you even read. If the free-text answer describes
something none of these cover, take it at face value and build the plan from it rather than
forcing it into the nearest listed option.

## A2. Take inventory before proposing anything

Whatever the intent, find out what is already there and **show it to the user**:

\`projectList\`, then within the chosen project — \`deploymentList\`, \`envgroupList\`,
\`diskList\`, \`dbPostgresList\` / \`dbRedisList\` / \`dbMongoList\`, \`domainList\`, \`routeList\`.

This is what turns "create a database" into "you already have \`orders-db\`, use it?". Offer
the existing resources as the **first** options in any question that follows.

## A3. Fill in the gaps

Ask only what the intent actually needs.

- **Project** — from \`projectList\`. To create one you need a \`billingId\`, which
  \`projectGet\` or \`projectOverview\` returns for any project they already have. If they have
  none at all, that is a console handoff — never invent the UUID.
- **Location** — \`clusterList\`. Keep the whole response; you need three things from it:
  - \`cpu\` and \`memory\` are the **selectable sizes for that cluster** (e.g. \`"0.5"\`, \`"1"\`,
    \`"512Mi"\`, \`"1Gi"\`). Resource requests must be one of these exact strings or the deploy
    fails with \`DEPLOYMENT_INVALID_CPU\` / \`DEPLOYMENT_INVALID_MEMORY\`.
  - \`features\` advertises what the cluster is capable of, as **present-when-supported**
    keys (\`"database": {}\` means yes, an absent \`database\` key means no). ⚠️ It is a hint,
    **not the gate**: managed databases are actually gated on a different table, and disks
    on the **billing account's** feature flags, so \`db*Create\` can still fail with
    \`DATABASE_CLUSTER_NOT_SUPPORTED\` and \`diskCreate\` with \`ACCESS_DENIED\` on a cluster
    whose \`features\` looked fine. Use it to avoid obviously wrong offers; be ready for the
    call to fail anyway, and report that as a platform setting rather than retrying.
  - ⚠️ \`isTrial\` is a property of the **cluster** — "this cluster accepts trial workloads" —
    not a statement about the caller's billing account. It does not tell you whether the
    user is on trial. (If they are, \`clusterList\` already filters to clusters that accept
    them.)
- **Workload type**, for a new deployment — \`WebService\` (HTTP, gets a URL), \`Worker\` (no
  ingress), \`CronJob\` (needs a crontab \`schedule\`), \`InternalTCPService\` (cluster-internal).
- **Data dependencies** — offer *nothing* as a real first option when it is plausible:
  - reuse a managed database that already exists (most common — you listed them in A2)
  - create a new managed Postgres / Redis / Mongo
  - a database hosted elsewhere entirely, in which case you only need env vars
  - a persistent disk, new or existing
  - nothing at all
- **Configuration** — an env group (shared, reusable), inline env on the deployment, or
  mounted files; and which of those values are secret.
- **Exposure**, \`WebService\` only — the free \`*.nortezh.com\`-style URL it already gets, or
  a custom domain as well.
- **Continuous deployment** — whether to wire GitHub Actions, and the repo, branch,
  registry and Dockerfile path.
- **Scaling and size** — \`minReplica\` / \`maxReplica\`, cpu and memory from the cluster's own
  lists. Recommend something and say why; never silently default.

Then **show the plan** — which resources you will create, which you will reuse untouched,
and which you will modify — and get a yes before touching anything.

---

# Stage B — Operations

Do only the ones the plan calls for, in dependency order. Every one of them starts by
checking whether the thing already exists.

## ⚠️ Readiness is not reported the same way twice

The model above gives this per resource; here it is as one table, because getting it wrong
means either moving on too early or waiting forever.

| resource | poll | ready when | can fail? |
|---|---|---|---|
| deployment | \`deploymentGet\` | \`actionStatus\` is the **string** \`"success"\` | yes — \`"failed"\` |
| database | \`dbPostgresGet\` / \`dbRedisGet\` / \`dbMongoGet\` | \`actionStatus\` is the **number \`2\`**, and \`host\` is non-empty | no |
| disk | \`diskGet\` | \`actionStatus\` is the **number \`2\`** | no |
| route | \`routeGet\` | \`status\` is the **number \`2\`** | no |
| pull secret | \`pullsecretGet\` | \`status\` is the **number \`2\`** | no |
| domain, non-CDN | — | **immediately** — written \`success\` at create | no; nothing runs |
| domain, CDN | \`domainGet\` | \`status\` is the **string** \`"success"\` | yes — \`"error"\` |
| project, env group | — | **immediately** | no |

⚠️ **Two resources report a string, and the same two can fail: deployment and domain.** A
domain's \`status\` is one of \`pending\`, \`success\`, \`error\`, \`verify\` — \`error\` is a real
outcome, not a placeholder. Database, disk, route and pull secret report a bare integer
(\`1\` pending, \`2\` success) with **no failure value at all**, so one of those that goes wrong
sits at \`1\` indefinitely — bound those waits to a few minutes and then tell the user, rather
than looping.

Poll every few seconds, not faster.


## B1. Data stores — reuse first, create only if there is nothing to reuse

**Reusing one is the normal case.** If A2 turned up a database the user wants to use, there
is nothing to create here — read its connection details and go to B2. ⚠️ The three engines
return **different fields**:

| | returns |
|---|---|
| \`dbPostgresGet\` | \`host\`, \`port\`, \`user\`, \`database\`, \`password\` |
| \`dbMongoGet\` | \`host\`, \`port\`, \`user\`, \`password\` — **no \`database\`** |
| \`dbRedisGet\` | \`host\`, \`port\`, \`password\` — **no \`user\`, no \`database\`** |

Do not build a connection string from a field the engine does not return. The same reuse
logic applies to a disk that already exists — just reference it by name.

Creating a new one:

- \`dbPostgresCreate\` / \`dbRedisCreate\` / \`dbMongoCreate\`. **You supply the password**; it is
  not generated. Generate a strong one, show it to the user **once**, and carry it into the
  configuration as a **secret** — \`mountData\` + \`mountDataSecretPaths\`, not an env group
  (see B2 for why).
  ⚠️ \`cpu\`, \`memory\` and \`storageSize\` are **required and bounded**: cpu **0.5–4** cores,
  memory **256–4096** MiB, storage in MB. Ask for these with a recommendation like any
  other sizing decision — do not pick silently.
- \`diskCreate\` for persistent storage. A disk belongs to one location. ⚠️ **Several
  deployments can mount the same disk, and neither \`diskGet\` nor \`DISK_IN_USE\` will tell you
  about most of them.** Both see only \`extraDiskMountData\` mounts and never the primary
  \`disk\` field, so \`diskDelete\` will destroy a volume a running deployment is using without
  raising anything. An empty \`bindingDeployments\` is not evidence the disk is free — before
  proposing a delete, read each deployment with \`deploymentGet\` and check its \`disk\` field
  yourself.
- Wait for each per the table above. For a database the connection details (\`host\`, \`port\`)
  are **empty strings until it is ready** — that is precisely why this comes before the
  deployment.
- ⚠️ \`db*Get\` returns the password in plain text. Move it into config; do not repeat it in
  your summary.

## B2. Configuration

⚠️ **Env groups are plain text and are never masked.** The API says so itself: *"do not put
real secrets in an env group."* \`envgroupGet\` returns every value in full to anyone who can
read the project. Secrets go in \`mountData\` with their paths listed in
\`mountDataSecretPaths\`, which is the only thing here that censors — \`deploymentGet\` returns
those as \`***\`. Inline \`env\` on the deployment is not masked either. So:

| | where it goes |
|---|---|
| ordinary shared config | env group |
| ordinary per-service config | inline \`env\` on the deployment |
| **secrets** — passwords, API keys, tokens | \`mountData\` + \`mountDataSecretPaths\` |

If the user would rather keep a secret in an env group anyway, that is their call — say
once that it will be readable in full, and move on.

- \`envgroupCreate\` with a \`data\` object, then reference it by name in the deployment's
  \`envGroups\`. \`name\` is lowercase, 3–27 characters, and **immutable** — there is no
  rename, so pick it deliberately.
- ⚠️ **\`envgroupUpdate\` REPLACES the whole map.** It is not a merge: any key you leave out
  is deleted, and omitting \`data\` entirely empties the group. To change one value, read the
  group with \`envgroupGet\` first, apply your change to that map, and send the whole thing
  back. This is the same trap as \`env\` on a deployment, one level up.
- Groups merge **in the order given**, later overriding earlier, and the deployment's own
  \`env\` / \`addEnv\` / \`removeEnv\` is overlaid last and always wins.
- ⚠️ On a deployment, \`envGroups\` absent means **leave the current links alone**; \`[]\` means
  **unlink every group**. Those are different, and sending an empty array to mean "no change"
  silently strips the deployment's whole shared configuration. An unknown name fails with
  \`DEPLOYMENT_ENV_GROUP_NOT_FOUND\`.
- \`mountDataChanges\` is applied on top of \`mountData\`, so the two compose — secret paths
  listed in \`mountDataSecretPaths\` still apply to keys set either way.
- ⚠️ The merge is **baked into the revision at deploy time.** Editing a group afterwards does
  **not** change a running deployment — it needs another \`deploymentDeploy\` to pick the new
  values up. This is the single most common surprise here: the group looks updated, the app
  keeps running the old values. Say it out loud, and follow an \`envgroupUpdate\` with a
  redeploy unless the user explicitly wants to wait.
- Files rather than env vars: use \`mountDataChanges\`, a list of \`{key, type: "set"|"remove",
  value}\` where \`key\` is the file path. (\`mountData\` still works but is the older form.)
  List any secret paths in \`mountDataSecretPaths\` so \`deploymentGet\` censors them to \`***\`.
- Private registry: \`pullsecretCreate\` first, then pass its name as \`pullSecret\`.

## B3. The deployment

### Patching one that already exists — the common case

\`deploymentDeploy\` is *mostly* a patch: most unset fields keep their stored value. But it
has three sharp exceptions, and each one destroys data if you assume otherwise.

**Always required, even on a one-field change:** \`project\`, \`location\`, \`name\` **and
\`image\`**. There is no "send only the field I am changing" — you must read the current
image with \`deploymentGet\` and send it back unchanged, or you will not get past validation.

**Three fields that delete rather than preserve when omitted:**

- ⚠️ \`env\` **replaces the entire inline env map.** Sending it with one pair deletes every
  other inline variable. To change one key use \`addEnv\` (upsert) and \`removeEnv\` (delete);
  only send \`env\` when the user means "these and nothing else".
- ⚠️ \`mountDataSecretPaths\` omitted **deletes the stored value of every secret-marked
  mounted file.** If the deployment has any, read them from \`deploymentGet\` and send the
  paths back on every deploy.
- ⚠️ \`envGroups: []\` unlinks every group; absent leaves them alone. See B2.

**One field that cannot be changed at all:** \`type\`. It is written at creation and
\`deploymentDeploy\` never updates it. A deployment created as a \`WebService\` stays a
\`WebService\` forever — the only way to change it is delete and recreate. This is why the
placeholder recipe below sets the real \`type\` at create time.

So: \`deploymentGet\` first, always. Show the user the current value beside the new one, and
carry forward \`image\` plus anything in that list the deployment already has.

Every deploy creates a new revision. \`deploymentRollback\` rewinds to an earlier one —
⚠️ but it does **not** create a new revision, and it does **not** restore env-group links or
\`type\`. It is a partial undo, not a time machine; say so rather than promising a clean
rollback.

### Creating a new one, when the image does not exist yet

Normal when CI has never run: **create with a public placeholder image and correct it
afterwards.** This validates the plumbing, the cluster, the resource sizes and the env
wiring now, instead of after a ten-minute build fails on a typo.

⚠️ **The placeholder is the image, and only the image.** \`type\` cannot be changed later, so
set the real one at create. \`nginx:latest\` only makes sense as a placeholder for a
\`WebService\`; for a \`Worker\` or \`CronJob\` pick something that exits cleanly or idles, and
tell the user it will restart or fail until the real image lands — that is expected, not a
problem to debug.

1. \`deploymentCreate\` with the **real** \`type\`, \`port\` and \`schedule\`, and a placeholder
   \`image\`. Say which value is temporary.
2. Wait for \`actionStatus: "success"\`.
3. \`deploymentDeploy\` with the real image once CI has pushed one — plus env groups, disk
   mount, replicas and resources.
4. Wait again.

If the real image already exists, skip the placeholder entirely.

Field rules worth knowing before you send anything:

- \`type\` — \`WebService\` (the default when omitted), \`Worker\`, \`CronJob\`,
  \`InternalTCPService\`. An **empty string is rejected** (\`DEPLOYMENT_INVALID_TYPE\`); omit
  the field instead. **Immutable after creation.**
- \`protocol\` — ⚠️ despite the four names the schema lists, a \`WebService\` accepts only
  **\`http\` or \`https\`**; \`none\` and \`h2c\` fail validation. A \`Worker\` or \`CronJob\` must
  leave it unset or \`none\`. Omitting it gives the type's default, which is what you usually
  want.
- \`port\` — defaults to 80 **only for \`WebService\`**. ⚠️ An \`InternalTCPService\` needs a
  real port and is given \`0\` if you omit it, which deploys and then silently serves
  nothing.
- \`schedule\` — crontab syntax for a \`CronJob\`. ⚠️ It is **not enforced**: omitting it
  passes validation and produces a job with no schedule. Ask for it.
- \`image\` — the only rule is that it must not end in \`@\`. Tags like \`:latest\` are accepted;
  recommend a pinned digest or an immutable tag for anything real, but do not claim the API
  requires one.
- \`resource.requests.cpu\` / \`.memory\` must be exact values from **that cluster's** \`cpu\` /
  \`memory\` lists, and so must ⚠️ \`limits.cpu\` — a limit outside the list fails with
  \`DEPLOYMENT_INVALID_CPU_LIMIT\`. \`limits.memory\` is accepted but never applied.
- \`disk\` mounts one disk as \`{name, mountPath, subPath}\`; \`extraDiskMountData\` maps extra
  file paths to \`{diskName, subPath}\`. If you mount a disk, send **both** \`minReplica\` and
  \`maxReplica\` — omitting \`maxReplica\` trips a guard that rejects disks with autoscaling.
- \`internal: true\` keeps a \`WebService\` off the public ingress. It is *documented* as
  required for \`InternalTCPService\` but nothing validates it and the deployer only reads it
  for a \`WebService\` — so set it for the intent, and do not rely on it to make a service
  private.

Two more values the schemas do not spell out, so they are easy to guess wrong:

- \`deploymentMetrics\`'s \`range\` accepts **only** \`1h\`, \`6h\`, \`12h\`, \`24h\`, \`1hagg\`,
  \`6hagg\`, \`12hagg\`, \`24hagg\`, \`7dagg\`, \`30dagg\`. Anything else — \`1d\`, \`7d\`, \`30d\` —
  fails validation.
- \`routeCreate\`'s \`target\` is a URI: see B4.

On \`"failed"\`, read \`logUrl\` and \`statusUrl\` from \`deploymentGet\` and report them.
⚠️ \`statusUrl\` is a 10-minute signed URL — fetch a fresh one, never reuse an old one.

## B4. Exposure — WebService only

\`routeCreate\` against any other type fails with \`CAN_MAP_ONLY_WEB_SERVICE\`.

\`deploymentGet\` returns a \`url\` for every deployment, but ⚠️ it only *resolves* for a
**non-internal WebService** — the string is populated regardless of type, so do not read it
back as proof the service is reachable. This section is only for a **custom** domain on top
of that URL.

**1. \`domainCreate\`.** Ask about \`cdn\` first — it defaults to \`false\` and it is not a
detail you can change your mind about cheaply:

- \`cdn: false\` (**the default**) — the domain points straight at the cluster. Nothing extra
  is required, and deleting it later is immediate.
- \`cdn: true\` — served through the Nortezh CDN. **Feature-gated**: the project's billing
  account must have the \`cdn\` feature enabled, and a **trial billing account is rejected
  outright** (\`DOMAIN_TRIAL_BILLING_CANNOT_CREATE_CDN_DOMAIN\`, or \`ACCESS_DENIED\` when the
  feature is simply off). Deleting a CDN domain is asynchronous rather than immediate.

Offer both plus the free-text escape, and recommend \`false\` unless the user says they want
the CDN — it is the default for a reason and it works everywhere.

**2. \`domainGet\`, then hand the record to the user.**

Two consequences of what the model says about domains, because both change what you send
the user:

- A non-CDN domain has **no verification at all**, so do not present its empty
  \`verification.ownership\` / \`verification.ssl\` fields as records to publish. They are
  zero-valued because that path has none, not because it has not run yet.
- \`dnsConfig\` carries **one CNAME**, so the handoff is one record — not a table of three.
  Read the value from \`domainGet\`; it differs by \`cdn\` flag.

So the handoff is:

> Point your domain at Nortezh with this DNS record:
>
> | type | name | value |
> |---|---|---|
> | CNAME | \`<their domain>\` | \`<dnsConfig.cname[0]>\` |
>
> On Cloudflare, set it to **DNS only** (grey cloud), not Proxied.
>
> Tell me when it is live.

Then stop and wait. Do not explain TLS termination, apex flattening or SSL modes unless
something goes wrong.

**Keep in reserve, for when they report a problem:**
- Proxied (orange cloud) breaks certificate issuance and commonly causes redirect loops,
  because Cloudflare terminates TLS itself while Nortezh also redirects HTTP to HTTPS. Grey
  cloud first, always. If they want the proxy afterwards it is a deliberate second step, and
  the SSL mode must be **Full (strict)**, never Flexible.
- At the zone apex Cloudflare flattens a CNAME automatically, which is what makes a root
  domain work at all here — there are no A/AAAA records to fall back to. Expected; not a
  problem to route around.
- The proxy caches. If they enable it later and a deploy seems not to take effect, purge
  first.
- Other providers need the same CNAME; only the UI differs. A provider that cannot CNAME at
  the apex is a real constraint — ask, rather than guessing at a workaround.

**3. \`routeCreate\`** maps \`domain\` + \`path\` onto a deployment.

- ⚠️ **\`target\` is a URI, not a name.** It must be \`deployment://<name>\` — that prefix is
  the only accepted form, and a bare \`"api"\` fails validation with "target is invalid".
- \`path\` must start with \`/\`. Use \`/\` for the whole site.
- ⚠️ Never set \`skipDomainVerify\`. It exists for tests, and using it claims routing for a
  domain nobody verified.

**4. Confirm it works.** For a non-CDN domain there is nothing to poll — once the CNAME
resolves, the route serves. If it does not, the usual causes in order: the record went into
the wrong zone, Cloudflare's proxy is on, or DNS has not propagated yet. Only a **CDN**
domain has a \`status\` worth re-checking with \`domainGet\`.

## B5. Continuous deployment

Nortezh's own CI/CD binding (\`cicd.*\`) records a repo↔deployment link but **does not build
or deploy anything yet**, and those tools are not exposed here. So wire a normal GitHub
Actions workflow: build and push the image, then deploy it with the official
\`Nortezh/nortezh-action\`.

### First, the setup — all of it is theirs to do

**None of it is callable from here.** Service-account tools are deliberately not exposed, so
you cannot check whether one exists, create one, or read a key. Ask which registry they use
first, since it changes what they need, then hand them the list.

Do not write the workflow file until they confirm it is done — a workflow whose secrets do
not exist fails on its first run and wastes a build.

The handoff, roughly this short:

> Before I write the workflow, three things to set up:
>
> **1. A Nortezh service account.** In the console → this project → Service Accounts:
> create one if you have not already, then create a key and copy the value. Check it is a
> member of the project.
>
> **2. A registry the cluster can pull from.** For Google Artifact Registry: a Docker
> repository, and a Google service account with Artifact Registry Writer plus a JSON key.
>
> **3. Three GitHub secrets**, in Settings → Secrets and variables → Actions:
>
> | secret | value |
> |---|---|
> | \`NORTEZH_SA_EMAIL\` | the service account email from step 1 |
> | \`NORTEZH_SA_KEY\` | the key from step 1 |
> | \`GOOGLE_CREDENTIALS\` | the whole JSON key from step 2 |
>
> Tell me when that is done and I will write the workflow.

Also ask, if you do not already know them: the **Dockerfile path** and the **branch** that
should trigger a deploy.

**Keep in reserve, for when they ask or hit a problem:**
- It has to be a service account, not their own login: user bearer tokens expire after 7
  days, service account keys do not.
- Keys are created separately from the account, so having an account is not having a key.
  The value is shown in full at creation — treat it like a password.
- ⚠️ If the service account is not a member of the project, every call it makes fails with
  a code that reads like the resource is missing rather than like a permissions problem.
  Which code depends on the domain: project, database, disk, envgroup and route routes say
  \`PROJECT_NOT_FOUND\`; deployment routes say \`DEPLOYMENT_PROJECT_ACCESS_DENIED\`; domain
  routes say \`FORBIDDEN\`. All three mean the same thing here — check membership first.
- The workflow maps the two Nortezh secrets into \`SA_AUTH_EMAIL\` / \`SA_AUTH_KEY\`, which is
  what \`Nortezh/nortezh-action\` reads. Renaming the secrets means changing both places.
- GHCR or Docker Hub instead of Artifact Registry: the auth and login steps differ — adapt
  them rather than forcing this shape. A private registry also needs \`pullsecretCreate\` on
  the Nortezh side so the cluster can pull.

### Then write \`.github/workflows/deploy-<name>.yaml\`

Fill in every placeholder from the answers above — do not leave a single \`<...>\` behind. Two
lines are conditional rather than fillable: drop \`pull_secret\` entirely when the registry is
public, and drop \`port\` for a \`Worker\` or \`CronJob\`.

\`\`\`yaml
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
      image_name: \${{ steps.image.outputs.image_name }}
    steps:
    - uses: actions/checkout@v3
    - uses: google-github-actions/auth@v1
      id: auth
      with:
        credentials_json: \${{ secrets.GOOGLE_CREDENTIALS }}
        token_format: access_token
    - uses: docker/login-action@v1
      with:
        registry: <registry-host>
        username: oauth2accesstoken
        password: \${{ steps.auth.outputs.access_token }}
    - uses: docker/setup-buildx-action@v2
    - id: image
      run: echo "image_name=<registry-host>/<image-path>:\$GITHUB_SHA" >> "\$GITHUB_OUTPUT"
    - uses: docker/build-push-action@v4
      with:
        context: .
        file: <dockerfile-path>
        provenance: false
        push: true
        tags: \${{ steps.image.outputs.image_name }}
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
        image: \${{ needs.build.outputs.image_name }}
        port: <port>
        type: <type>
        pull_secret: <pull-secret>
      env:
        SA_AUTH_EMAIL: \${{ secrets.NORTEZH_SA_EMAIL }}
        SA_AUTH_KEY: \${{ secrets.NORTEZH_SA_KEY }}
\`\`\`

Notes on that file, so you can adapt it rather than copy it blindly:

- **\`Nortezh/nortezh-action\` is the official deploy step.** It reads the service-account
  credential from \`SA_AUTH_EMAIL\` / \`SA_AUTH_KEY\` in \`env:\`, and handles the API call and
  its response envelope. Do not hand-roll a \`curl\` when this exists.
- The **deploy job authenticates completely differently from the build job**, and needs no
  Google auth at all. Nortezh accepts a bearer token or service-account Basic auth; a
  Google access token is neither. A workflow passing a Google token to a Nortezh endpoint
  is wrong, whatever it looks like.
- The **build job is the house pattern** — Google auth, registry login with the minted
  access token, buildx, \`provenance: false\`. Keep \`provenance: false\`; the attestation
  manifest it otherwise adds is not what the cluster expects to pull.
- The image tag is computed **once**, in the \`image\` step, exposed as a job output, and
  consumed by both the build tag and the deploy input. That is what stops the two drifting
  apart — never write the registry path twice.
- \`pull_secret\` names a pull secret that must already exist in Nortezh (\`pullsecretCreate\`).
  **Omit the line entirely** if the registry is public or the deployment has no pull secret;
  naming one that does not exist fails the deploy.
- \`port\` and \`type\` must match what B3 deployed. A \`Worker\` or \`CronJob\` takes no port.

### Then hand it back

**Stop and ask the user to commit and push.** You cannot push for them, and the real image
does not exist until that workflow has run at least once — which is exactly why B3 created
the deployment with a placeholder.

Once they confirm the push, poll \`deploymentGet\` until \`actionStatus\` leaves \`pending\` and
report the result. That is the moment the placeholder is replaced by their application.

---

# Ground rules

- **Never invent an identifier.** Project slugs, locations, cpu/memory sizes, disk names,
  env group names, image tags — all of them come from a list call or from the user.
- **Reuse beats create.** Check the inventory before creating anything. A name collision
  (\`DEPLOYMENT_NAME_ALREADY_EXISTS\`, \`DISK_NAME_NOT_AVAILABLE\`, \`DATABASE_NAME_NOT_AVAILABLE\`)
  usually means the thing you wanted already exists, not that you need a different name —
  ask before renaming around it.
- **Change the least you can — but never less than the call requires.** \`deploymentDeploy\`
  patches, so leave alone what you are not changing. ⚠️ "The fields that differ and nothing
  else" is **not** a safe rule here: \`project\`, \`location\`, \`name\` and \`image\` are demanded
  on every call, and omitting \`mountDataSecretPaths\` deletes rather than preserves. See B3.
- **Confirm before anything destructive.** Every delete — \`deploymentDelete\` (which silently
  takes its routes with it), \`diskDelete\`, \`domainDelete\`, \`routeDelete\`, \`envgroupDelete\`,
  \`pullsecretDelete\`, \`db*Delete\` — plus \`deploymentRollback\`, and \`deploymentPause\`, which
  stops a running workload. Say exactly what will be destroyed or stopped, then wait.
- **Re-running must be safe.** Check for an existing resource before creating one. The user
  may be resuming a half-built stack.
- **A tool error is real.** This API answers domain errors with HTTP 200 and \`ok:false\`; the
  MCP layer already converts those into tool errors. Do not retry an identical call hoping
  for a different answer — read the code and fix the input or ask.
- **Never echo secrets in a summary.** Database passwords, basic-auth passwords, service
  account keys: say where you put them, not what they are.`

const RESOURCE_MODEL = `Reference: what each Nortezh resource is, what it depends on, how you know it is ready,
and what can still be changed after it exists.

Read this when you are unsure what something *is* — as opposed to which call to make, which
the tool schemas already describe. Every claim here was checked against the API source.

## The dependency graph

Read an arrow as "must exist first".

\`\`\`
billing account ─▶ project ─┬─▶ env group ────┐
   (not a tool)             ├─▶ pull secret ──┼─▶ deployment ─┐
                            ├─▶ disk ─────────┘               ├─▶ route
                            ├─▶ domain ───────────────────────┘
                            └─▶ managed database   (feeds config only — no platform link)

cluster / location ─▶ deployment, disk, database, domain, route, pull secret
\`\`\`

A **route** is the only resource with two parents: a domain and a deployment.

⚠️ A **managed database is not connected to a deployment by the platform.** No foreign key,
no join table, nothing in the deployer. The only connection is the values you copy out of
\`db*Get\` into the deployment's configuration — so nothing stops a deployment pointing at a
database that was deleted, or at the wrong one.

## Project

**Is** a tenancy boundary: billing, membership, and the namespace most resource names are
unique within. Not one application — it holds **many** deployments, databases, disks, env
groups and domains.

- **Depends on:** an **active** billing account. \`projectCreate\` takes its \`billingId\`
  (a UUID), which you can read from \`projectGet\` or \`projectOverview\` on a project the user
  already has. Only if they have no project at all is this a console handoff.
- **Depended on by:** everything.
- **Ready:** immediately. Synchronous.
- **Mutable:** \`projectEdit\` changes the display name — ⚠️ **owner-only**; a non-owner gets
  \`PROJECT_NOT_FOUND\`, which looks like the project is missing. The **slug is the identity**
  every other call uses and cannot be changed.
- **Members:** \`projectListMember\` reads them; adding and removing are **not exposed**.
  ⚠️ The \`role\` it returns is meaningless — \`projectListMember\` reports \`"Owner"\` for every
  member and \`projectOverview\` reports \`"-"\`. The API accepts a role on add but never
  persists or enforces one, so every member is equivalent except the single owner.
- **Deleting** is not exposed. It is owner-only, a *soft* delete, and cascades **only**
  deployments — routes, disks, domains, databases, env groups and pull secrets are left
  behind.

## Cluster (a "location")

**Is** a place to run things. Every deployment, disk, database, domain, route and pull
secret names one, by the cluster's \`id\`.

- **Depended on by:** all of the above.
- **Ready:** always — you only ever list them.
- **Mutable:** not by you. Operator-managed; \`clusterList\` is the only route.
- ⚠️ **Pass \`projectSlug\` to \`clusterList\`.** Without it you get every enabled cluster,
  including ones this project's billing cannot use — and the create then fails with
  \`DEPLOYMENT_ACCESS_DENIED\` / \`DISK_ACCESS_DENIED\` / \`DATABASE_PROJECT_ACCESS_DENIED\`.
- **Carries:** the \`cpu\` and \`memory\` lists (resource requests must be exact string members
  of them), \`features\` (a capability hint, **not** the gate), and \`isTrial\` (a property of
  the cluster — "accepts trial workloads" — not of the caller's billing).
- ⚠️ **Nothing moves between locations.** Changing where something runs is delete and
  recreate.

## Deployment

**Is** a running workload — the thing that serves your code.

- **Depends on:** a project and a cluster. Optionally an env group, a disk, a pull secret.
- **Depended on by:** routes. ⚠️ **Deleting a deployment silently deletes its routes** — the
  FK cascades, there is no in-use check and no warning.
- **Ready:** \`deploymentGet\` until \`actionStatus\` is the **string** \`"success"\`; \`"failed"\`
  is a real outcome.
- **Mutable:** most things, via \`deploymentDeploy\` — which always requires \`project\`,
  \`location\`, \`name\` **and \`image\`**, even for a one-field change.
- ⚠️ **Immutable: \`type\`.** Written at create, never updated. A \`WebService\` cannot become a
  \`Worker\` — delete and recreate.
- ⚠️ **Fields that destroy rather than patch:**
  - \`env\` **when supplied** replaces the whole inline map. Omitting it is safe and keeps
    the stored one; use \`addEnv\` (upsert) and \`removeEnv\` (delete) to change single keys.
  - \`mountDataSecretPaths\` **when omitted** drops every secret-marked file's value. This is
    the one that bites on a patch.
  - \`envGroups: []\` unlinks every group; absent leaves them alone.
- **Four shapes**, by \`type\`: \`WebService\` (HTTP, the only thing a route can target),
  \`Worker\` (no ingress), \`CronJob\` (needs \`schedule\`), \`InternalTCPService\`
  (cluster-internal; needs a real \`port\` or it silently gets \`0\`).
- ⚠️ **\`deploymentGet.url\` is always populated but does not always resolve.** It is a bare
  hostname with no scheme, and an external ingress exists only for a **non-internal
  WebService**. A Worker, a CronJob, an InternalTCPService or a WebService with
  \`internal: true\` gets a URL string that serves nothing.
- \`internal: true\` on a WebService **deletes its external ingress** — the one field that
  silently takes a service off the internet.
- \`maxReplica\` tops out at **20**.

## Revision

**Is** a numbered snapshot of a deployment's spec. Not something you create — every deploy
makes one.

- **Depends on:** a deployment. No independent existence; deleted with it.
- **Depended on by:** nothing. \`deploymentRollback\` names one by number.
- **Ready:** no state of its own — the deployment's \`actionStatus\` is the answer.
- **Mutable:** no. A snapshot; deploying again makes a new one.
- ⚠️ \`deploymentRollback\` **rewinds** \`deployments.revision\` to an earlier number. It does
  **not** create a new revision, and does **not** restore env-group links or \`type\`. A
  partial undo.
- \`deploymentLogRevision\` lists them, which is how you find a number to roll back to.

## Env group

**Is** a named set of environment variables, shared by any deployment in the project that
lists it. The right home for values several services need.

- **Depends on:** a project.
- **Depended on by:** deployments listing it in \`envGroups\`. \`envgroupDelete\` is refused
  with **\`ENVGROUP_LINKED\`** while any still does; \`envgroupGet.linkedDeployments\` names
  them.
- **Ready:** immediately. Synchronous.
- **Mutable:** ⚠️ \`envgroupUpdate\` **replaces the whole map** — any key left out is deleted,
  and omitting \`data\` empties the group. Read with \`envgroupGet\`, change, send it all back.
  The **name is immutable** (lowercase, 3–27 chars).
- ⚠️ **Plain text, never masked.** The API says it outright: do not put real secrets in one.
- ⚠️ **Baked at deploy time.** Editing a group does not change a running deployment until it
  is redeployed.

## Disk

**Is** persistent storage, mounted into a deployment at a path. \`size\` is in **MB**.

- **Depends on:** a project and a cluster. Gated on the **billing account's** disk feature —
  a refusal is \`ACCESS_DENIED\`.
- **Depended on by:** any number of deployments — a disk is **not exclusive**.
- **Ready:** \`diskGet\` until \`actionStatus\` is the **number \`2\`**. No failure value — a
  stuck disk sits at \`1\` forever.
- **Mutable:** \`diskUpdate\` **grows** it. Shrinking fails \`DISK_CANNOT_DECREASE_SIZE\`.
  Location and name are fixed.
- ⚠️ **\`DISK_IN_USE\` does not protect you.** The in-use check reads **only**
  \`extraDiskMountData\`; a deployment mounting the disk through the primary
  \`disk: {name, mountPath, subPath}\` field is invisible to it and to
  \`diskGet.bindingDeployments\`. So \`diskDelete\` will delete a disk out from under a running
  workload without complaint. **Before deleting a disk, check every deployment's \`disk\`
  field yourself.**
- If a disk is attached, send both \`minReplica\` and \`maxReplica\`. Omitting \`maxReplica\`
  trips a guard; note the guard does **not** catch a genuine \`min=1,max=3\` autoscaler, which
  will happily put several pods on one read-write-once volume.

## Managed database (Postgres / Redis / Mongo)

**Is** a provisioned database instance. Its connection details are the point.

- **Depends on:** a project, and a cluster whose \`cluster_enabled_features\` allow databases
  — a different table from \`clusterList\`'s \`features\`, so that can look fine and the create
  still fail with \`DATABASE_CLUSTER_NOT_SUPPORTED\`.
- **Depended on by:** nothing structurally. See the warning under the graph.
- **Ready:** \`db*Get\` until \`actionStatus\` is the **number \`2\`** *and* \`host\` is non-empty.
  \`host\` and \`port\` are empty strings until then. No failure value.
- **Mutable:** nothing. No resize, no password rotation, and the image is fixed by the
  platform (\`postgres:16\`, \`redis:8\`, \`mongo:8.2\`). Getting it wrong means create another
  and migrate.
- ⚠️ **You supply the password at create**, and \`db*Get\` returns it in plain text forever.
- **Sizes are required and bounded:** cpu **0.5–4** cores, memory **256–4096** MiB, plus
  \`storageSize\` in MB.
- ⚠️ **The engines return different fields.** All three give \`host, port, password,
  storageSize, cpu, memory\`. Postgres adds \`user\` and \`database\`; Mongo adds \`user\` only;
  Redis adds neither.
- ⚠️ **Names collide across engines** — a Postgres called \`cache\` blocks a Redis called
  \`cache\` in the same project.

## Pull secret

**Is** registry credentials, so the cluster can pull a private image.

- **Depends on:** a project and a cluster.
- **Depended on by:** deployments naming it in \`pullSecret\`. Nothing stops you deleting one
  that is still referenced — the next pull just fails.
- **Ready:** \`pullsecretGet\` — \`status\` is the **number \`2\`**, same shape as disk.
- **Mutable:** nothing; there is no update route. Rotate by creating another.
- ⚠️ Names are unique per **(project, location)** — the same name can exist twice in one
  project, in different locations.
- Needs \`serverUrl\`, \`username\`, \`password\`. \`pullsecretGet\` returns them decoded, so
  anyone who can read the project can read the credentials.

## Domain

**Is** a custom hostname registered to a project. Registering it does **not** route anything
— that is what a route does.

- **Depends on:** a project and a cluster.
- **Depended on by:** routes. Refused with \`DOMAIN_IN_USED\` while a route in that location
  still needs it, and \`DOMAIN_CAN_NOT_DELETE\` while it is pending. ⚠️ Deleting a domain that
  does not exist **returns success**.
- **Ready:** \`status\` is a **string** — \`pending\`, \`success\`, \`error\`, \`verify\`.
  ⚠️ **\`error\` is a real outcome**, so a domain is the one non-deployment resource that can
  fail. A **non-CDN** domain is written \`success\` at create with an empty \`verification\`
  object — nothing to verify and nothing to poll. Only \`cdn: true\` is asynchronous.
- **Mutable:** nothing. Delete and recreate.
- ⚠️ **Domains are globally unique across the whole platform.** \`DOMAIN_NOT_AVAILABLE\` can
  mean someone else's project already registered it.
- \`cdn\` defaults to \`false\`; \`cdn: true\` is billing-feature-gated and rejected outright for
  a trial account. \`wildcard: true\` on \`example.com\` lets routes be made for
  \`api.example.com\` without registering that separately.
- \`domainGet.dnsConfig\` carries **one CNAME**; \`ipv4\` and \`ipv6\` are always empty. The cname
  value differs by the \`cdn\` flag — always read it, never write one from memory.

## Route

**Is** the mapping that sends traffic for a domain and path to a deployment. What actually
makes a custom domain serve.

- **Depends on:** a deployment, and normally a registered domain — ⚠️ but
  \`skipDomainVerify: true\` bypasses the ownership check entirely, so a route can exist for a
  domain nobody registered. It exists for tests; do not set it.
- **Ready:** \`routeGet\` until \`status\` is the **number \`2\`**. No failure value.
- **Mutable:** nothing — delete and recreate.
- ⚠️ \`target\` is a **URI**: \`deployment://<name>\`. A bare name fails validation.
- ⚠️ Only a \`WebService\` can be a target — anything else is \`CAN_MAP_ONLY_WEB_SERVICE\`.
- ⚠️ **\`(domain, path)\` is globally unique**, not per project.
- \`path\` must start with \`/\`. \`config.rewritePath\` rewrites before proxying, and
  \`config.basicAuth\` adds HTTP basic auth — returned in plain text by \`routeGet\`.
- Every deployment already has a hostname without any route; routes and domains are only for
  custom ones.

## Service account (not exposed here)

**Is** a non-expiring credential for programmatic access — what CI should authenticate with,
since user tokens last 7 days. It is a user row with an email of the form
\`<slug>@<project>.service-account.nortezh.com\`, which is why it can be a project member.

- **Depends on:** a project, and **membership of it**. ⚠️ Without membership every call fails
  with a code that reads like the resource is missing: \`PROJECT_NOT_FOUND\` on project,
  database, disk, envgroup, route and pullsecret routes; \`DEPLOYMENT_PROJECT_ACCESS_DENIED\`
  on deployment routes; \`CLUSTER_PROJECT_NOT_FOUND\` then \`FORBIDDEN\` on cluster; and on
  domain routes \`PROJECT_NOT_FOUND\` when the slug does not exist, \`FORBIDDEN\` when it does
  but the caller is not a member.
- **Depended on by:** nothing in the platform — but any CI using its key breaks when it goes.
- **Ready:** immediately. Synchronous.
- **Mutable:** the account, no. Keys are added and revoked independently, up to 10.
- Keys are created separately from the account and readable in full afterwards, so having an
  account is not having a key.
- **Creating one is a console handoff** — these tools are deliberately not exposed.

## Things that are true everywhere

- **Most names are unique within a project** — but ⚠️ **domains and \`(domain, path)\` routes
  are globally unique across the platform**, pull secrets are unique per
  (project, location), and database names collide across engines.
- **A domain error is HTTP 200 with \`ok:false\`.** The MCP layer already converts those into
  tool errors — if a call errors, it really failed.
- **Only deployments and domains can report failure.** Database, disk, route and pull secret
  report a bare integer \`1\` = pending, \`2\` = success, with no failure value at all, so
  anything stuck sits at \`1\` indefinitely. Bound those waits and report.
- **Nothing moves between projects or locations.** Both mean delete and recreate.
- **Deletes are quieter than you expect.** A deployment takes its routes with it, a project
  delete leaves most of its resources behind, deleting a missing domain succeeds, and
  \`DISK_IN_USE\` misses the common kind of disk mount.`

export const PROMPTS: PromptSpec[] = [
  {
    name: 'deploy-stack',
    description:
      'Set up an application stack on Nortezh: interviews you for every choice, then creates only what you need — database or disk, env config, the deployment, custom domain and route, and a GitHub Actions workflow for continuous deploys.',
    arguments: [
      { name: 'project', description: 'Project slug, if you already know it' },
      { name: 'name', description: 'Deployment name, e.g. api or web' },
      { name: 'image', description: 'Container image including tag, if it already exists' },
      { name: 'location', description: 'Cluster location; ask clusterList if unsure' },
      { name: 'domain', description: 'Custom domain to attach, if any' },
      { name: 'repo', description: 'GitHub repo (owner/name) to wire continuous deploys for' },
    ],
    // The resource model is INLINED, not referenced. An MCP prompt cannot fetch another
    // prompt — prompts are user-invoked slash commands and the model has no prompts/get —
    // so "read the resources prompt if unsure" was advice it could never act on. Composing
    // the one constant into both surfaces keeps a single source and no drift.
    //
    // ONE pass over both tokens, not two chained replaces. Two passes let the first
    // substitution's OUTPUT become the second's subject, so an argument value of literally
    // "{{RESOURCE_MODEL}}" got expanded — splicing the whole reference into the user-said
    // block and leaving the real placeholder unfilled.
    //
    // The replacer is a FUNCTION, not a replacement string: String.replace interprets `$&`,
    // "$`", `$'` and `$n` in a replacement string, so a value containing one of those would
    // splice pieces of the template back into the output.
    render: (args) =>
      DEPLOY_STACK.replace(/\{\{(GIVEN|RESOURCE_MODEL)\}\}/g, (_match, token: string) =>
        token === 'GIVEN' ? given(args) : RESOURCE_MODEL,
      ),
  },
  {
    name: 'resources',
    description:
      "Reference for Nortezh's resource model: what each resource is, what it depends on, how to tell it is ready, and what can still be changed after it exists.",
    arguments: [],
    render: () => RESOURCE_MODEL,
  },
]
