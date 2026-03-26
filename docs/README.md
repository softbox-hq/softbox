# Softbox Docs

This project is a local-first prototype for a different way of building apps with AI.

Instead of using an LLM only to produce structured actions or mutate app state, this runtime lets the model rewrite real application code, rebuild a new bundle, and swap that bundle into a running app without redeploying the shell.

## What To Read First

- [`idea.md`](/home/fvrlak/projects/softbox/docs/idea.md)
  - Why this project exists and what it is trying to prove.
- [`architecture.md`](/home/fvrlak/projects/softbox/docs/architecture.md)
  - The system pieces and how they fit together.
- [`runtime-flow.md`](/home/fvrlak/projects/softbox/docs/runtime-flow.md)
  - The step-by-step lifecycle from prompt to live swap.
- [`R2-bottleneck.md`](/home/fvrlak/projects/softbox/docs/R2-bottleneck.md)
  - Investigation of the upload bottleneck, the fixes applied, and the measured reduction from ~30s to ~3.8s.
- [`ELEMENTS-NUMBR.md`](/home/fvrlak/projects/softbox/docs/ELEMENTS-NUMBR.md)
  - How the asteroid orbital catalog is parsed, converted, and rendered as the first 50 objects.
- [`HORIZONS.md`](/home/fvrlak/projects/softbox/docs/HORIZONS.md)
  - How planets and major moons are generated from NASA/JPL Horizons.
- [`DATAHUB-ARCH.md`](/home/fvrlak/projects/softbox/docs/DATAHUB-ARCH.md)
  - Sketch of the proposed standalone Python/FastAPI datahub and its HTTP/JSON contract with the runtime.
- [`ROADMAP.md`](/home/fvrlak/projects/softbox/docs/ROADMAP.md)
  - Step-by-step plan from the current prototype to a broader usable system.
- [`OPEN_SOURCE_CHECKLIST.md`](/home/fvrlak/projects/softbox/docs/OPEN_SOURCE_CHECKLIST.md)
  - Concrete cleanup and publish checklist for putting the repo out in public.
- [`outrach.md`](/home/fvrlak/projects/softbox/docs/outrach.md)
  - Practical promotion strategy: where to launch, who to target first, and how to frame the project publicly.
- [`POSITIONING.md`](/home/fvrlak/projects/softbox/docs/POSITIONING.md)
  - Distinction between this project as a live runtime and tools like Bolt, v0, and Lovable as AI app generation environments.
- [`MULTI-AGENT-SHELL.md`](/home/fvrlak/projects/softbox/docs/MULTI-AGENT-SHELL.md)
  - Concept note for turning the shell into a multi-agent operations room with explicit bot roles.
- [`STANDALONE-APPS.md`](/home/fvrlak/projects/softbox/docs/STANDALONE-APPS.md)
  - Why the stronger long-term architecture is standalone-first apps with a thin shell adapter, not plugin-only app templates.
- [`STANDALONE-MIGRATION.md`](/home/fvrlak/projects/softbox/docs/STANDALONE-MIGRATION.md)
  - Concrete step-by-step attack plan for migrating from plugin-style templates to standalone apps wrapped by the shell.
- [`bottleneck.json`](/home/fvrlak/projects/softbox/docs/bottleneck.json)
  - Raw pipeline timing samples used during the bottleneck investigation.

## Short Version

The runtime is split into two layers:

- A stable shell
  - Handles UI, Convex subscriptions, bundle loading, health checks, and rollback.
- A mutable hosted app
  - Lives in the currently selected app template and is rewritten by the worker's coding agent.

When the user submits a prompt:

1. the shell writes a job into Convex
2. the worker claims the job
3. Codex edits the selected app source
4. the worker rebuilds and uploads a new version to R2
5. the shell previews the new bundle and promotes it only after it reports healthy

That means the shell stays stable while the app inside it evolves.

## Scope Of This Prototype

This repository is intentionally narrow:

- local-first, single-user
- Codex SDK as the editing agent
- Convex as the control plane
- Cloudflare R2 as immutable bundle storage
- hosted Vite apps as the main current target, with the original Three.js example still present

The project is not yet trying to be:

- a hosted multi-user platform
- a general-purpose cloud IDE
- a secure execution platform for untrusted public users
- a replacement for every existing app framework

It is a proof that a prompt can drive:

- real code edits
- real rebuilds
- real versioned deployment artifacts
- real live bundle swaps

## Folder Map

- `shell/`
  - Stable wrapper app that the user opens in the browser.
- `apps/live-app-template/`
  - Original mutable example app.
- `apps/live-app-template-crm/`
  - CRM-style hosted app example.
- `apps/test-app/`, `apps/test-app-2/`, `apps/test-app-3/`
  - Standalone-first hosting experiments.
- `worker/`
  - Orchestrates Codex, builds, uploads, and publishes.
- `convex/`
  - Source of truth for prompts, files, versions, and runtime errors.
- `CLAUDE.md`
  - Repo-level instructions for the coding agent.
- `AGENTS.md`
  - Per-app editing guidance used by hosted app templates.

## Core Design Rule

The shell is the operating system.

The live app is the mutable program running inside it.

That separation is the main idea of this repository.
