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

And before all three: **read the repository.** The service topology, the ports, the
dependencies and the environment variables are already written down in the code. Deriving
them and confirming beats asking a stranger to recite their own architecture.

---

# Stage A — Establish what is actually being asked

## A0. Understand the project before you touch Nortezh

**Read the codebase first.** Nearly every question below is already answered in the repo,
and a question the code answers is a question you should not be asking. Work it out, then
show the user what you concluded and let them correct it — that is far better than an
interrogation, and far better than guessing.

What to read, and what it tells you:

| look at | tells you |
|---|---|
| \`docker-compose.yml\` | the whole service topology in one file: every service, its ports, and its \`postgres\` / \`redis\` / \`mongo\` dependencies |
| \`Dockerfile\` / \`build/*/Dockerfile\` | how each service builds, and \`EXPOSE\` gives you the port |
| \`.env.example\`, \`.env.sample\`, \`config.example.*\` | the exact environment variables the app expects, which becomes the env group |
| \`package.json\`, \`go.mod\`, \`pyproject.toml\`, \`Cargo.toml\` | the language, and whether it is a monorepo with several deployable pieces |
| \`.github/workflows/\` | whether CI already exists, and which registry they already push to |
| \`README\` | how the author says to run it, and any external dependency the code does not show |
| \`Procfile\`, \`Makefile\`, \`k8s/\`, \`helm/\` | existing deploy intent — worker processes, cron jobs, replica counts |

From that, work out and then **confirm with the user**:

- **How many deployable units?** A monorepo with \`api\`, \`worker\` and \`web\` is three
  deployments, not one. Ask which are in scope now — deploying all of them is rarely the
  request.
- **The type of each.** An HTTP server is a \`WebService\`; a queue consumer with no listening
  port is a \`Worker\`; something invoked on a schedule is a \`CronJob\`; a service only its
  siblings talk to is \`InternalTCPService\` or \`internal: true\`.
- **The port each one listens on** — from \`EXPOSE\`, the compose \`ports:\`, or the code.
- **What each depends on.** A \`postgres\` service in compose means the deployed version needs
  a database — managed, or one that already exists. Redis for cache or queues. A volume in
  compose usually means a disk.
- **Which env vars are configuration and which are secrets**, from \`.env.example\`.
- **Whether services talk to each other**, and therefore which need an internal address
  rather than a public one.

Present this back as a short summary — "three services, \`api\` on 8080 needs Postgres,
\`worker\` needs the same Postgres and Redis, \`web\` on 3000 is public" — and ask what to do
with it. Do not proceed on your reading alone; the repo shows what exists locally, not what
they want deployed.

If there is no repo in context — the user is working from an image, or only wants to change
something already running — skip this and go to A1.

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

1. \`domainCreate\`.
2. \`domainGet\` returns what the user must add at their DNS provider:
   - \`dnsConfig\` — \`cname\` / \`ipv4\` / \`ipv6\` records pointing at Nortezh
   - \`verification.ownership\` — \`{type, name, value}\` proving they own it
   - \`verification.ssl\` — DCV records; \`pending: true\` means the certificate is not issued
   Present them as a table. **You cannot do this step for them** — stop, show the records,
   wait for confirmation that they are live.
3. \`routeCreate\` maps \`domain\` + \`path\` to the deployment (\`target\`).
   ⚠️ Never set \`skipDomainVerify\`. It exists for tests, and using it claims routing for a
   domain nobody verified.
4. Re-check \`domainGet\` until it verifies.

## B5. Continuous deployment

Nortezh's own CI/CD binding (\`cicd.*\`) records a repo↔deployment link but **does not build
or deploy anything yet**, and those tools are not exposed here. So wire a normal GitHub
Actions workflow: build and push the image, then deploy it with the official
\`Nortezh/nortezh-action\`.

### First, walk the user through the setup — they must do all of it

**None of this is callable from here.** Service-account tools are deliberately not exposed,
so you cannot check whether one exists, cannot create one, and cannot read a key. Ask, then
wait for confirmation at each step. Do not write the workflow file until all of it is done —
a workflow whose secrets do not exist yet fails on its first run and wastes a build.

**Step 1 — the Nortezh service account.** This is the credential the deploy step uses. It
must be a service account, not a login: user bearer tokens expire after 7 days, service
account keys do not.

Ask first: *do you already have a service account for this project?* Offer the real
possibilities — an existing one they will reuse, or a new one — plus free text for a name.

- **If they do not have one:** in the Nortezh console, open this project's Service Accounts
  and create one. It gets an email of the form \`<slug>@<project>.service-account.nortezh.com\`.
- **If they do:** they still need a key if they do not have the value saved — keys are
  created separately from the account.
- Then create a key on that service account and copy the value. It is shown in full and is
  never recoverable from anywhere else in a form you should paste around; treat it exactly
  like a password.
- ⚠️ Confirm the service account is a **member of this project**. If it is not, every call
  it makes comes back \`PROJECT_NOT_FOUND\`, which reads like the project is missing rather
  than like a permissions problem, and costs real time to diagnose.

**Step 2 — put it in GitHub.** In the repo, *Settings → Secrets and variables → Actions →
New repository secret*, add two:

| secret | value |
|---|---|
| \`NORTEZH_SA_EMAIL\` | the service account's email from step 1 |
| \`NORTEZH_SA_KEY\` | the key value from step 1 |

The workflow maps these into \`SA_AUTH_EMAIL\` / \`SA_AUTH_KEY\`, which is what
\`Nortezh/nortezh-action\` reads. Keep the secret names as written unless the user wants
otherwise — then change them in both places.

**Step 3 — a container registry the cluster can pull from.** The house pattern is Google
Artifact Registry, which needs:
- an Artifact Registry Docker repository, e.g. \`asia-southeast1-docker.pkg.dev/<gcp-project>/<repo>\`
- a **Google** service account (separate from the Nortezh one) with Artifact Registry Writer
- a JSON key for it, stored as the GitHub secret **\`GOOGLE_CREDENTIALS\`** — the whole JSON

Ask which registry they actually use. If it is GHCR or Docker Hub rather than Artifact
Registry, the auth and login steps are different — adapt them instead of forcing this shape,
and remember a private registry also needs a \`pullsecretCreate\` on the Nortezh side so the
cluster can pull.

**Step 4 — the Dockerfile path and the branch** that should trigger a deploy.

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
