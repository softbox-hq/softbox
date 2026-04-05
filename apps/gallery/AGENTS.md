# Gallery Agent Guide

Read this file before editing the app.

Also read the repo root AGENTS.md for overall Softbox rules.

App root:

- apps/gallery

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
- Never run git commit, git push, open PRs, or publish from a Softbox worker/pipeline run.
- Leave changes as working tree edits only. Softbox captures file diffs and build artifacts; Git history is not part of the runtime flow.
- If you touch the wrapper, make sure mount/unmount still work and reportHealthy is still called.

Generated images:

- When you use `image_generate`, do not stop at the managed media result.
- Always copy the generated binary into `src/assets/` with a deterministic filename.
- Always update the app to use the copied workspace file, not the OpenClaw managed media path.
- In the final response, report both:
  - the original media path
  - the final workspace asset path
- If `image_generate` is unavailable, stop and say so explicitly instead of drawing SVG or other vector fallback art.
