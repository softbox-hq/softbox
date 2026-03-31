# dashboard-example Agent Guide

Read this file before editing the app.

Also read the repo root AGENTS.md for overall Softbox rules.

App root:

- apps/dashboard-example

Main editing targets:

- src/App.tsx or src/app.tsx for UI and behavior
- src/index.css and src/App.css for styling
- src/defaultState.ts for seeded runtime state

Softbox runtime bridge:

- src/entry.tsx
- src/adapter/runtime.tsx
- src/adapter/shellAdapter.tsx

Rules:

- Keep this app runnable as a normal React + Vite app.
- Keep the Softbox wrapper thin.
- Prefer app-local changes over shell changes.
- Do not change softbox.config.json unless template/runtime wiring really changed.
- If you touch the wrapper, make sure mount/unmount still work and reportHealthy is still called.
