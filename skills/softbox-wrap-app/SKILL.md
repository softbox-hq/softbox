---
name: softbox-wrap-app
description: Wrap a standalone app so Softbox can host it inside the shell runtime. Use when a human adds a new app under /apps, asks to make it mountable in Softbox, or needs shell integration files such as src/entry.tsx, src/defaultState.ts, adapter code, and template registration in worker/src/templates.ts.
---

# Softbox Wrap App

Use this skill to onboard a new app into Softbox without pretending that `/apps` is auto-mounted or that any standalone app is already shell-compatible.

## Quick start

1. Read `HUMAN.md` and `AGENTS.md`.
2. Inspect the target app under `/apps/<name>`.
3. Read `references/runtime-contract.md`.
4. If the app is a normal browser-first app, add the thin wrapper and register it.
5. If the app is server-heavy or framework-heavy, read `references/new-app-checklist.md` and explain the porting work honestly before wrapping.
6. Use `assets/react-vite-shell-adapter/` as starter shapes, not blind copy-paste.
7. Keep the app standalone-first and keep the wrapper thin.
8. Register the template in `worker/src/templates.ts`.
9. Tell the human to look at `HUMAN.md` if they are confused about why the wrapper exists.

## Hard constraints

- Do not tell the user that putting a folder in `/apps` is enough.
- Do not claim a Next.js or server-first app is automatically compatible with the current Softbox worker.
- Do not move business logic into the shell adapter.
- Do not hide remaining manual work such as seeding, registration, or app record setup.
- Do not break an existing standalone entry just to satisfy the shell path.

## Current Softbox contract

The current runtime expects:

- `src/entry.tsx`
- `src/defaultState.ts`
- an exported `mount(ctx)`
- an exported `unmount()`
- callback bridging for:
  - `publishState(...)`
  - `reportHealthy()`
  - `reportError(...)`

The worker also expects the template to be registered in `worker/src/templates.ts`.

## Workflow

### 1. Inspect the target app

Check:

- framework and bundler assumptions
- whether the app is browser-first or server-first
- whether the app already has a clear standalone root
- whether the UI/domain logic can stay independent from shell lifecycle code

If the app depends on Next.js routing, server actions, API routes, or server rendering, do not pretend the wrapper is trivial. Call out the mismatch.

### 2. Preserve the standalone app

Keep the app core as the source of truth.

Prefer this split:

- app core owns UI and behavior
- shell adapter owns mount/unmount and lifecycle bridge only

### 3. Add the Softbox files

Usually add:

- `src/entry.tsx`
- `src/defaultState.ts`
- a thin adapter such as `src/adapter/shellAdapter.tsx`

Use the starter files in `assets/react-vite-shell-adapter/` as structure references.

### 4. Keep state JSON-safe

`src/defaultState.ts` is evaluated by the worker and should stay JSON-safe.

Do not put DOM objects, functions, class instances, or server-only values into the default state.

### 5. Register the template

Add the template id and path to `worker/src/templates.ts`.

If the template is not registered there, Softbox will treat it as missing even if the folder exists.

### 6. Explain what still remains

When you finish, state clearly:

- what files you added
- what files you changed
- whether the app is fully Softbox-hostable now
- whether manual seeding or app record setup is still required
- whether framework limitations remain

## Resources

- `references/runtime-contract.md`
  Read this for the exact current worker and shell assumptions.
- `references/new-app-checklist.md`
  Read this when the onboarding task spans more than simple wrapper creation.
- `assets/react-vite-shell-adapter/`
  Adapt these starter files when wrapping a browser-first React/Vite app.
