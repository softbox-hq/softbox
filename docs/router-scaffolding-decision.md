# Router Scaffolding Decision

## Summary

Softbox now has a clear runtime rule for routed Vite apps:

- standalone entry should use `BrowserRouter`
- mounted shell entry should use `MemoryRouter`

But there is still an open product/tooling decision:

- should `pnpm new-app` and `pnpm wrap-app` scaffold that routing split by default
- or should they keep the generic adapter and only add routing support once the app actually adopts client-side routes

This document records that decision point.

## Current State

Today, blank Vite apps created by `pnpm new-app` do go through the Softbox wrapper flow.

Relevant files:

- [`scripts/new-app.mjs`](/home/fvrlak/ventures/softbox/scripts/new-app.mjs)
- [`scripts/wrap-app.ts`](/home/fvrlak/ventures/softbox/scripts/wrap-app.ts)

`pnpm new-app` scaffolds the Vite app, then runs:

- `pnpm wrap-app -- --path apps/<app-id>`

The wrapper currently writes a generic shell adapter:

- runtime provider
- `mount(...)`
- `unmount()`
- `initialLiveAppState`

It does **not** currently scaffold:

- `MemoryRouter` in the mounted adapter
- `BrowserRouter` in the standalone entry
- route publishing through `publishState(...)`

So the router split exists as a documented runtime pattern, but it is not yet a generator default.

## Why This Is Not An Automatic Yes

Not every new app needs routing.

Many new Vite apps will start as:

- a single page
- one view
- no route state at all

If the generator always injects routing scaffolding, then every app starts with:

- extra dependencies or assumptions
- extra adapter complexity
- route state in the contract even when the app does not use it

That is unnecessary ceremony for simple apps.

## Why This Is Not An Automatic No

When an app does adopt client-side routing, the mounted-shell routing problem is real and predictable.

If a routed app keeps `BrowserRouter` inside the mounted tree, it will eventually hit the iframe `srcdoc` problem described in [`mounted-routing.md`](/home/fvrlak/ventures/softbox/docs/mounted-routing.md):

- standalone works
- mounted app renders blank
- console shows `No routes matched location "srcdoc"`

So the generator cannot ignore routing forever either.

## Decision Options

There are two reasonable paths.

### Option 1: Keep the generator generic by default

Default scaffolding stays as it is now:

- no route-specific wrapper logic
- app adds routing only when needed

Then, once an app adopts `react-router-dom`, the wrapper or agent flow adds:

- standalone `BrowserRouter`
- mounted `MemoryRouter`
- route publish/sync logic

This keeps the base scaffold minimal.

### Option 2: Make route-aware scaffolding conditional

The wrapper stays generic unless routing is detected.

Possible triggers:

- app already depends on `react-router-dom`
- app already imports router primitives
- human explicitly asks for routed-app setup

Then `wrap-app` can generate the route split automatically for that app.

This is likely the strongest long-term compromise.

## Recommended Direction

The better default is:

- do **not** force router scaffolding into every new app
- do add route-aware scaffolding once the app explicitly adopts routing

That means:

- generic apps stay simple
- routed apps get the correct mounted behavior
- the generator avoids baking unnecessary structure into non-routed apps

## Practical Rule For Now

Until the generator is updated, use this rule manually:

- if the app has no routing, keep the generic adapter
- if the app uses `react-router-dom`, split routing by entry path

Meaning:

- standalone entry: `BrowserRouter`
- mounted adapter: `MemoryRouter`

## Follow-Up Work

This still needs a tooling decision and then implementation in the generator path.

The likely place to enforce it is:

- [`scripts/wrap-app.ts`](/home/fvrlak/ventures/softbox/scripts/wrap-app.ts)

because `pnpm new-app` already funnels new blank apps through that wrapper step in:

- [`scripts/new-app.mjs`](/home/fvrlak/ventures/softbox/scripts/new-app.mjs)
