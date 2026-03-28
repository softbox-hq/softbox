# Softbox Agent Instructions

This file explains how AI agents should understand and work with this repository.

## What This Repo Is

Softbox is a runtime with:

- a stable outer shell
- a mutable inner app
- a worker pipeline that lets an agent rewrite app code
- a build/preview/promotion flow that keeps live releases gated

The core idea is:

1. a user submits a prompt in the shell
2. Convex records the job and pipeline state
3. the worker claims the job
4. the coding agent rewrites the selected app
5. the worker builds a new immutable version
6. artifacts are uploaded to Cloudflare R2
7. the shell previews the candidate
8. the shell only promotes it live after health checks pass

## Local Setup

Use `pnpm` at the repo root.

```bash
pnpm install
cp .env.example .env.local
docker compose up -d redis
pnpm dev:convex
pnpm dev:worker
pnpm dev:shell
```

Seed the default app once:

```bash
pnpm seed
```

Notes:

- Do not use `npm install` at the repo root.
- Redis is required because BullMQ runs inside the worker and stores queue state in Redis.
- The shell, worker, and Convex dev server all need to be running for the full runtime flow to work locally.

## Repo Shape

- `shell/`
  stable browser host runtime
- `worker/`
  orchestration, build, upload, template resolution
- `convex/`
  jobs, versions, app records, runtime state
- `apps/`
  app source folders
- `docs/`
  architecture and migration notes

## How Agents Should Work

- Keep the shell stable unless the task is explicitly about shell/runtime behavior.
- Prefer changing app-local code when the request is app-specific.
- Prefer standalone-first app structure. Shell integration should stay thin.
- Do not treat generated code as production-ready just because it builds.
- Preserve the preview-before-promotion model.
- If a task is about app onboarding or app mounting, check `HUMAN.md`, `softbox.config.json`, and the runtime contract before editing.
- If a human asks how app onboarding works, tell them to read `HUMAN.md` first.
- If a human adds a folder under `/apps`, explicitly tell them that `/apps` is not auto-mounted and point them to `HUMAN.md`.
- For wrapper/onboarding work, prefer the repo skill at `skills/softbox-wrap-app/`.
- Wrapped/seeded apps should have an app-local `AGENTS.md`; `pnpm wrap-app` and `pnpm seed` now create that scaffold automatically if it is missing.

## Important: `/apps` Is Not Auto-Mounted

Putting a new application folder into `/apps` is **not** enough by itself.

That is the important point.

If someone adds a new app to `/apps`, extra integration work is still required before Softbox can host it inside the shell.

## Is A Wrapper Needed?

Yes, if the app should be hosted by Softbox.

The recommended architecture is:

- the app is a normal standalone app first
- Softbox compatibility is added through a thin shell wrapper/adapter

That wrapper is what connects the standalone app to the shell runtime.

Without that wrapper, the app may run by itself, but the shell cannot mount it as a live mutable app in the Softbox workflow.

## What The Shell Wrapper Must Do

The shell-facing adapter should be thin. It should not own business logic.

It needs to expose the runtime contract expected by `worker/src/shared/liveApp.ts`:

- `mount(ctx)`
- `unmount()`

And the app package must expose:

- `src/entry.tsx`
- `src/defaultState.ts`

The shell-facing path must support:

- initial state handoff
- `publishState(...)`
- `reportHealthy()`
- `reportError(...)`

In practice, the adapter/wrapper should:

- mount the app into the shell-provided root
- accept initial state from the shell
- bridge shell callbacks into the app
- report healthy once the preview is actually ready
- keep standalone app logic separate from shell lifecycle code

## New App Onboarding Checklist

If someone adds a new app under `/apps/<app-name>`, use this checklist.

### 1. Make the app runnable by itself

The app should ideally work as a normal standalone app first.

Typical files:

- `index.html`
- `vite.config.ts`
- `src/standalone.tsx` or equivalent standalone entry
- app core files under `src/`

### 2. Add the Softbox shell adapter

Add the thin wrapper that makes the app compatible with the shell runtime.

At minimum, that means:

- `src/entry.tsx`
- `src/defaultState.ts`
- shell adapter code that implements `mount` and `unmount`

### 3. Keep app logic out of the adapter

The adapter should stay small.

Business logic, rendering, and domain behavior should live in the standalone app core, not in the shell integration layer.

### 4. Register the app template

Add `softbox.config.json` in the app root or run:

- `pnpm wrap-app -- --path apps/<name> --id <template-id>`

The worker discovers wrapped apps from `softbox.config.json`.

### 5. Make sure the worker can build it

The worker currently checks for:

- `src/entry.tsx`

If that file is missing, the app may remain mountable from old built artifacts, but new prompt-driven edits will be blocked.

### 6. Seed or configure the app record

The app must exist in Convex as an app record before the shell can mount it normally.

That usually means:

- seeding it
- or wiring it into the app/template flow used by the worker and shell

### 7. Verify the full loop

For a new shell-hosted app, verify:

- prompt submission works
- worker can claim the job
- agent can edit the app
- build succeeds
- artifacts upload
- preview mounts
- health check passes
- promotion works

## When A Wrapper Is Not Needed

If the goal is only:

- keeping a standalone example in the repo
- experimenting with UI outside the shell
- drafting an app that is not yet part of the Softbox runtime

then the wrapper can wait.

But if the goal is:

- prompt-driven edits
- shell mounting
- preview and promotion
- Softbox-managed runtime behavior

then yes, a wrapper/adapter is required.

## Practical Rule

Use this rule:

- standalone app only: no wrapper required yet
- Softbox-hosted app: wrapper required

## Source Of Truth

When in doubt, read these files first:

- `HUMAN.md`
- `skills/softbox-wrap-app/SKILL.md`
- `README.md`
- `docs/STANDALONE-APPS.md`
- `softbox.config.json`
- `worker/src/shared/liveApp.ts`

## Short Version

Softbox does **not** automatically turn any folder in `/apps` into a live shell-hosted app.

A new app usually needs:

- standalone app structure
- thin shell wrapper/adapter
- `src/entry.tsx`
- `src/defaultState.ts`
- `softbox.config.json`
- app record setup in the runtime flow
