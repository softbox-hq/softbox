# Standalone App Migration Plan

This document explains how to move from the current plugin-style live app template to the stronger architecture:

- standalone app first
- thin shell adapter around it
- shell remains the stable runtime host

The point is not to remove the shell.

The point is to stop forcing every app to be born as a shell-only plugin.

## Goal

End state:

- each app can run by itself
- each app can still be hosted by the shell
- the shell keeps versioning, preview, promotion, and observability
- the agent can still mutate the app live
- apps can own their own styles, packages, assets, and internal architecture

## Why Migrate

The current plugin model is useful for a prototype, but it becomes limiting when:

- apps need different dependencies
- apps need different styling systems
- apps need richer internal structure
- no two app workspaces should look the same
- apps should be reusable outside the shell

The standalone-first model keeps the dynamic property while removing those constraints.

## Current Shape

Today the live app template is tightly coupled to the shell contract:

- `mount`
- `unmount`
- `initialLiveAppState`
- `publishState`
- `reportHealthy`
- `reportError`

This means the app is not truly standalone.

## Current Status

The migration has started and the first structural split is already done in `apps/live-app-template`.

Already implemented:

- standalone Vite app path:
  - `apps/live-app-template/index.html`
  - `apps/live-app-template/vite.config.ts`
  - `apps/live-app-template/src/standalone.tsx`
  - `apps/live-app-template/package.json`
- extracted app core:
  - `apps/live-app-template/src/core/AppCore.tsx`
- extracted shell-facing wrapper and adapter:
  - `apps/live-app-template/src/adapter/AppShell.tsx`
  - `apps/live-app-template/src/adapter/shellAdapter.tsx`
- shell runtime entry reduced to a thin bridge:
  - `apps/live-app-template/src/entry.tsx`
- root-level compatibility shims kept temporarily for stability:
  - `apps/live-app-template/src/app-core.tsx`
  - `apps/live-app-template/src/app.tsx`
  - `apps/live-app-template/src/shell-adapter.tsx`

What this means in practice:

- the app now runs both:
  - standalone as a Vite app
  - shell-hosted through the adapter
- the migration is no longer hypothetical
- the remaining work is mostly cleanup, contract hardening, and broader app support

## Target Shape

For each app:

```text
app/
  src/
    App.tsx
    state.ts
    scene.tsx
    ...
  adapter/
    shell-entry.tsx
```

Where:

- `src/` is normal standalone app code
- `adapter/shell-entry.tsx` is the only place that knows about the shell runtime contract

## Design Rule

The adapter must be thin.

It should:

- mount the app into a provided DOM node
- translate initial state into app props/store state
- bridge shell callbacks
- report health/errors

It should **not** contain business logic, rendering logic, or domain logic.

## Migration Strategy

Do this incrementally.

Do not try to redesign everything at once.

## Phase A: Identify The Contract Boundary

Goal:

- clearly separate shell concerns from app concerns

Tasks:

1. List what the shell contract actually needs:
   - mount root
   - initial state
   - state publishing
   - healthy signal
   - error reporting

2. Mark every place in the live app where shell contract knowledge currently leaks into app logic.

3. Reduce that leakage until only one entry module truly depends on the shell contract.

Done when:

- the shell-facing API is concentrated in one small file

## Phase B: Extract Standalone App Core

Goal:

- make the app run as a normal app without the shell

Tasks:

1. Create a standalone entry point.
   - renders the app normally
   - provides local state and no-op bridge callbacks where needed

2. Move business/rendering logic into app-owned modules.

3. Ensure the app can boot outside the shell with its own data/config.

4. Keep the shell entry temporarily working in parallel.

Done when:

- the app can run standalone and still run inside the shell

Status:

- partially completed
- standalone boot exists and works
- app-owned logic has started moving into `src/core/`
- more cleanup is still needed to reduce reliance on compatibility shims

## Phase C: Introduce Thin Shell Adapter

Goal:

- make shell integration a wrapper, not the app’s identity

Tasks:

1. Create `adapter/shell-entry.tsx`.

2. Move shell-specific responsibilities there:
   - `mount`
   - `unmount`
   - `initialLiveAppState`
   - `publishState`
   - `reportHealthy`
   - `reportError`

3. Keep the standalone app oblivious to shell internals.

Done when:

- the shell imports only the adapter
- the app core can run without shell knowledge

Status:

- partially completed
- `src/adapter/` now exists and is the real shell-facing layer
- `src/entry.tsx` is now a thin export surface
- root-level compatibility files still exist temporarily to avoid breaking the current worker/runtime flow

## Phase D: Normalize App State Ownership

Goal:

- stop treating shell state and app state as the same thing

Tasks:

1. Define app-owned state shape.

2. Define adapter-owned translation layer between shell runtime state and app state.

3. Make generated files and tool outputs feed into app state cleanly.

4. Avoid leaking shell transport details into app components.

Done when:

- app components work with app domain state, not shell plumbing state

## Phase E: Support Real App Diversity

Goal:

- allow different apps to have different ecosystems

Tasks:

1. Let each app own:
   - styling
   - assets
   - internal module structure
   - dependencies where possible

2. Keep the shell contract minimal enough that apps can differ widely while still being hostable.

3. Document what the shell requires from any app adapter.

Done when:

- the shell can host materially different apps without all of them looking like variants of one template

## Phase F: Update The Build + Worker Model

Goal:

- make the worker work with standalone-first apps, not only plugin templates

Tasks:

1. Decide the unit of mutation:
   - whole app package
   - app `src/`
   - adapter + app separately

2. Ensure the worker edits the app core when appropriate and the adapter only when shell integration changes are needed.

3. Keep bundling/publishing compatible with the shell host.

4. Preserve versioned preview/promotion behavior.

Done when:

- runtime architecture remains stable while app architecture becomes more flexible

## Phase G: Template And Docs Transition

Goal:

- make future apps follow the stronger pattern from the start

Tasks:

1. Replace the current plugin-style template documentation with:
   - standalone app core guidance
   - shell adapter guidance

2. Update agent instructions to say:
   - edit app core for UI/domain work
   - edit adapter only for shell contract changes

3. Add one minimal standalone example app plus adapter.

Done when:

- future verticals no longer start from the old plugin-only pattern

## Recommended Attack Order

This is the safest order:

1. isolate current shell contract into one file
2. create standalone entry point
3. keep shell adapter working in parallel
4. move app logic out of shell-aware modules
5. refactor worker/docs to target app core + adapter separately

Do **not** start by changing the shell runtime itself.

The shell should remain stable while the app side is disentangled.

## What To Keep

Keep these core properties:

- stable shell
- candidate preview
- promotion/activation lifecycle
- versioned builds
- runtime error reporting
- pipeline observability

The migration is not an abandonment of the runtime idea.
It is a stronger realization of it.

## What To Avoid

Avoid:

- letting shell-specific callbacks spread through the standalone app core
- moving business logic into the adapter
- coupling app internals to one fixed template structure
- redesigning app architecture and shell architecture simultaneously

## Success Criteria

The migration succeeds when:

- the app can run standalone
- the shell can still host it through a thin adapter
- the agent can still mutate it live
- the app can own richer styles/dependencies/components than the current plugin template allows
- future apps can be onboarded without copying a shell-coupled plugin pattern

## Immediate First Steps

Concrete first moves:

1. Identify the smallest current shell adapter boundary in the threejs app.
2. Create a standalone entry for the current app.
3. Keep `mount/unmount/initialLiveAppState` in one adapter file only.
4. Update docs so future work stops deepening plugin-only coupling.

## Immediate Next Steps

The next practical steps from the current state are:

1. keep the standalone Vite path healthy and tested
2. keep the shell adapter thin and stable
3. stop adding new behavior to root-level compatibility shims
4. move future UI and domain changes into `src/core/`
5. only touch `src/adapter/` for shell contract work
6. later decide whether to remove the compatibility shims or keep them as long-lived facades
