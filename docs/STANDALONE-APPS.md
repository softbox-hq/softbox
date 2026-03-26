# Standalone-First Apps

This note captures an important architectural direction:

- apps should ideally be standalone first
- the shell should wrap them through a thin adapter

Instead of:

- app is born as a shell-only plugin

the stronger long-term model is:

- app is a normal standalone app
- shell compatibility is added through a wrapper/adapter layer

## Current Progress

This direction is no longer only conceptual.

The current `apps/live-app-template` already has the first migration slice in place:

- standalone Vite entry:
  - `apps/live-app-template/index.html`
  - `apps/live-app-template/vite.config.ts`
  - `apps/live-app-template/src/standalone.tsx`
- app core:
  - `apps/live-app-template/src/core/AppCore.tsx`
- shell wrapper and adapter:
  - `apps/live-app-template/src/adapter/AppShell.tsx`
  - `apps/live-app-template/src/adapter/shellAdapter.tsx`
- temporary root-level compatibility shims:
  - `apps/live-app-template/src/app-core.tsx`
  - `apps/live-app-template/src/app.tsx`
  - `apps/live-app-template/src/shell-adapter.tsx`

The app can now be run as a real standalone Vite app from inside `apps/live-app-template/`:

```bash
pnpm dev
pnpm build
pnpm typecheck
```

The shell-hosted path still works through the adapter entry.

## Why This Matters

The current `apps/live-app-template` is built around the shell runtime contract:

- `mount`
- `unmount`
- `initialLiveAppState`
- callbacks like:
  - `publishState`
  - `reportHealthy`
  - `reportError`

That works, but it also means the app is tightly coupled to the shell.

If the app is moved outside the shell as-is, it is not a normal standalone app.

## Better Architecture

The better long-term model is:

1. **Standalone app core**
   - a normal app that can run by itself
   - owns its UI, domain logic, and rendering

2. **Shell adapter**
   - a thin layer that implements the shell runtime contract
   - mounts the standalone app into the shell
   - translates shell callbacks into app-facing props or APIs

3. **Shell host**
   - loads and manages adapted apps uniformly
   - remains stable while apps change

The current codebase is now partway into that shape:

```text
apps/live-app-template/
  src/
    core/
      AppCore.tsx
    adapter/
      AppShell.tsx
      shellAdapter.tsx
    generated/
    standalone.tsx
    entry.tsx
```

## Benefits

### 1. App portability

Each app can:

- run on its own
- be shared outside the shell
- be tested in isolation
- be reused in other environments

### 2. More general shell

The shell becomes a true host for many apps, not just specially-crafted templates.

That means:

- more verticals become possible
- app onboarding becomes easier
- the shell becomes more like an operating system / runtime host

### 3. Cleaner separation of concerns

The app owns:

- domain behavior
- UI
- rendering

The shell owns:

- lifecycle
- orchestration
- versioning
- preview/promotion
- runtime observability

This is a cleaner split than mixing shell-specific lifecycle code directly into every app.

### 4. Better long-term scalability

If the system grows to multiple verticals, standalone-first apps are much easier to reason about than many shell-coupled plugin apps.

## Suggested Structure

For each app:

```text
app/
  src/
    App.tsx
    state.ts
    scene.tsx
  shell-adapter/
    entry.tsx
```

Where:

- `src/` is normal standalone app code
- `shell-adapter/entry.tsx` exposes:
  - `mount`
  - `unmount`
  - `initialLiveAppState`

The adapter should be thin.

## What The Adapter Should Do

The adapter should:

- mount the app into the provided root
- accept initial state from the shell
- bridge callbacks:
  - `publishState`
  - `reportHealthy`
  - `reportError`

The adapter should **not** own business logic.

That belongs in the standalone app core.

## Why This Is Better Than Plugin-Only

Plugin-only design makes sense for a prototype.

But long-term it creates unnecessary coupling:

- apps become hard to reuse
- the shell contract leaks into business logic
- every app becomes a special shell app

Standalone-first plus adapter avoids that.

## Relationship To The Runtime Vision

This does **not** weaken the shell/runtime vision.

It strengthens it.

Why:

- the shell becomes a more general host
- apps become real independently-usable programs
- the runtime becomes the thing that hosts, mutates, previews, and promotes them

That is a stronger story than:

- "one special app template lives inside the shell"

## Future Direction

The likely good evolution is:

1. keep the current plugin-style template while prototyping
2. identify the minimal shell adapter contract
3. refactor the live app into:
   - standalone app core
   - thin shell adapter
4. make future verticals follow that pattern from the start

## One-Line Summary

The stronger architecture is:

- **standalone apps wrapped by the shell**

not:

- **apps that only exist as shell plugins**
