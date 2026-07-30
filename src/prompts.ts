// MCP prompts — guided workflows that ship with the server.
//
// Prompts are the native way to bundle a "skill" with an MCP server: the client lists
// them over `prompts/list` and surfaces them as slash commands (in Claude Code,
// `/mcp__nortezh__deploy-stack`). Nothing to install beyond `claude mcp add`, and it works
// in any MCP client rather than only Claude Code.
//
// The content here is the part the tool schemas cannot carry: the ORDER things must happen
// in, which failures are expected rather than wrong, and the steps that leave this API
// entirely (DNS records, GitHub secrets). Everything about a single call's shape already
// comes from the generated schemas — do not restate it here, it only goes stale.

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
    return 'The user gave no details up front. Ask for the missing ones as you reach them, one step at a time — do not front-load a questionnaire.'
  }
  return `The user has already told you:\n${known.join('\n')}\n\nAsk for the rest as you reach them; do not re-ask for these.`
}

const DEPLOY_STACK = `You are setting up a complete application stack on Nortezh using the \`nortezh\` MCP tools.

{{GIVEN}}

## How to run this

Work through the stages below **in order**, because each depends on the last. Before every
stage, check what already exists (\`deploymentList\`, \`domainList\`, \`routeList\`,
\`dbPostgresList\`, \`envgroupList\`) and skip anything already in place — this flow must be
safe to re-run on a half-built stack.

Report what you did at the end of each stage in one or two lines. Stop and ask if a stage
fails for a reason not listed below.

## 0. Project and location

- \`projectList\` to find the project. If none matches, ask before \`projectCreate\` — a project
  is a billing and membership boundary, not a folder.
- \`clusterList\` gives the valid \`location\` values. **Never invent one**; every later call
  takes the same \`location\` and a wrong one fails as \`DEPLOYMENT_CLUSTER_NOT_FOUND\`.
- Trial billing cannot use every cluster (\`DEPLOYMENT_CLUSTER_NOT_SUPPORT_TRIAL\`) and cannot
  create a CDN domain. If that appears, say so plainly rather than retrying elsewhere.

## 1. Data stores, before the app

Anything the app connects to must exist first, so its connection details can go into the
env group in stage 2.

- Managed databases: \`dbPostgresCreate\` / \`dbRedisCreate\` / \`dbMongoCreate\`. The password is
  **supplied by you at create time**, not generated — pick a strong one and show it to the
  user once. \`DATABASE_CLUSTER_NOT_SUPPORTED\` means the database feature is not enabled for
  that cluster, which is a platform setting, not something to work around.
- Persistent disks: \`diskCreate\`, then reference the disk by name in the deployment's
  \`disk\` field. A disk is bound to one location.
- Read connection details back with \`dbPostgresGet\` (etc). ⚠️ That returns the **password in
  plain text** — put it straight into the env group and do not repeat it in your summary.

## 2. Configuration

- \`envgroupCreate\` with a \`data\` object of key/value pairs, then link it from the deployment
  via \`envGroups\`. Prefer this to inlining \`env\` on the deployment: an env group is shared
  and can be updated (\`envgroupUpdate\`) without touching the deployment spec.
- Private registry? \`pullsecretCreate\` first, then pass its name as \`pullSecret\`.

## 3. The deployment

- \`deploymentCreate\` for a new one, \`deploymentDeploy\` to update an existing one. Both take
  the same body.
- \`type\` must be one of \`WebService\`, \`Worker\`, \`CronJob\`, \`InternalTCPService\`.
  ⚠️ An **empty string is not accepted** — send a real value or omit the field entirely.
  Same for \`protocol\` (\`none\`, \`http\`, \`https\`, \`h2c\`).
- \`CronJob\` needs \`schedule\`. \`WebService\` needs \`port\`.
- Then **poll \`deploymentGet\` until \`actionStatus\` is no longer \`pending\`.** It becomes
  \`success\` or \`failed\`. Do not move on while it is pending, and do not poll faster than
  every few seconds. The deployer reconciles asynchronously — the create call returning is
  not the app running.
- On \`failed\`, read \`logUrl\` / \`statusUrl\` from \`deploymentGet\` and report them.
  ⚠️ \`statusUrl\` is a 10-minute signed URL — fetch it fresh, never reuse an old one.

## 4. Exposure

Only if the user wants it reachable, and only for a \`WebService\` — \`routeCreate\` on any
other type fails with \`CAN_MAP_ONLY_WEB_SERVICE\`.

Every deployment already gets a URL without any of this; \`deploymentGet\` returns it as
\`url\`. Routes and domains are for a **custom** domain.

1. \`domainCreate\` registers the domain.
2. \`domainGet\` returns what the user must add at their DNS provider:
   - \`dnsConfig\` — the \`cname\` / \`ipv4\` / \`ipv6\` records pointing the domain at Nortezh
   - \`verification.ownership\` — a \`{type, name, value}\` record proving they own it
   - \`verification.ssl\` — DCV records for the certificate; \`pending: true\` means not yet issued
   Present these as a table. **This step is not something you can do for them** — stop, show
   the records, and wait until they confirm the records are live.
3. \`routeCreate\` maps \`domain\` + \`path\` to the deployment (\`target\`).
   ⚠️ Do **not** set \`skipDomainVerify\`. It exists for tests; using it claims routing for a
   domain nobody has verified.
4. Re-check \`domainGet\` until \`status\` reports verified.

## 5. Continuous deployment from GitHub

Nortezh's own CI/CD binding (\`cicd.*\`) records a repo↔deployment link but **does not build
or deploy anything yet**, and those tools are not exposed here. So set up a normal GitHub
Actions workflow that calls this API directly.

The credential must outlive a login: user bearer tokens expire after 7 days. Use a
**service account key**, which does not expire. Those tools are deliberately not available
to you, so hand the user these steps:

1. In the Nortezh console, under the project's Service Accounts: create one, then create a
   key and copy the value.
2. In the GitHub repo, add secrets:
   - \`NORTEZH_SA_EMAIL\` — the service account's email
   - \`NORTEZH_SA_KEY\` — the key
   - plus whatever the image registry needs.
3. Also make the service account a member of the project if it is not already.

Then write \`.github/workflows/deploy-<name>.yaml\` into their repo:

\`\`\`yaml
name: Deploy <name>
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docker/login-action@v3
        with:
          registry: <registry>
          username: \${{ secrets.REGISTRY_USERNAME }}
          password: \${{ secrets.REGISTRY_PASSWORD }}

      - uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          push: true
          tags: <registry>/<image>:\${{ github.sha }}

      - name: Deploy to Nortezh
        run: |
          curl -sS -X POST https://api.nortezh.com/user/deployment.deploy \\
            -u "\${{ secrets.NORTEZH_SA_EMAIL }}:\${{ secrets.NORTEZH_SA_KEY }}" \\
            -H 'Content-Type: application/json' \\
            -d '{
                  "project": "<project>",
                  "location": "<location>",
                  "name": "<name>",
                  "image": "<registry>/<image>:\${{ github.sha }}"
                }' | tee /tmp/deploy.json
          # Domain errors come back as HTTP 200 with ok:false, so curl alone cannot
          # detect them — check the envelope explicitly or the job passes on failure.
          grep -q '"ok":true' /tmp/deploy.json
\`\`\`

Fill every \`<placeholder>\` with the real values from the stages above. Keep the \`grep\` — it
is the only thing that makes a failed deploy fail the build.

## Ground rules

- **Never invent an identifier.** Project slugs, locations, disk names, env group names and
  image tags all come from a list call or from the user.
- **Confirm before anything destructive.** \`deploymentDelete\`, \`diskDelete\`, \`domainDelete\`,
  \`db*Delete\`, \`deploymentRollback\` — say what will be destroyed and wait.
- **A tool error is real.** This API answers domain errors with HTTP 200 and \`ok:false\`; the
  MCP layer already converts them into tool errors. If a call errors, believe it — do not
  retry the identical call hoping for a different answer.
- **Do not echo secrets in your summary** — database passwords, basic-auth passwords, keys.
  Say where they were put, not what they are.`

export const PROMPTS: PromptSpec[] = [
  {
    name: 'deploy-stack',
    description:
      'Deploy a full application stack on Nortezh: database, env group, deployment, custom domain + route, and a GitHub Actions workflow for continuous deploys.',
    arguments: [
      { name: 'project', description: 'Project slug, if you already know it' },
      { name: 'name', description: 'Deployment name, e.g. api or web' },
      { name: 'image', description: 'Container image to deploy, including the tag' },
      { name: 'location', description: 'Cluster location; ask clusterList if unsure' },
      { name: 'domain', description: 'Custom domain to attach, if any' },
      { name: 'repo', description: 'GitHub repo (owner/name) to wire continuous deploys for' },
    ],
    render: (args) => DEPLOY_STACK.replace('{{GIVEN}}', given(args)),
  },
]
