---
name: softbox-setup
description: Set up a fresh local Softbox checkout end to end. When helping a user, walk them through each env var, tell them exactly where to go in Convex or Cloudflare, and verify each step before moving on.
---

# Softbox Setup

Use this guide for a fresh local Softbox install.

If you are an AI agent helping a human:
- walk the user step by step
- when a step requires dashboard work, tell them exactly what to click
- when a step fills `.env.local`, tell them exactly which value goes into which env var
- do not skip verification steps

This is the file to give to an AI agent for installation. `AGENTS.md` and
`CLAUDE.md` are operating instructions for agents after they are inside the
repo; they are not the full install guide.

This guide keeps the current Softbox architecture:
- Convex for control plane state
- Artifact storage via Cloudflare R2 or MinIO for build artifacts
- Redis for BullMQ queue state
- OpenClaw for code editing

## AI-Assisted Install Prompt

Use this prompt with a coding agent after cloning the repo:

```text
Use SETUP.md as the source of truth. Set up this Softbox checkout end to end.
Do not skip verification. Explain each dashboard step before asking me to do it.
When editing .env.local, tell me exactly which value goes into which variable.
```

The agent should not invent a new setup path. It should follow this file,
verify with `pnpm run doctor`, and only then start Softbox.

## 1. Prerequisites

Install these first:

- Node.js 20+
- `pnpm`
- Docker Desktop or Docker Engine
- an OpenClaw CLI install that is already authenticated locally
- a Convex account
- a Cloudflare account with R2 access if you plan to use R2 instead of local MinIO

## 2. Clone And Install

```bash
git clone https://github.com/softbox-hq/softbox.git
cd softbox
pnpm install
pnpm run bootstrap
```

Use `pnpm run bootstrap`, not `pnpm setup`. `setup` is a pnpm built-in command,
so the repo bootstrap script must be run through `run`.

What `pnpm run bootstrap` does:

- creates `.env.local` from `.env.example` if missing
- generates a checkout-scoped `OPENCLAW_AGENT_ID_PREFIX` when that field is blank
- starts Redis with Docker if Docker is available
- starts MinIO too when `.env.local` is using the local MinIO artifact-storage mode
- when local MinIO is configured, creates the bucket, enables public reads, and writes the probe object Softbox checks

`pnpm run bootstrap` does not finish the whole install. You still need to fill `.env.local`.

Do not run `pnpm start` until `pnpm run doctor` has no blocking issues.

## 3. Fill Convex Env Vars

Open `.env.local`.

You need to fill these two env vars with the same Convex deployment URL:

```env
VITE_CONVEX_URL=
CONVEX_URL=
```

How to get the value:

1. If the Convex CLI is not logged in yet, run:

```bash
pnpm exec convex login --no-open --login-flow poll --device-name softbox-local
```

Human action required: open the printed Convex device URL, approve the code,
and wait for the CLI to say it saved credentials.

2. In the repo root, run:

```bash
pnpm exec convex dev --once --tail-logs disable
```

If the CLI needs project configuration, run the same command in an interactive
terminal or use:

```bash
pnpm exec convex dev --once --tail-logs disable --configure existing
```

Then choose the intended project and choose a cloud dev deployment.

3. If Convex asks what to do:
- choose `create a new project` for a brand new setup
- or choose an existing project if you already have one

Human action required: choose/create the Convex project in the CLI prompt. For a
durable VM install, prefer a cloud dev deployment instead of a purely local
Convex deployment.

4. Finish the Convex prompt flow.

5. Convex will print or configure a deployment URL in the form:

```text
https://<your-deployment>.convex.cloud
```

6. Put that exact same value into both:
- `VITE_CONVEX_URL`
- `CONVEX_URL`

Important:
- these are intentionally duplicated because the browser shell reads `VITE_CONVEX_URL` and the worker reads `CONVEX_URL`
- they should point to the same deployment
- do not include a trailing slash

Correct:

```env
VITE_CONVEX_URL=https://keen-echidna-470.convex.cloud
CONVEX_URL=https://keen-echidna-470.convex.cloud
```

Wrong:

```env
VITE_CONVEX_URL=https://keen-echidna-470.convex.cloud/
CONVEX_URL=https://keen-echidna-470.convex.cloud/
```

Why this matters: the Convex HTTP client appends `/api/query`; a trailing slash
can turn that into `//api/query`, which can fail with a blank 404.

## 4. Fill Artifact Storage Env Vars

Softbox supports two artifact storage modes:

- `ARTIFACT_STORAGE_PROVIDER=minio`
- `ARTIFACT_STORAGE_PROVIDER=r2`

Fresh clones now default to local MinIO in `.env.example` because it is the easiest way to get a Debian or VM setup running. Switch to R2 only when you want Cloudflare-backed artifact storage.

### 4A. MinIO

The default `.env.example` values already point at the local Docker Compose MinIO instance:

```env
ARTIFACT_STORAGE_PROVIDER=minio
MINIO_S3_API=http://127.0.0.1:9000/softbox-artifacts
MINIO_PUBLIC_DEVELOPMENT_URL=http://127.0.0.1:9000/softbox-artifacts
MINIO_ACCESS_KEY_ID=softbox
MINIO_SECRET_ACCESS_KEY=softboxminio
```

If you keep those values, `pnpm run bootstrap` plus Docker is enough for local artifact storage.

### 4B. Cloudflare R2

Set this in `.env.local`:

```env
ARTIFACT_STORAGE_PROVIDER=r2
```

Open the Cloudflare dashboard at `https://dash.cloudflare.com/`.

Go to:
- `R2`
- `Overview`

### 4.1 Create the bucket

1. Click `Create bucket`.
2. Enter a bucket name.
3. Example:

```text
softbox-r2
```

4. Leave region/storage class defaults unless you have a specific reason to change them.
5. Click `Create bucket`.

### 4.2 Fill `S3_API`

1. Open the bucket you just created.
2. Click the `Settings` tab.
3. Find the field labeled `S3 API`.
4. Copy the full value exactly as shown.

Expected format:

```text
https://<account-id>.r2.cloudflarestorage.com/<bucket>
```

Example:

```text
https://8aa22264876d9a006b7ede7b002e53d8.r2.cloudflarestorage.com/softbox-r2
```

5. Put that exact value into `.env.local`:

```env
S3_API=https://<account-id>.r2.cloudflarestorage.com/<bucket>
```

Do not split this into endpoint and bucket. Softbox now expects the exact dashboard value in one env var.

### 4.3 Fill `PUBLIC_DEVELOPMENT_URL`

1. Stay on the same bucket `Settings` page.
2. Find `Public Development URL`.
3. Enable it if it is not already enabled.
4. Copy the exact URL shown there.
5. Put it into `.env.local`:

```env
PUBLIC_DEVELOPMENT_URL=https://<public-dev-url>
```

### 4.4 Set the bucket CORS policy

1. Stay in the bucket settings.
2. Find `CORS policy`.
3. Paste this JSON:

```json
[
  {
    "AllowedOrigins": [
      "*"
    ],
    "AllowedMethods": [
      "GET",
      "HEAD"
    ],
    "AllowedHeaders": [
      "*"
    ],
    "ExposeHeaders": [
      "ETag",
      "Content-Length"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

4. Save the policy.

Without this, preview mounts can fail with fetch/CORS errors.

### 4.5 Create an R2 API token

Go back to:
- `R2`
- `Overview`

On the right side, find:
- `Account Details`
- `API Tokens`

Then:

1. Click `Manage`.
2. Create a new token.
3. Give it a name.
4. Choose permissions that allow object read and write.
5. Scope it to the bucket you created.
6. Leave IP filtering empty unless you intentionally need it.
7. Create the token.

Cloudflare will show:
- `Access Key ID`
- `Secret Access Key`

Put them into `.env.local`:

```env
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
```

### 4C. Custom MinIO

If you want local S3-compatible storage instead of Cloudflare R2, set this in `.env.local`:

```env
ARTIFACT_STORAGE_PROVIDER=minio
```

Then fill these env vars:

```env
MINIO_S3_API=http://127.0.0.1:9000/<bucket>
MINIO_PUBLIC_DEVELOPMENT_URL=http://127.0.0.1:9000/<bucket>
MINIO_ACCESS_KEY_ID=
MINIO_SECRET_ACCESS_KEY=
```

Notes:

- `MINIO_S3_API` is the S3-compatible API URL including the bucket path
- `MINIO_PUBLIC_DEVELOPMENT_URL` is the public base URL the browser can fetch built artifacts from
- the bucket still needs to be readable by the shell browser at runtime

## 5. Fill OpenClaw Env Vars

Softbox uses OpenClaw through the local gateway.

These env vars should already exist in `.env.local`:

```env
AGENT_COMMAND=openclaw
OPENCLAW_GATEWAY_BASE_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=
OPENCLAW_AGENT_ID_PREFIX=
OPENCLAW_SESSION_KEY_PREFIX=softbox
```

Make sure `openclaw` is on `PATH`:

```bash
openclaw --version
```

If the command is missing but OpenClaw was installed globally through npm, check:

```bash
ls ~/.npm-global/bin/openclaw
```

Then either add `~/.npm-global/bin` to `PATH` or link it into a directory that
already is on `PATH`:

```bash
ln -sfn ~/.npm-global/bin/openclaw ~/.local/bin/openclaw
```

### 5.1 Get the gateway token

Run:

```bash
jq -r '.gateway.auth.token' ~/.openclaw/openclaw.json
```

That prints the raw gateway token from your local OpenClaw config.

Put it into `.env.local`:

```env
OPENCLAW_GATEWAY_TOKEN=<token>
```

This token is what lets Softbox talk to the local OpenClaw gateway.

### 5.2 Leave the prefix blank

Leave this blank:

```env
OPENCLAW_AGENT_ID_PREFIX=
```

Why:
- Softbox generates a checkout-scoped prefix during `pnpm run bootstrap` or `pnpm start`
- that prevents multiple local clones from pointing at the same OpenClaw agents

Do not invent your own shared prefix unless you intentionally want cross-checkout reuse.

### 5.3 Verify the gateway

Check status:

```bash
openclaw gateway status
```

If it is not healthy, try:

```bash
openclaw gateway run --port 18789 --verbose
```

If that says the port is already in use, a gateway is already running and the problem is not "gateway missing".

### 5.4 Optional: enable OpenClaw image generation

OpenClaw already exposes the `image_generate` tool when a provider is available.

For the default OpenAI path, put this in `.env.local`:

```env
OPENAI_API_KEY=<your-openai-api-key>
```

Softbox can also save this from the desktop OpenClaw panel.

If you want a non-OpenAI image provider, use the provider-specific env var instead:

```env
GEMINI_API_KEY=
GOOGLE_API_KEY=
FAL_KEY=
MINIMAX_API_KEY=
MINIMAX_OAUTH_TOKEN=
```

And make sure OpenClaw has a default image model configured, for example:

```bash
openclaw config set agents.defaults.imageGenerationModel '"openai/gpt-image-1"' --strict-json
```

If the gateway is already running, restart it after changing image-provider env vars so the new key is visible to OpenClaw tool calls.

## 6. Start Local Services

If `pnpm run bootstrap` did not already start it, run:

```bash
docker compose up -d redis minio
```

If Docker is installed but your user cannot access the Docker socket on Debian,
either add the user to the `docker` group and open a new shell, or start the
services with sudo:

```bash
sudo docker compose up -d redis minio
```

If you switched artifact storage to Cloudflare R2, you only need Redis locally:

```bash
docker compose up -d redis
```

With Cloudflare R2 and sudo-managed Docker:

```bash
sudo docker compose up -d redis
```

BullMQ runs inside the Softbox worker. Redis is the only extra service you need for the queue. MinIO is only for local artifact storage.

## 7. Validate The Setup

Run:

```bash
pnpm run doctor
```

Fix every blocking issue before continuing.

Warnings about unwrapped example apps are not necessarily blockers.

If doctor reports a missing OpenClaw agent, run:

```bash
pnpm worker:openclaw-sync-agents -- --apply
```

If that says there are no Convex app records yet, seed first and then sync:

```bash
pnpm seed -- --all --force
pnpm worker:openclaw-sync-agents -- --apply
```

On a first OpenClaw run, agent creation can take longer while OpenClaw installs
runtime/plugin dependencies. If sync times out, rerun the same command once.

## 8. Start Softbox

Run:

```bash
pnpm start
```

This starts:
- Convex
- the worker
- the shell

`pnpm start` also:
- auto-provisions the local MinIO bucket/probe if local MinIO is enabled
- auto-seeds wrapped apps that still have no live version unless you pass `--no-auto-seed`
- auto-syncs per-app OpenClaw agents unless you pass `--no-sync-agents`

The shell URL is usually:

```text
http://localhost:4173/
```

If port `4173` is busy, Vite will choose another port and print it.

## 9. Seed The First App

`pnpm start` now auto-seeds wrapped apps that still have no live version with
`--force`.

Use `pnpm seed` manually when you want to:
- reseed a specific app
- seed everything up front
- repair local Convex state explicitly

Manual command for a clean setup or repair:

```bash
pnpm seed -- --all --force
```

This clears old seeded state and artifact files before rebuilding from the
current app source.

Interactive command:

```bash
pnpm seed
```

This opens the interactive picker. Use it when you intentionally want to choose
a target and do not need to force-reset existing seeded state.

Choices:
- pick one wrapped app
- or choose `Seed all wrapped apps`

For automation:

```bash
pnpm seed -- --app <app-id> --force
pnpm seed -- --all --force
```

Notes:
- `pnpm seed` now auto-installs app-local dependencies when needed
- if you only want the quickest first success, seed one of the wrapped apps
  shown by `pnpm run doctor`

## 10. Final Verification

After startup:

1. Refresh the shell in the browser.
2. Confirm a wrapped app mounts.
3. Submit a simple prompt, for example:

```text
replace the current content with a centered div that says hello
```

4. Confirm the worker:
- claims the job
- invokes OpenClaw
- builds a new candidate
- uploads artifacts
- mounts preview successfully

## Resume Checklist

If setup was interrupted halfway, these commands are safe to rerun:

```bash
pnpm install
pnpm run bootstrap
pnpm exec convex dev --once --tail-logs disable
pnpm seed -- --all --force
pnpm worker:openclaw-sync-agents -- --apply
pnpm run doctor
```

Useful progress checks:
- `.env.local` exists
- `VITE_CONVEX_URL` and `CONVEX_URL` are both set to the same URL with no trailing slash
- `OPENCLAW_GATEWAY_TOKEN` is set
- Redis is reachable at `REDIS_URL`
- MinIO is reachable when `ARTIFACT_STORAGE_PROVIDER=minio`
- `openclaw agents list --json` shows the per-app agents after sync
- `pnpm run doctor` has no blocking failures

If Docker needs sudo on the VM, start Redis/MinIO manually with `sudo docker
compose up -d redis minio` before running `pnpm run doctor`.

## Common Problems

### `VITE_CONVEX_URL` or `CONVEX_URL` missing

You did not finish the Convex step.

Fix:
- run `pnpm exec convex dev`
- copy the deployment URL into both env vars
- remove any trailing slash from both URLs

### Convex calls fail with an empty error

Most common causes:
- the Convex functions have not been pushed to the deployment
- `VITE_CONVEX_URL` or `CONVEX_URL` ends with a trailing slash
- the checkout is not linked to the intended Convex project

Fix:
- run `pnpm exec convex login --no-open --login-flow poll`
- run `pnpm exec convex dev --once --tail-logs disable`
- if prompted, configure the intended existing project
- verify both Convex URLs in `.env.local` have no trailing slash

### Preview mount fails or says `Failed to fetch`

Most common causes:
- R2 CORS policy is missing
- `PUBLIC_DEVELOPMENT_URL` is wrong
- the automatic seed step failed or was skipped

Fix:
- verify the CORS JSON
- verify `PUBLIC_DEVELOPMENT_URL`
- rerun `pnpm start` or run `pnpm seed -- --all --force`

### OpenClaw gateway settings missing

Most common causes:
- `OPENCLAW_GATEWAY_TOKEN` is blank
- the gateway is not healthy
- `openclaw` is installed but not on `PATH`
- the worker is running from a different clone with stale state

Fix:
- verify `.env.local`
- run `openclaw --version`
- run `openclaw gateway status`
- restart `pnpm start`

### Expected OpenClaw agent is missing

Most common causes:
- `OPENCLAW_AGENT_ID_PREFIX` changed
- app records have not been seeded into Convex yet
- OpenClaw agents were not synced after a fresh setup

Fix:

```bash
pnpm seed -- --all --force
pnpm worker:openclaw-sync-agents -- --apply
pnpm run doctor
```

### Nothing shows up in the shell even though `/apps` exists

Putting files into `/apps` is not enough.

A Softbox-hosted app still needs:
- wrapping
- seeding
- Convex app state

Fix:
- run `pnpm wrap-app -- --path apps/<your-app>` if needed
- then rerun `pnpm start` or run `pnpm seed -- --all --force`

## Short Version

If you already know the services and only need the command order:

```bash
pnpm install
pnpm run bootstrap
# fill .env.local
pnpm run doctor
pnpm start
```
