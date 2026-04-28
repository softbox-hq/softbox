# Softbox Agent Guide

This file is for coding agents working inside this repository. It is not the full
installation guide.

For installation or repair of a local checkout, use [`SETUP.md`](./SETUP.md) as
the source of truth. If a human asks for AI-assisted installation, tell them to
put `SETUP.md` in the agent context and ask the agent to follow it step by step.

## What Softbox Is

Softbox is a runtime with:

- a stable outer shell
- mutable hosted apps under `apps/`
- a worker pipeline that asks OpenClaw to edit app code
- Convex state for apps, jobs, versions, boxes, and runtime status
- artifact storage through local MinIO or Cloudflare R2
- preview-before-promotion release flow

The normal flow is:

1. the shell records a prompt in Convex
2. the worker claims the job
3. OpenClaw edits the selected app workspace
4. the worker builds an immutable candidate version
5. artifacts are uploaded
6. the shell previews the candidate
7. the shell promotes it only after health checks pass

## Agent Source Of Truth

Use these files before guessing:

- `SETUP.md` for local installation, environment variables, OpenClaw, Convex,
  Redis, MinIO, and verification
- `README.md` for product overview and common commands
- `skills/softbox-wrap-app/SKILL.md` for app onboarding and wrapper work
- `worker/src/shared/liveApp.ts` for the shell runtime contract
- app-local `AGENTS.md` files under `apps/<app>/` before editing a hosted app

## Local Setup Rules

Use `pnpm` at the repo root. Do not use `npm install` at the repo root.

Common setup sequence:

```bash
pnpm install
pnpm run bootstrap
# fill .env.local using SETUP.md
pnpm run doctor
pnpm start
```

Important details:

- Use `pnpm run doctor`, not `pnpm doctor`.
- `VITE_CONVEX_URL` and `CONVEX_URL` must be the same Convex URL and should not
  end with a trailing slash.
- `AGENT_COMMAND` should normally be `openclaw`.
- `OPENCLAW_GATEWAY_TOKEN` must be copied from
  `~/.openclaw/openclaw.json`.
- Leave `OPENCLAW_AGENT_ID_PREFIX` blank unless intentionally sharing agents
  across checkouts; Softbox generates a checkout-scoped prefix.
- Redis is required because BullMQ stores queue state there.
- Local MinIO is the easiest artifact storage path for development.
- `pnpm start` starts Convex, the worker, and the shell together.

If `openclaw` is installed but not found on `PATH`, check
`~/.npm-global/bin/openclaw`. Either add that directory to `PATH` or link the
binary into a directory that is already on `PATH`, such as `~/.local/bin`.

## Repo Shape

- `shell/` stable browser host runtime
- `worker/` orchestration, build, upload, template resolution, OpenClaw calls
- `convex/` jobs, versions, app records, boxes, runtime state
- `apps/` standalone-first app workspaces
- `skills/` repo-local agent skills
- `docs/` architecture notes and focused implementation docs

## How Agents Should Work

- Keep the shell stable unless the task is explicitly about shell/runtime
  behavior.
- Prefer app-local changes for app-specific requests.
- Read the relevant app-local `AGENTS.md` before editing an app under `apps/`.
- Preserve the preview-before-promotion model.
- Do not treat generated code as production-ready only because it builds.
- Do not rewrite unrelated docs, lockfiles, generated files, or environment
  files unless the task requires it.
- Do not revert user changes in a dirty worktree.

## App Onboarding

`/apps` is not auto-mounted. Putting a folder under `apps/` is not enough.

A Softbox-hosted app usually needs:

- a standalone app structure
- `softbox.config.json`
- `src/entry.tsx`
- `src/defaultState.ts`
- a thin shell adapter exporting `mount(ctx)` and `unmount()`
- Convex app state from seeding or onboarding

For wrapper/onboarding work, use `skills/softbox-wrap-app/`.

The shell adapter should stay thin. Business logic, rendering, and domain
behavior should remain in the standalone app core.

## OpenClaw Agents

Softbox usually runs OpenClaw in per-app mode. Expected agents look like:

```text
<OPENCLAW_AGENT_ID_PREFIX><appId>
```

To check or repair the local OpenClaw agent set:

```bash
openclaw gateway status
openclaw agents list --json
pnpm worker:openclaw-sync-agents -- --apply
```

If Convex app records do not exist yet, seed first:

```bash
pnpm seed -- --all --force
pnpm worker:openclaw-sync-agents -- --apply
```

## Generated Images

When using OpenClaw `image_generate` for an app asset, do not leave the result
only in managed media storage.

Required workflow:

1. generate the image
2. read the returned media path
3. copy the binary into the active app under `src/assets/`
4. use a deterministic filename
5. update app code to reference the workspace file
6. report both the original media path and final workspace path

Do not replace an explicit image-generation request with SVG, CSS art, canvas
art, or inline shapes.

## Verification

Use the narrowest check that proves the change:

- setup/environment: `pnpm run doctor`
- OpenClaw routing: `pnpm worker:openclaw-sync-agents -- --apply`
- app seed state: `pnpm seed -- --app <app-id> --force` or `pnpm seed -- --all --force`
- TypeScript/build-level changes: `pnpm typecheck`, `pnpm test`, or the
  relevant app build
