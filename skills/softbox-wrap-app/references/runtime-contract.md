# Softbox runtime contract

Read this before wrapping a new app.

## What the current worker expects

The current worker resolves wrapped apps by scanning `/apps/*/softbox.config.json`.

The app must be registered there.

The worker then expects:

- `src/entry.tsx`

The worker build path bundles:

- `src/entry.tsx` for the browser runtime
- `src/defaultState.ts` for initial state evaluation

This means a new app folder in `/apps` is not enough by itself.

## What the shell expects

The shell runtime expects a module that exports:

- `mount(ctx)`
- `unmount()`

The mount context includes:

- `root`
- `initialState`
- `publishState(next)`
- `reportHealthy()`
- `reportError(error)`

The wrapper must bridge those callbacks into the app.

## Default state expectations

`src/defaultState.ts` should export JSON-safe initial state.

Safe values:

- strings
- numbers
- booleans
- null
- arrays
- plain objects

Unsafe values:

- functions
- DOM nodes
- React elements
- class instances
- server-only objects

## Recommended structure

Prefer:

- standalone app core
- thin shell adapter

Do not make the adapter the center of the app.

## Good fit for wrapping

Good fit:

- browser-first React app
- Vite app
- app with clear client-side state
- app that can mount into a plain DOM root

Bad fit without extra porting:

- Next.js app that depends on App Router behavior
- server-rendered app
- app that depends on API routes or server actions
- app that assumes framework-owned runtime instead of a plain browser entry

## Honest rule

If the app is not a browser-first app that can be mounted by a thin adapter, say that directly.

Do not fake compatibility.
