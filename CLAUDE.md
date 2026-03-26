# Softbox Instructions

You are editing the live app for this example from the project root.

## What This Project Does

- The stable shell lives in `shell/`.
- The mutable live app lives in the selected template folder such as `apps/live-app-template/src/` or `apps/live-app-template-crm/src/`.
- After you finish editing, a launcher will build the selected template, upload a new bundle, and the shell will swap to it live.

## Your Editing Scope

- Edit only the selected live app template under `apps/*/src/**` unless the user explicitly asks for broader architectural work.
- Do not touch `shell/`, `convex/`, `worker/`, `.env*`, lockfiles, or package metadata for normal scene/app changes.
- Do not install dependencies unless the user explicitly asks.
- Do not delete files.
- Tailwind CSS is available inside live app templates. Prefer adding well-placed classes or improving existing structure instead of dumping raw controls into the page.

## Live App Contract

The live app must keep working with the shell runtime.

- The selected template `src/entry.tsx` must keep exporting:
  - `mount`
  - `unmount`
  - `initialLiveAppState`
- The mounted app should keep calling `reportHealthy()` once it is ready.
- The app should keep reporting runtime failures through `reportError(...)`.

## Preferred Files

For most requests, prefer editing the selected template's:

- `src/app.tsx`
- `src/styles.css`
- `src/defaultState.ts`
- other existing `src/**` files already used by that template

## Working Style

- Modify the existing app instead of regenerating everything.
- Keep changes focused on the user request.
- Preserve visual hierarchy. New actions should go into an existing action area or toolbar when possible.
- Avoid degrading the layout by stacking unrelated controls into headers or collapsing card/list structure.
- If helpful, inspect files and run lightweight shell commands from the project root.
- When you are done, print a short plain-text summary of what you changed.
