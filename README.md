<a id="readme-top"></a>

<div align="center"><pre>
███████╗ ██████╗ ███████╗████████╗██████╗  ██████╗ ██╗  ██╗
██╔════╝██╔═══██╗██╔════╝╚══██╔══╝██╔══██╗██╔═══██╗╚██╗██╔╝
███████╗██║   ██║█████╗     ██║   ██████╔╝██║   ██║ ╚███╔╝
╚════██║██║   ██║██╔══╝     ██║   ██╔══██╗██║   ██║ ██╔██╗
███████║╚██████╔╝██║        ██║   ██████╔╝╚██████╔╝██╔╝ ██╗
╚══════╝ ╚═════╝ ╚═╝        ╚═╝   ╚═════╝  ╚═════╝ ╚═╝  ╚═╝
          Operating system for dynamic user interfaces
</pre></div>

<p align="center"><strong>Dynamic user interfaces · stable shell · OpenClaw workers · immutable previews · explicit promotion</strong></p>

<p align="center">
  <a href="https://github.com/softbox-hq/softbox"><img src="https://img.shields.io/badge/repo-softbox--hq%2Fsoftbox-111827" alt="Repository"></a>
  <a href="https://github.com/softbox-hq/softbox"><img src="https://img.shields.io/badge/runtime-React%20%2B%20Vite-2563eb" alt="React and Vite"></a>
  <a href="https://www.convex.dev/"><img src="https://img.shields.io/badge/control%20plane-Convex-f97316" alt="Convex"></a>
  <a href="https://github.com/softbox-hq/softbox"><img src="https://img.shields.io/badge/storage-MinIO%20%2F%20R2-059669" alt="MinIO or Cloudflare R2"></a>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#create-an-app">Create an App</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="./SETUP.md">Full Setup</a>
</p>

---

Softbox is an operating system for dynamic user interfaces.

An agent can reshape a real React/Vite interface, but the live user-facing shell stays stable. Every change is built as an immutable candidate, uploaded to artifact storage, mounted in preview, health-checked, and promoted only after it proves it can run.

That gives you an AI-editable interface environment without letting generated code directly replace production runtime state.

## Why Softbox

Most AI app builders collapse editing, preview, and deployment into one surface. Softbox separates them.

| Layer | Responsibility |
| --- | --- |
| Shell | Stable browser runtime, prompt UI, app switching, preview mount |
| Hosted app | Normal standalone-first React/Vite app code |
| Worker | Job claiming, agent execution, build, upload, version publishing |
| Convex | Jobs, versions, apps, boxes, runtime state |
| Artifact storage | Immutable bundles through local MinIO or Cloudflare R2 |
| OpenClaw | Code edits inside the selected app workspace |

Softbox is closest to tools like Bolt.new, v0, and Lovable, but it is designed for tighter control over the runtime boundary, local services, agent routing, and version promotion.

## What It Does

- **Runs dynamic interfaces inside a stable shell**: the operating layer does not get rewritten for ordinary app changes.
- **Builds every agent change as a candidate version**: generated code is previewed before it becomes live.
- **Stores immutable artifacts**: bundles are uploaded to MinIO or R2 instead of served from a mutable workspace.
- **Tracks app and runtime state in Convex**: jobs, versions, selected app, boxes, and health state are explicit.
- **Uses OpenClaw for code mutation**: Softbox orchestrates; OpenClaw edits.
- **Supports app switching and version rollback**: move between apps and previously built versions from the shell.

## Quickstart

Use `SETUP.md` for a real installation. It is the source of truth for Convex, OpenClaw, Redis, MinIO/R2, `.env.local`, seeding, and verification.

```bash
pnpm install
pnpm run bootstrap
# fill .env.local using SETUP.md
pnpm run doctor
pnpm start
```

Open the shell after `pnpm start`, select or seed an app, then submit a prompt.

### Requirements

| Requirement | Notes |
| --- | --- |
| Node.js 20+ | Runtime for scripts, shell, and worker |
| pnpm | Use pnpm at the repo root; do not run `npm install` here |
| Docker | Recommended for local Redis and MinIO |
| Convex project | Control plane for jobs, apps, versions, runtime state |
| OpenClaw CLI | Authenticated locally; used by the worker to edit app code |
| MinIO or Cloudflare R2 | Artifact storage for built app bundles |

### Important Setup Rules

- Use `pnpm run bootstrap`, not `pnpm setup`.
- Use `pnpm run doctor`, not `pnpm doctor`.
- `VITE_CONVEX_URL` and `CONVEX_URL` must be the same Convex URL.
- Do not include a trailing slash in either Convex URL.
- Leave `OPENCLAW_AGENT_ID_PREFIX` blank unless you intentionally share agents across checkouts.
- Redis is required because BullMQ stores queue state there.
- Local MinIO is the fastest development path; switch to R2 only when you want Cloudflare-backed artifacts.

## AI-Assisted Install

Recommended setup path: give a coding agent `SETUP.md` and ask it to follow the file step by step.

```text
Use SETUP.md as the source of truth. Set up this Softbox checkout end to end.
Do not skip verification. Explain each dashboard step before asking me to do it.
When editing .env.local, tell me exactly which value goes into which variable.
```

`AGENTS.md` and `CLAUDE.md` are operating instructions for agents inside this repo. They are not full installation guides.

## How It Works

```text
User prompt
    |
    v
Convex job record
    |
    v
Worker claims job
    |
    v
OpenClaw edits apps/<app-id>
    |
    v
Worker builds candidate bundle
    |
    v
MinIO / R2 artifact upload
    |
    v
Shell mounts preview
    |
    v
Health check passes
    |
    v
Candidate promoted live
```

The invariant is simple: the shell is stable, the inner app is mutable, and generated code has to pass through a preview boundary before promotion.

## Create an App

Create a new app from the Softbox desktop. Right-click the desktop, choose the new-app action, and Softbox creates the app workspace, wraps it, seeds it, and makes it available in the shell.

<p align="center">
  <video src="docs/assets/github-create-new-app.mp4" controls width="900"></video>
</p>

For scripted onboarding, use the CLI:

```bash
pnpm new-app
```

## Wrap an Existing App

Softbox does not auto-mount everything under `apps/`. A hosted app needs a thin runtime bridge and config.

```bash
pnpm wrap-app -- --path apps/my-app
```

A wrapped app normally contains:

| File | Purpose |
| --- | --- |
| `softbox.config.json` | App metadata and build/runtime discovery |
| `src/entry.tsx` | Shell adapter that exports `mount(ctx)` and `unmount()` |
| `src/defaultState.ts` | Initial app state for seeding |

Keep the adapter thin. Business logic, rendering, and domain behavior should stay in the standalone app core.

## Seed Apps

Seed every wrapped app from current source:

```bash
pnpm seed -- --all --force
```

Seed one app:

```bash
pnpm seed -- --app <app-id> --force
```

Plain `pnpm seed` opens an arrow-key picker. `pnpm start` also auto-seeds wrapped apps that still have no live version, so manual seeding is mainly for explicit reseeds and repairs.

## Architecture

```text
softbox/
  shell/        Stable browser host runtime and prompt UI
  worker/       Agent orchestration, build pipeline, upload, publish
  convex/       Schema, queries, mutations, runtime state
  apps/         Standalone-first hosted app workspaces
  skills/       Repo-local agent skills, including app wrapping
  docs/         Focused architecture and integration notes
```

### Runtime Contract

The shell and hosted app communicate through a narrow mount contract. The most important source file for that contract is:

```text
worker/src/shared/liveApp.ts
```

For app onboarding and wrapper work, use:

```text
skills/softbox-wrap-app/SKILL.md
```

For app-specific edits, read the app-local `AGENTS.md` under `apps/<app>/` before changing code.

## OpenClaw Agent Routing

Softbox usually runs OpenClaw in per-app mode. Expected agent ids look like:

```text
<OPENCLAW_AGENT_ID_PREFIX><appId>
```

Check or repair the local OpenClaw agent set:

```bash
openclaw gateway status
openclaw agents list --json
pnpm worker:openclaw-sync-agents -- --apply
```

If Convex app records do not exist yet:

```bash
pnpm seed -- --all --force
pnpm worker:openclaw-sync-agents -- --apply
```

## Common Commands

| Command | Purpose |
| --- | --- |
| `pnpm run bootstrap` | Create `.env.local`, generate local agent prefix, start local services |
| `pnpm run doctor` | Validate environment and service connectivity |
| `pnpm start` | Start Convex, worker, and shell together |
| `pnpm new-app` | Create and onboard a new hosted app |
| `pnpm wrap-app -- --path apps/my-app` | Add Softbox runtime bridge to an existing app |
| `pnpm seed -- --all --force` | Rebuild and seed all wrapped apps |
| `pnpm typecheck` | TypeScript project check |
| `pnpm test` | Run Vitest |

## Storage Modes

| Provider | Best for | Env setting |
| --- | --- | --- |
| MinIO | Local development and VM installs | `ARTIFACT_STORAGE_PROVIDER=minio` |
| Cloudflare R2 | Durable shared artifact storage | `ARTIFACT_STORAGE_PROVIDER=r2` |

Fresh checkouts default to local MinIO values in `.env.example`. If you switch to R2, fill `S3_API`, `PUBLIC_DEVELOPMENT_URL`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` as described in `SETUP.md`.

## Migration And Repair

Older local Convex data from the pre-migration `templateId` architecture can be inspected and rewritten once:

```bash
pnpm worker:migrate-app-ids
pnpm worker:migrate-app-ids -- --apply
```

Existing OpenClaw box rows can be attached to the current engine/provider profile tables:

```bash
pnpm worker:backfill-box-profiles
```

## Documentation

| Document | Use it for |
| --- | --- |
| [`SETUP.md`](./SETUP.md) | Full local installation and verification |
| [`AGENTS.md`](./AGENTS.md) | Repository instructions for coding agents |
| [`CLAUDE.md`](./CLAUDE.md) | Claude-specific repository instructions |
| [`skills/softbox-wrap-app/SKILL.md`](./skills/softbox-wrap-app/SKILL.md) | App onboarding and wrapper work |
| [`docs/shell-host-surface.md`](./docs/shell-host-surface.md) | Shell host surface notes |
| [`docs/openclaw/gateway-control.md`](./docs/openclaw/gateway-control.md) | OpenClaw gateway integration |
| [`docs/openclaw/softbox-ui-auth.md`](./docs/openclaw/softbox-ui-auth.md) | OpenClaw UI auth notes |
| [`docs/openclaw/ws.md`](./docs/openclaw/ws.md) | OpenClaw websocket notes |
| [`docs/r2/R2-bottleneck.md`](./docs/r2/R2-bottleneck.md) | R2 storage notes |

## Project Status

Softbox is a local-first runtime for experimenting with agent-mutated apps. Treat generated app code as candidate code until it has been built, previewed, and promoted through the normal flow.

## License

[MIT](./LICENSE)

<p align="right">(<a href="#readme-top">back to top</a>)</p>
