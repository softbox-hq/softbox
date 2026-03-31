# Mounted App Routing

## Summary

Routed apps need a different router strategy when they are mounted inside Softbox than when they run standalone.

The reason is simple:

- standalone apps own the real browser URL
- mounted apps run inside an iframe created from `srcdoc`

That means a mounted app cannot safely rely on `BrowserRouter` reading `window.location` inside the iframe.

## Symptom

The visible failure looks like this:

- the app works under `pnpm dev`
- the same app renders blank when mounted by Softbox
- the browser console shows:
  - `No routes matched location "srcdoc"`

This is the key signal.

## Why This Happens

The shell runtime mounts live apps inside an isolated iframe-backed document in [`shell/src/runtime.ts`](/home/fvrlak/ventures/softbox/shell/src/runtime.ts).

That iframe is created from `srcdoc`, so the mounted app sees an iframe-local URL based on `about:srcdoc`.

If the app uses `BrowserRouter` inside the mounted tree, React Router reads the iframe's own location, not the shell route state.

For example:

- standalone app routes:
  - `/`
  - `/dashboard`
  - `/chat`
- mounted iframe location:
  - `about:srcdoc`
  - pathname effectively appears as `srcdoc`

Those do not match, so the route tree renders nothing.

## Correct Pattern

The durable pattern is:

1. Keep the route tree router-agnostic.
2. In standalone mode, wrap it with `BrowserRouter`.
3. In mounted Softbox mode, wrap it with `MemoryRouter`.
4. Seed `MemoryRouter` from `initialState.route`.
5. Publish route changes back through `publishState(...)`.

That keeps responsibilities clear:

- standalone app owns browser history
- mounted app owns in-app navigation state
- shell owns the canonical outer route through live app state

## Why `MemoryRouter`

`MemoryRouter` fits the Softbox contract because the shell already passes route state into the app and syncs route state back out.

Relevant shell helpers:

- `applyShellRouteToState(...)`
- `syncShellRouteFromState(...)`

Both live in [`shell/src/runtime.ts`](/home/fvrlak/ventures/softbox/shell/src/runtime.ts).

So the mounted app does not need direct ownership of the browser URL. It only needs a router that can start from the shell-provided route and report navigation changes back.

## What Not To Do

Do not try to fix this by making the shell spoof iframe URLs just to satisfy `BrowserRouter`.

That is brittle because:

- it couples the shell runtime to a specific router implementation
- it makes iframe URL semantics part of app correctness
- it works against the existing `state.route` contract

The stable rule is:

- `BrowserRouter` for standalone
- `MemoryRouter` for mounted mode

## Example

The `react-js-app-1` routing fix followed exactly this split:

- [`apps/react-js-app-1/src/App.jsx`](/home/fvrlak/ventures/softbox/apps/react-js-app-1/src/App.jsx)
  - route tree only
- [`apps/react-js-app-1/src/main.jsx`](/home/fvrlak/ventures/softbox/apps/react-js-app-1/src/main.jsx)
  - standalone `BrowserRouter`
- [`apps/react-js-app-1/src/adapter/shellAdapter.tsx`](/home/fvrlak/ventures/softbox/apps/react-js-app-1/src/adapter/shellAdapter.tsx)
  - mounted `MemoryRouter`
  - route publishing back to Softbox state

## Practical Rule

If an app has client-side routes and it should run both:

- standalone in its own Vite app
- mounted inside Softbox

then the router should be chosen by the entry path, not buried inside the shared app tree.

See also:

- [`router-scaffolding-decision.md`](/home/fvrlak/ventures/softbox/docs/router-scaffolding-decision.md)
  - Notes on whether this pattern should be scaffolded by default in `pnpm new-app` / `pnpm wrap-app` or added only when an app actually adopts routing.
