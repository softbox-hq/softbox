# react-js-app-1 Agent Guide

Read this file before editing the app.

Also read the repo root AGENTS.md for overall Softbox rules.

App root:

- apps/react-js-app-1

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
- For visual changes, screenshot verification is required even if the user did not ask for it explicitly.
- Do not ask the user whether you should run screenshot verification for visual changes. Just do it.
- Run `pnpm ui:screenshot` from this app's package root after visual changes.
- Inspect `.softbox/screenshots/latest.png` before finishing UI work.
- Do not finish a visual task until the screenshot command succeeded or you explicitly report why it could not run.
- If the screenshot command fails because Playwright Chromium or browser libraries are missing, run `pnpm ui:install-browser` from this app root once.
- If you touch the wrapper, make sure mount/unmount still work and reportHealthy is still called.

When working on visual changes:

1. change the app code
2. run `pnpm ui:screenshot` from this app root
3. inspect `.softbox/screenshots/latest.png`
4. if needed, iterate on the UI
5. only then finish
