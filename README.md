# Softbox
Softbox is a Vite Agentic App Runtime for safe app modification and promotion.
It lets an agent rewrite a Vite app, build a new immutable version, preview it inside a stable shell, validate it, and only then promote it live.

Optimized for React + Vite apps that can be mounted inside the shell runtime.

Instead of using AI only to generate code in an editor, this project lets a coding agent rewrite a real app, build a new immutable version, preview it inside the shell, and only then promote it live.

## What It Is

- Stable shell host built with React + Vite
- Worker pipeline that uses Codex SDK to mutate app code
- Convex as the control plane for jobs, versions, and runtime state
- Cloudflare R2 for immutable build artifacts
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
- Redis
- Docker (optional, easiest way to run Redis locally)
- Convex project
- Cloudflare R2 bucket
- Codex CLI/auth configured locally

Setup:

```bash
pnpm install
pnpm setup
```

Start Redis for the worker queue:

```bash
docker compose up -d redis
```

If you already have Redis running locally and `REDIS_URL` points at it, you can skip Docker.
BullMQ does not run as a separate container here. It is the queue library used inside `worker/src/index.ts`, and it stores queue state in Redis.

Fill in the required values in `.env.local`, then run:

```bash
pnpm run doctor
pnpm dev
```

Notes:

- the shell only needs `VITE_CONVEX_URL`
- mounted app selection is stored in Convex, not in `.env.local`
- the worker now processes jobs across apps; `APP_ID` and `APP_TEMPLATE_ID` are mainly defaults for `pnpm seed` and worker helper scripts
- queueing is handled by BullMQ in the worker process; Redis is the only extra service you need to run locally
- `pnpm dev` starts Convex, the worker, and the shell together
- use `pnpm run doctor` instead of `pnpm doctor` because `doctor` is a reserved pnpm command

Wrapping a new app:

```bash
pnpm wrap-app -- --path apps/my-app --id myapp
```

That command creates the thin Softbox runtime bridge for a browser-first React/Vite app and writes `softbox.config.json` so the worker can discover it automatically. It does not make Next.js or server-heavy apps magically compatible.

Seed the demo app once:

```bash
pnpm seed
```

That seeds the bundled `apps/dashboard-example` template when `APP_TEMPLATE_ID=default`.
After that, switch mounted apps from the shell UI instead of changing env vars.

Starting a new app:

1. copy `apps/dashboard-example` to `apps/<your-app>`
2. change `softbox.config.json`
3. replace `src/App.tsx`
4. keep `src/entry.tsx`, `src/defaultState.ts`, and `src/adapter/`
5. run `pnpm run doctor`

Then open the shell in the browser and submit a prompt.

## Useful Commands

```bash
pnpm setup
pnpm run doctor
pnpm dev
pnpm dev:shell
pnpm dev:worker
pnpm dev:convex
pnpm build:shell
pnpm typecheck
pnpm test
pnpm seed
pnpm wrap-app -- --path apps/my-app --id myapp
pnpm worker:set-template -- --template-id myapp
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
