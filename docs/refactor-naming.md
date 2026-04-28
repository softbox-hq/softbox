# App Identity Refactor Notes

This note records the app naming and identity refactor so future onboarding, rename work, and debugging do not fall back into the old model by accident.

## Why This Refactor Happened

Previously, Softbox treated the app folder name under `/apps` as the canonical app identity.

That meant one value was doing too much:

- runtime identity
- storage/artifact namespace
- Convex primary key
- box/agent identity
- human-facing app name
- implicit slug

That made rename expensive and unsafe because changing a human-facing name also meant changing system identity.

The refactor separates those concerns.

## New Model

Each wrapped app now has three different identity fields:

- `appId`
  Stable internal id. Opaque form like `app_d4a7f1c2`.
  This is the canonical runtime identity.
- `name`
  Human-facing display name like `Snake Game`.
- `slug`
  Human-readable slug like `snake-game`.
  This is metadata, not the runtime identity.

The app folder under `/apps/<folder>` is now just a source location.

Important rule:

- folder path is no longer the app identity

## Current Config Shape

Wrapped apps now persist identity in `softbox.config.json`.

Example:

```json
{
  "appId": "app_6f31a8de",
  "name": "Snake Game",
  "slug": "snake-game",
  "runtime": "react-vite"
}
```

## What Changed

### 1. Shared Identity Utilities

Added:

- `worker/src/appIdentity.ts`

This centralizes:

- opaque app id generation
- slug normalization
- slug validation
- display-name normalization

The point is to avoid each entry point inventing its own rules.

### 2. Wrapped App Discovery

Updated:

- `worker/src/templates.ts`

Wrapped app discovery now reads:

- `appId`
- `slug`
- `name`

from `softbox.config.json`.

If `appId` is present, it is the source of truth.
If `slug` is present, it is the source of truth for the human-readable slug.

Folder names are still used as fallback for legacy compatibility, but that is now fallback behavior only.

It also now checks for:

- duplicate `appId`
- duplicate `slug`

across wrapped apps.

### 3. App Creation

Replaced:

- `scripts/new-app.mjs`

With:

- `scripts/new-app.ts`

And updated:

- `package.json`

New behavior:

- `pnpm new-app` creates a folder from the slug
- it generates or accepts a stable opaque `appId`
- it passes `appId`, `name`, and `slug` into `wrap-app`
- seeding happens by `appId`, not by folder name

The shell create-app API now also uses:

- name
- optional slug

instead of asking the user for the internal app id directly.

### 4. Wrapping

Updated:

- `scripts/wrap-app.ts`

`wrap-app` now:

- accepts `--app-id`
- accepts `--name`
- accepts `--slug`
- writes those fields into `softbox.config.json`

If they are not supplied, it will preserve existing config values when present or generate sensible defaults.

### 5. Convex App Records

Updated:

- `convex/schema.ts`
- `convex/apps.ts`
- `worker/src/convex.ts`
- `worker/src/shared/convexApi.ts`

Convex app docs now store:

- `appId`
- `slug`
- `name`

`appId` remains the canonical identity.

`seedApp` now writes:

- `name`
- `slug`

along with `appId`.

App listing and app config queries now return `slug` so the shell can display and edit it.

### 6. Shell UI

Updated:

- `shell/src/ShellHostSurface.tsx`
- `shell/src/App.tsx`
- `shell/vite.config.ts`

The shell now:

- creates apps from display name + optional slug
- keeps the internal `appId` hidden from normal create flow
- shows app names normally
- shows slug in places where human-readable identity is helpful
- lets the settings modal update `name` and `slug`

The settings modal intentionally does not allow editing `appId`.

### 7. Existing Wrapped Apps

Updated:

- `apps/dashboard/softbox.config.json`
- `apps/pretext-test/softbox.config.json`
- `apps/snake-game/softbox.config.json`
- `apps/space/softbox.config.json`

Those apps were assigned explicit opaque ids so the repo is already operating under the new model.

## Operational Meaning

### `appId` Is Still The Runtime Identity

These systems still key off `appId`:

- Convex app records
- jobs
- versions
- runtime errors
- pipeline runs and stages
- artifact paths under `apps/<appId>/...`
- OpenClaw agent identity and box identity

That is intentional.

The difference is that users no longer have to see or manipulate that id as the app's name.

### `slug` Is Editable Metadata

Right now `slug` is:

- stored in Convex
- stored in `softbox.config.json`
- used in shell display/debugging

Right now `slug` does not:

- rename the source folder
- rename `package.json`
- rename historical artifacts

That is intentional. The goal of this refactor was to decouple human naming from runtime identity.

### Folder Name Is Now Just Source Location

Do not assume:

- `/apps/space` means runtime id `space`

It may now mean:

- folder: `apps/space`
- appId: `app_1b72c9ef`
- name: `Space`
- slug: `space`

## Settings Modal Behavior

The desktop app settings modal now edits:

- display name
- slug

It updates:

- Convex app metadata
- local `softbox.config.json`

It does not update:

- folder name
- package name
- stable `appId`

That is by design.

## Debugging Guide

### App Does Not Show Up In Wrapped App Discovery

Check:

- app has `softbox.config.json`
- `softbox.config.json` contains valid `appId`
- `softbox.config.json` contains valid `slug`
- no duplicate `appId`
- no duplicate `slug`

Main file:

- `worker/src/templates.ts`

### App Shows In `/apps` But Seeding Fails

Check:

- `softbox.config.json` exists
- `src/entry.tsx` exists
- `src/defaultState.ts` exists
- `pnpm seed -- --app <appId> --force` is using the opaque `appId`, not the folder name

Main files:

- `worker/src/templates.ts`
- `worker/src/seed.ts`

### Create Flow Works But App Uses Unexpected Identity

Check:

- `shell/vite.config.ts` create-app middleware
- `scripts/new-app.ts`
- `scripts/wrap-app.ts`
- resulting `softbox.config.json`

The expected flow is:

- shell sends `name` and optional `slug`
- server generates `appId`
- `new-app` scaffolds folder from slug
- `wrap-app` writes `appId`, `name`, `slug`
- `seed` persists by `appId`

### Settings Modal Save Succeeds But UI Looks Stale

Check:

- `shell/src/ShellHostSurface.tsx`
- `shell/vite.config.ts` `/__softbox/apps/update-metadata`
- `convex/apps.ts` `updateAppMetadata`

Remember that changing `slug` or `name` will not rename folders or package names.

### OpenClaw Agent Confusion

OpenClaw sync still uses the stable `appId`.

That means agent identity should remain stable if only `name` or `slug` changes.

Main file:

- `worker/scripts/sync-openclaw-agents.ts`

## Migration / Compatibility Notes

This refactor did not migrate old Convex state or old artifacts from the legacy folder-name ids.

That was an intentional tradeoff because the current local apps were allowed to be reset.

Practical implication:

- old local app state keyed by folder-name ids may no longer line up with the new explicit opaque ids

If local state is confusing after this refactor, the clean fix is:

1. delete/reset old app state in Convex for the legacy ids
2. reseed the wrapped apps under their new opaque ids
3. restart the dev stack

## Safe Rules Going Forward

- Treat `appId` as immutable runtime identity.
- Treat `name` as editable display text.
- Treat `slug` as editable human-readable metadata.
- Do not build new features that assume folder name equals app id.
- Do not expose `appId` as the primary thing users rename.
- If a future feature needs URLs or routing, prefer `slug` over `appId`.
- If a future feature needs absolute stability, use `appId` only.

## Files Touched In This Refactor

- `worker/src/appIdentity.ts`
- `worker/src/templates.ts`
- `worker/src/seed.ts`
- `worker/src/convex.ts`
- `worker/src/shared/convexApi.ts`
- `scripts/new-app.ts`
- `scripts/wrap-app.ts`
- `shell/vite.config.ts`
- `shell/src/ShellHostSurface.tsx`
- `shell/src/App.tsx`
- `convex/schema.ts`
- `convex/apps.ts`
- `apps/*/softbox.config.json`

## Short Version

Softbox no longer uses the folder name under `/apps` as the only identity.

Now the model is:

- stable internal `appId`
- editable `name`
- editable `slug`
- folder path as source location only

That separation is the main protection against rename-related complexity going forward.
