---
name: nortezh
description: Use whenever the user mentions Nortezh — deploying, inspecting or changing anything on the Nortezh platform (projects, deployments, databases, disks, domains, routes, env groups, pull secrets), reading its state, reporting on it, or working out why something is failing. Routes to the right nortezh:* skill and carries the rules that hold regardless.
---

# Nortezh

Work on the Nortezh PaaS through the `nortezh` MCP tools. This file is always loaded once the
skill fires; everything else is pulled only when it applies.

## Load the one that fits

1. **`nortezh:resources` — always, before answering anything about Nortezh.**
   What each resource is, what it depends on, how you know it is ready, what can still be
   changed. Readiness is reported differently by nearly every resource, and only deployments
   and domains can report failure at all, so an answer given without this is usually wrong in
   a way that looks right.

2. **`nortezh:deployer` — before anything is created, changed or deleted.**
   The seven-step procedure, the plan template and the approval gate. Load it *before* you
   start, not after the first call fails.

3. **`nortezh:reporter` — to report on a project you did not just build.**
   What is running, what is pending, what is failing. Read-only.

4. **`nortezh:troubleshooter` — to work out why something is not doing what the user expects.**
   Read-only diagnosis; any fix goes back through `nortezh:deployer`.

A read-only question — "what is deployed?", "show me metrics" — needs only `nortezh:resources`.

## These hold whether or not you load anything else

⚠️ **Never build or push a container image.** Not `docker build`, not `docker push`, not a
Makefile target that wraps one. CI builds and pushes; the deployment is created pointing at
the tag CI will push and **fails until CI runs, on purpose**. A laptop build is unreviewed
and unreproducible, and pushing it needs a write credential that does not belong in this
conversation.

⚠️ **Never obtain, read or ask for a credential.** Not from the user ("paste your token"),
not from the machine (`gh auth token`, `~/.docker/config.json`, the keychain, a `.env`).
The user creates every credential themselves — pull secret in the console, registry key in
GitHub Secrets — and tells you only its **name**. Reading the repo is fine; reading credential
stores is not. The line is whether the file is checked in.

⚠️ **Nothing is created, changed or deleted before the user approves a written plan.**
Inventory and reads come first, then a plan, then explicit approval. See `nortezh:deployer`.

⚠️ **Never resolve a blocked step by weakening something else.** "I cannot create a pull
secret, so let's make the image public" trades a console step for permanently publishing the
application image. When a step is blocked, hand it to the user.
