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

## The three rules that matter most

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

And underneath all three: **understanding the user's project is the whole job.** Its
architecture, its service components, and above all **how each service is configured** —
that is what every resource you create is derived from. Get the shape of the system right
and the Nortezh calls are mechanical. Get it wrong and you will create real infrastructure
that is confidently, expensively wrong: a Worker exposed to the internet, a service pointed
at a database that is not the one it uses, a config value that was actually a secret.

Nothing below is worth doing until Stage A0 is done and the user has confirmed it.

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
- Names must be unique **within** the project, not globally: \`api\` in one project and \`api\`
  in another are unrelated.

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
  keys, signing secrets, tokens. These belong in an env group or in
  \`mountDataSecretPaths\`, never echoed back in a summary.
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

Ask this first, before anything else, unless the user already made it unambiguous:

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

- **Project** — from \`projectList\`. A new one is a billing and membership boundary, so
  confirm before \`projectCreate\`.
- **Location** — \`clusterList\`. Keep the whole response; you need three things from it:
  - \`cpu\` and \`memory\` are the **selectable sizes for that cluster** (e.g. \`"0.5"\`, \`"1"\`,
    \`"512Mi"\`, \`"1Gi"\`). Resource requests must be one of these exact strings or the deploy
    fails with \`DEPLOYMENT_INVALID_CPU\` / \`DEPLOYMENT_INVALID_MEMORY\`.
  - \`features\` says what the cluster supports. **A key is present when supported and absent
    when not** — \`"database": {}\` means managed databases work here; no \`database\` key means
    they do not. Same for \`disk\` and \`web-google-auth\`. Check this before offering either,
    rather than offering it and hitting \`DATABASE_CLUSTER_NOT_SUPPORTED\`.
  - \`isTrial\` — trial billing cannot use every cluster and cannot create a CDN domain.
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

Get this wrong and you will either move on too early or wait forever.

| resource | poll | ready when | fails when |
|---|---|---|---|
| deployment | \`deploymentGet\` | \`actionStatus\` is the **string** \`"success"\` | \`"failed"\` |
| database | \`dbPostgresGet\` / \`dbRedisGet\` / \`dbMongoGet\` | \`actionStatus\` is the **number \`2\`**, and \`host\` is non-empty | **never** — there is no failure value |
| disk | \`diskGet\` | \`actionStatus\` is the **number \`2\`** | **never** |

Database and disk \`actionStatus\` are bare integers — \`1\` = pending, \`2\` = success — and
have **no failed state at all**. So a database that never provisions stays at \`1\` forever.
Give those a bounded wait (a few minutes), then stop and tell the user rather than looping.

Deployment \`actionStatus\` is a *string* and does have \`"failed"\`. Never compare the two
kinds the same way.

Poll every few seconds, not faster.


## B1. Data stores — reuse first, create only if there is nothing to reuse

**Reusing one is the normal case.** If A2 turned up a database the user wants to use, there
is nothing to create here: \`dbPostgresGet\` (etc) gives you \`host\`, \`port\`, \`user\`,
\`database\` and \`password\`, and those go into the configuration in B2. Skip to B2.
The same applies to a disk that already exists — just reference it by name.

Creating a new one:

- \`dbPostgresCreate\` / \`dbRedisCreate\` / \`dbMongoCreate\`. **You supply the password**; it is
  not generated. Generate a strong one, show it to the user **once**, and put it straight
  into the env group.
- \`diskCreate\` for persistent storage. A disk belongs to one location and is mounted by
  exactly the deployment that references it.
- Wait for each per the table above. For a database the connection details (\`host\`, \`port\`)
  are **empty strings until it is ready** — that is precisely why this comes before the
  deployment.
- ⚠️ \`db*Get\` returns the password in plain text. Move it into config; do not repeat it in
  your summary.

## B2. Configuration

- \`envgroupCreate\` with a \`data\` object, then reference it by name in the deployment's
  \`envGroups\`. To change an existing group, \`envgroupUpdate\` — do not create a second one.
  Groups merge **in the order given**, later overriding earlier, and the deployment's own
  \`env\` / \`addEnv\` / \`removeEnv\` is overlaid last and always wins.
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

\`deploymentDeploy\` **is a patch.** Unset fields keep their current stored value, so send
**only what changes**. Do not read the deployment and echo the whole thing back; that turns
a one-field change into a diff you have to get entirely right.

- \`deploymentGet\` first, so you can show the user the current value next to the new one.
- Env vars are the exception to "unset means unchanged", and the distinction matters:
  - \`addEnv\` — upsert these keys, leave everything else alone
  - \`removeEnv\` — delete these keys
  - ⚠️ \`env\` — **replaces the entire inline env map wholesale.** Sending \`env\` with one pair
    deletes every other inline variable. For a patch, use \`addEnv\` / \`removeEnv\`. Only use
    \`env\` when the user genuinely means "these and nothing else".
- Every deploy creates a **new revision**, so a bad change is recoverable with
  \`deploymentRollback\` — mention that if the user hesitates.
- Then wait for \`actionStatus: "success"\` as usual.

### Creating a new one, when the image does not exist yet

Normal when CI has never run: **create with a public placeholder and correct it
afterwards.** This validates the plumbing, the cluster, the resource sizes and the env
wiring now, instead of after a ten-minute build fails on a typo.

1. \`deploymentCreate\` with \`image: "nginx:latest"\` and \`port: 80\`. Tell the user these are
   temporary and why.
2. Wait for \`actionStatus: "success"\`.
3. \`deploymentDeploy\` with the real \`port\`, env groups, disk mount, replicas and resources.
4. Wait again.

If the real image already exists, skip the placeholder and create with the real values.

Field rules worth knowing before you send anything:

- \`type\` defaults to \`WebService\` when omitted. An **empty string is rejected** —
  \`DEPLOYMENT_INVALID_TYPE\`. Send a real name or omit the field. Same for \`protocol\`
  (\`none\`, \`http\`, \`https\`, \`h2c\`), which applies only to \`WebService\`.
- \`port\` matters only for \`WebService\` and defaults to 80.
- \`schedule\` is required for \`CronJob\`, in crontab syntax.
- \`image\` must be a pinned reference and must not end in \`@\`.
- \`resource.requests.cpu\` / \`.memory\` must be values from **that cluster's** \`cpu\` /
  \`memory\` lists. \`resource.limits.memory\` is accepted but not applied anywhere — only
  \`limits.cpu\` is.
- \`disk\` mounts one disk as \`{name, mountPath, subPath}\`; \`extraDiskMountData\` maps extra
  file paths to \`{diskName, subPath}\`.
- \`internal: true\` keeps it off the public ingress, and is required for
  \`InternalTCPService\`.

On \`"failed"\`, read \`logUrl\` and \`statusUrl\` from \`deploymentGet\` and report them.
⚠️ \`statusUrl\` is a 10-minute signed URL — fetch a fresh one, never reuse an old one.

## B4. Exposure — WebService only

\`routeCreate\` against any other type fails with \`CAN_MAP_ONLY_WEB_SERVICE\`.

Every deployment already has a working URL; \`deploymentGet\` returns it as \`url\`. This
section is only for a **custom** domain.

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

**2. \`domainGet\`, then hand the records to the user.** It returns:

- \`dnsConfig\` — the \`cname\` / \`ipv4\` / \`ipv6\` records that point the domain at Nortezh.
  ⚠️ **The cname differs by \`cdn\` flag** — a CDN domain gets \`cname.nortezh.com\`, a non-CDN
  domain gets its own cluster's cname. So read the value out of \`domainGet\`; never write a
  hostname from memory or copy one from another domain.
- \`verification.ownership\` — \`{type, name, value}\`, proving they own the domain.
- \`verification.ssl\` — DCV records for the certificate. \`pending: true\` means it has not
  been issued yet.

**You cannot add these records — this is a handoff.** Give them the table and the one thing
that will otherwise bite them, and nothing else:

> Add these records at your DNS provider:
>
> | type | name | value |
> |---|---|---|
> | … | … | … |
>
> On Cloudflare, set each one to **DNS only** (grey cloud), not Proxied.
>
> Tell me when they are live.

Then stop and wait. Do not explain TLS termination, apex flattening or SSL modes unless
something goes wrong.

**Keep in reserve, for when they report a problem:**
- Proxied (orange cloud) breaks certificate issuance and commonly causes redirect loops,
  because Cloudflare terminates TLS itself while Nortezh also redirects HTTP to HTTPS. Grey
  cloud first, always. If they want the proxy afterwards it is a deliberate second step, and
  the SSL mode must be **Full (strict)**, never Flexible.
- The ownership and DCV records are TXT, which Cloudflare never proxies — nothing to set.
- At the zone apex Cloudflare flattens a CNAME automatically. Expected; do not switch them
  to the \`ipv4\` records over it.
- The proxy caches. If they enable it later and a deploy seems not to take effect, purge
  first.
- Other providers need the same records; only the UI differs. Ask about a provider-specific
  quirk rather than guessing at one.

**3. \`routeCreate\`** maps \`domain\` + \`path\` to the deployment (\`target\`).
⚠️ Never set \`skipDomainVerify\`. It exists for tests, and using it claims routing for a
domain nobody verified.

**4. Re-check \`domainGet\`** until it verifies. If it stays unverified for more than a few
minutes, the usual causes in order: the records were added to the wrong zone, Cloudflare's
proxy is on, or DNS has simply not propagated yet.

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
- ⚠️ If the service account is not a member of the project, every call it makes returns
  \`PROJECT_NOT_FOUND\` — which reads like the project is missing rather than like a
  permissions problem, and costs real time to diagnose.
- The workflow maps the two Nortezh secrets into \`SA_AUTH_EMAIL\` / \`SA_AUTH_KEY\`, which is
  what \`Nortezh/nortezh-action\` reads. Renaming the secrets means changing both places.
- GHCR or Docker Hub instead of Artifact Registry: the auth and login steps differ — adapt
  them rather than forcing this shape. A private registry also needs \`pullsecretCreate\` on
  the Nortezh side so the cluster can pull.

### Then write \`.github/workflows/deploy-<name>.yaml\`

Fill in every placeholder from the answers above — do not leave a single \`<...>\` behind.

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
- **Change the least you can.** \`deploymentDeploy\` patches, so send the fields that differ
  and nothing else.
- **Confirm before anything destructive.** \`deploymentDelete\`, \`diskDelete\`, \`domainDelete\`,
  \`db*Delete\`, \`deploymentRollback\`: say exactly what will be destroyed, then wait.
- **Re-running must be safe.** Check for an existing resource before creating one. The user
  may be resuming a half-built stack.
- **A tool error is real.** This API answers domain errors with HTTP 200 and \`ok:false\`; the
  MCP layer already converts those into tool errors. Do not retry an identical call hoping
  for a different answer — read the code and fix the input or ask.
- **Never echo secrets in a summary.** Database passwords, basic-auth passwords, service
  account keys: say where you put them, not what they are.`

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
    render: (args) => DEPLOY_STACK.replace('{{GIVEN}}', given(args)),
  },
]
