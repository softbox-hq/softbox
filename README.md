# Softbox

Softbox is a host system for mutable apps.

It lets an agent rewrite a Vite app, build a new immutable version, preview it inside a stable shell,
validate it, and only then promote it live.

Softbox is in the same general space as tools like Bolt.new, v0, and Lovable, but it is designed for
more control over the environment, the runtime, and versioned changes.

Softbox works together with OpenClaw.

OpenClaw is responsible for making code changes inside the hosted application. Softbox is responsible
for orchestrating the rest of the lifecycle: building, previewing, validating, versioning, and promoting
the app safely.

Softbox is optimized for React + Vite apps that can be mounted inside the shell.

Instead of using AI only to generate code in an editor, Softbox lets a coding agent modify a real hosted
app, build a new immutable version, preview it inside the shell, and only then promote it live.

## Example
Imagine you have a Vite app backed by SQLite.

That app stores customer data.

Once the app is mounted in Softbox, you can evolve the interface on demand.

Today, you might want to see the median acquisition cost of your customers. You ask Softbox for that
change, OpenClaw updates the app, and Softbox builds and previews the result before it goes live.

Tomorrow, you might want a geographic view of your customers instead. You ask for that, and Softbox
produces another version of the app.

You can keep both features if you want. But sometimes you want a different interface for a different
moment, and Softbox makes that kind of change practical.

If you want to go back to yesterday’s version, you can switch back to it directly, including by keyboard
shortcut.

Now imagine that this SQLite app is your CRM, `my-crm`, and you also have a separate support dashboard.

You can import the support dashboard into Softbox as another standalone app, mount it in the same shell,
and customize it the same way.

That means Softbox is not only about changing one app over time. It also lets you move between different
apps and different versions of those apps inside the same host system.


## Installation - automatic

Install this repository using ./SETUP.md by giving the file to the codex or claude code.

## Installation - manual


## What It Is

- Stable shell host built with React + Vite
- Worker pipeline that uses Codex SDK to mutate app code
- Convex as the control plane for jobs, versions, and runtime state
- Artifact storage via Cloudflare R2 or MinIO for immutable build artifacts
- Hosted apps that can behave like normal standalone apps, not just narrow plugins

## Core Idea

The shell is the operating system.

The inner app is the mutable program.

The flow is:

1. user submits a prompt in the shell
2. worker claims the job from Convex
3. agent edits the selected app source
4. worker builds a candidate bundle
5. artifacts are uploaded to R2
6. shell mounts the candidate in preview
7. shell promotes it only after it reports healthy

That keeps the shell stable while the hosted app changes underneath it.

## Repo Layout

- `shell/`
  browser host runtime and prompt UI
- `worker/`
  agent orchestration, build pipeline, upload, publish
- `convex/`
  schema and mutations for jobs, versions, files, and pipeline runs
- `apps/`
  standalone apps and wrap targets; a Softbox-hosted app needs `softbox.config.json`, `src/entry.tsx`, and `src/defaultState.ts`
- `chat-composer/`
  local design reference used while iterating on the shell composer
- `docs/`
  architecture, roadmap, positioning, and migration notes

## Quickstart

Requirements:

- Node.js 20+
- `pnpm`
- Docker (recommended for the local Redis + MinIO path)
- Convex project
- Artifact storage: Cloudflare R2 or MinIO
- Codex CLI/auth configured locally

Setup:

```bash
pnpm install
pnpm run bootstrap
```

Use `pnpm run bootstrap`, not `pnpm setup`. `setup` is a pnpm built-in command, so the repo bootstrap script must be invoked through `run`.

`pnpm run bootstrap` copies `.env.local` from `.env.example`, fills the checkout-scoped OpenClaw prefix, starts local Docker services for the current artifact-storage mode, and when you use local MinIO it also creates the bucket, enables public reads, and writes the probe object Softbox checks. On a fresh clone that means Redis + MinIO.

If you skip `pnpm run bootstrap`, start the local services yourself:

```bash
docker compose up -d redis minio
```

If you already have Redis running locally and `REDIS_URL` points at it, you can skip Docker.
If you use Cloudflare R2 instead of MinIO, you only need Redis locally.
BullMQ does not run as a separate container here. It is the queue library used inside `worker/src/index.ts`, and it stores queue state in Redis.

Fill in the required values in `.env.local`, then run:

```bash
pnpm run doctor
pnpm start
```

Notes:

- the shell only needs `VITE_CONVEX_URL`
- mounted app selection is stored in Convex, not in `.env.local`
- `pnpm seed` now shows an arrow-key picker for wrapped apps; use `pnpm seed -- --app <app-id>` for one explicit app or `pnpm seed -- --all` to seed every wrapped app
- `.env.example` now defaults to local MinIO values so a fresh checkout can use Docker-backed artifact storage immediately
- set `ARTIFACT_STORAGE_PROVIDER=r2` to switch from local MinIO to Cloudflare R2, then fill `S3_API`, `PUBLIC_DEVELOPMENT_URL`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`
- `S3_API` / `PUBLIC_DEVELOPMENT_URL` remain the R2 values and are unchanged for existing setups
- leave `OPENCLAW_AGENT_ID_PREFIX` blank unless you intentionally want a custom prefix; `pnpm run bootstrap` and `pnpm start` will generate a checkout-scoped value automatically so multiple local clones do not collide in OpenClaw
- queueing is handled by BullMQ in the worker process; Redis is the only extra service you need to run locally
- `pnpm start` starts Convex, the worker, and the shell together
- `pnpm start` auto-provisions the local MinIO bucket/probe when you use local MinIO and auto-syncs per-app OpenClaw agents unless you pass `--no-sync-agents`
- if `pnpm start` reports a missing package such as `bullmq`, the repo install is incomplete; rerun `pnpm install` at the repo root
- use `pnpm run doctor` instead of `pnpm doctor` because `doctor` is a reserved pnpm command

Wrapping a new app:

```bash
pnpm wrap-app -- --path apps/my-app
```

That command creates the thin Softbox runtime bridge for a browser-first React/Vite app and writes `softbox.config.json` so the worker can discover it automatically. The folder name under `/apps/<app-id>` is the canonical app id. It does not make Next.js or server-heavy apps magically compatible.

Seed a wrapped app once:

```bash
pnpm seed
```

That opens an arrow-key picker over wrapped apps and seeds the one you choose.
It also includes a `Seed all wrapped apps` choice.
For automation, run `pnpm seed -- --app <app-id>` or `pnpm seed -- --all`.
On a fresh clone, Softbox now auto-installs app-local dependencies for the selected app before building it.
After that, switch mounted apps from the shell UI instead of changing env vars.

If you already have older local Convex data from the pre-migration `templateId` architecture, inspect it first and then apply the rewrite once:

```bash
pnpm worker:migrate-app-ids
pnpm worker:migrate-app-ids -- --apply
```

If you already have existing OpenClaw box rows and want to attach them to the new engine/provider profile tables, run:

```bash
pnpm worker:backfill-box-profiles
```

Starting a new app:

1. copy `apps/vite-default` to `apps/<your-app>`
2. change `softbox.config.json`
3. replace `src/App.tsx`
4. keep `src/entry.tsx`, `src/defaultState.ts`, and `src/adapter/`
5. run `pnpm run doctor`

You can also start the full local onboarding flow with:

```bash
pnpm new-app
```

That command now does the full local onboarding flow for a supported Softbox app:

1. shows an arrow-key starter picker when you run it without arguments
2. auto-generates a new app id such as `dashboard-1` or `react-app-1`
3. either scaffolds a fresh Vite app or copies a wrapped starter app
4. runs `pnpm wrap-app -- --path apps/<your-app>` when wrapping is needed
5. runs `pnpm run doctor`
6. runs `pnpm seed -- --app <your-app>`
7. starts normally; `pnpm start` auto-syncs per-app OpenClaw agents
8. sets the new app as the default shell selection so the shell can mount it on refresh

Current starters:

- blank React + TypeScript
- blank React + JavaScript
- dashboard example
- grid example
- tic tac toe example

You can still override the Vite template if needed:

```bash
pnpm new-app my-app -- --template react
```

Or skip the picker with a specific starter:

```bash
pnpm new-app --starter dashboard-example
```

The command only injects `APP_ID` for its own `doctor` step. It does not rewrite `.env.local`.
`doctor` output is shown, but `pnpm new-app` still attempts `seed` afterwards so app-local onboarding is not blocked by unrelated environment warnings.
The starter picker uses a Node prompt UI, so users do not need Go or any external TUI runtime.
If a worker is already running, `pnpm new-app` now prints a restart warning after onboarding so the first prompt does not hit a stale worker process.

Then open the shell in the browser and submit a prompt.

## Useful Commands

```bash
pnpm run bootstrap
pnpm new-app
pnpm run doctor
pnpm start
pnpm dev:shell
pnpm dev:worker
pnpm dev:convex
pnpm build:shell
pnpm typecheck
pnpm test
pnpm seed
pnpm wrap-app -- --path apps/my-app
pnpm worker:backfill-box-profiles
pnpm worker:migrate-app-ids
pnpm worker:openclaw-sync-agents
docker compose up -d redis
```

## Documentation

Start with:

- [`docs/README.md`](./docs/README.md)
- [`docs/architecture.md`](./docs/architecture.md)
- [`docs/runtime-flow.md`](./docs/runtime-flow.md)
- [`docs/POSITIONING.md`](./docs/POSITIONING.md)
- [`docs/STANDALONE-MIGRATION.md`](./docs/STANDALONE-MIGRATION.md)
- [`docs/OPEN_SOURCE_CHECKLIST.md`](./docs/OPEN_SOURCE_CHECKLIST.md)

## Open Source Status

This repository is prepared to be published as open source, but it is still experimental.

What is solid:

- shell host runtime
- agent-driven rebuild pipeline
- standalone app hosting experiments
- pipeline visibility and version promotion model

What is still evolving:

- app contract cleanup
- multi-app ergonomics
- datahub integration story
- polished public examples

## License

[MIT](./LICENSE)
