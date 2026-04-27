# Claude Code Guide

Claude Code should use this file as a short pointer, not as a full setup guide.

Read [`AGENTS.md`](./AGENTS.md) first for repo operating rules. For local
installation or repair, read [`SETUP.md`](./SETUP.md) and follow it exactly.

## What To Use For What

- `SETUP.md`: installation, `.env.local`, Convex, OpenClaw, Redis, MinIO/R2,
  seeding, and troubleshooting
- `AGENTS.md`: repository rules for coding agents
- `skills/softbox-wrap-app/SKILL.md`: wrapping or onboarding a new app
- `apps/<app>/AGENTS.md`: app-local rules before editing a hosted app

## Critical Rules

- Use `pnpm`, not `npm install`, at the repo root.
- Use `pnpm run doctor`, not `pnpm doctor`.
- Do not put trailing slashes on `VITE_CONVEX_URL` or `CONVEX_URL`.
- Keep `AGENT_COMMAND=openclaw` for the normal Softbox flow.
- Make sure `OPENCLAW_GATEWAY_TOKEN` is set from
  `~/.openclaw/openclaw.json`.
- Keep app-specific changes inside the selected `apps/<app>/` workspace unless
  the user asks for shell, worker, Convex, or docs work.
- Do not assume a folder under `apps/` is mounted. A Softbox-hosted app needs
  wrapping, `softbox.config.json`, `src/entry.tsx`, `src/defaultState.ts`, and
  Convex app state.

## Quick Verification

```bash
pnpm run doctor
openclaw gateway status
openclaw agents list --json
pnpm worker:openclaw-sync-agents -- --apply
```
