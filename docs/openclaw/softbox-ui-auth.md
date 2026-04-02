# Softbox UI OpenClaw Auth

This note documents the OpenClaw auth/bootstrap work added to the Softbox desktop UI, what it changes locally, and what was verified on this machine.

## Goal

Move OpenClaw setup out of ad hoc CLI steps and into the Softbox desktop surface.

The intended UX is:

- Softbox detects local OpenClaw state from `~/.openclaw`
- Softbox bootstraps gateway config itself
- Softbox writes only the worker-facing env mirror into `.env.local`
- Softbox runs `openclaw onboard` locally from the UI
- provider credentials stay local to the machine

That last point matters:

- Softbox should orchestrate auth
- Softbox should not own provider secrets
- Convex should not become the storage layer for OpenClaw or provider credentials

## UI Files

The UI and local middleware changes live in:

- `shell/src/ShellHostSurface.tsx`
- `shell/src/openClaw.ts`
- `shell/vite.config.ts`

The shell uses local Vite middleware endpoints under:

- `/__softbox/openclaw/status`
- `/__softbox/openclaw/configure`
- `/__softbox/openclaw/gateway/bootstrap`
- `/__softbox/openclaw/onboard/start`
- `/__softbox/openclaw/onboard/cancel`
- `/__softbox/openclaw/pairing/approve-latest`
- `/__softbox/openclaw/sync-agents`

These are intentionally local desktop-control endpoints, not Convex APIs.

## How Discovery Works

Softbox now reads local OpenClaw state from:

- `~/.openclaw/openclaw.json`
- `~/.openclaw/identity/device.json`
- repo `.env.local`

The status path inspects:

- gateway mode
- gateway bind
- gateway port
- remote URL
- token SecretRef source
- local env mirror values for the worker
- device pairing state via `openclaw devices list --json`

The important design choice was:

- the UI should not ask the user to paste gateway URL and token if OpenClaw already has enough local config to infer them

## Auto Setup Gateway

The main new action in the Softbox UI is:

- `Auto setup gateway`

That action writes canonical local OpenClaw gateway config using `openclaw config set`.

The applied settings were:

```bash
openclaw config set gateway.mode "\"local\"" --strict-json
openclaw config set gateway.bind "\"loopback\"" --strict-json
openclaw config set gateway.port 18789 --strict-json
openclaw config set gateway.auth.mode "\"token\"" --strict-json
openclaw config set gateway.auth.token --ref-provider default --ref-source env --ref-id OPENCLAW_GATEWAY_TOKEN
openclaw config set gateway.remote.url "\"ws://127.0.0.1:18789\"" --strict-json
openclaw config set gateway.remote.token --ref-provider default --ref-source env --ref-id OPENCLAW_GATEWAY_TOKEN
```

Softbox also updates repo `.env.local` with:

```bash
AGENT_COMMAND=openclaw
OPENCLAW_GATEWAY_BASE_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=...
```

This keeps the worker-facing env mirror aligned with the OpenClaw local config.

## Resulting Local Config

After applying the gateway bootstrap on this machine, `~/.openclaw/openclaw.json` contained:

```json
{
  "gateway": {
    "port": 18789,
    "mode": "local",
    "bind": "loopback",
    "auth": {
      "mode": "token",
      "token": {
        "source": "env",
        "provider": "default",
        "id": "OPENCLAW_GATEWAY_TOKEN"
      }
    },
    "remote": {
      "url": "ws://127.0.0.1:18789",
      "token": {
        "source": "env",
        "provider": "default",
        "id": "OPENCLAW_GATEWAY_TOKEN"
      }
    }
  }
}
```

This is the shape Softbox now expects when it introspects local OpenClaw config.

## Onboard Flow

The Softbox UI can run:

```bash
openclaw onboard --json --non-interactive --accept-risk
```

with different auth choices, including:

- `oauth`
- `openai-api-key`
- `token`
- `openai-codex`

The UI does not send these secrets through Convex.

The shell middleware runs the CLI locally, captures logs, and reports session state back into the desktop panel.

## Pairing Flow

When OpenClaw reports pending pairing requests, the Softbox UI uses:

```bash
openclaw devices approve --latest
```

This follows the earlier finding in [`ws.md`](/home/fvrlak/ventures/softbox/docs/openclaw/ws.md) that the local approval path was more reliable than the explicit gateway approval path.

## Agent Sync

The Softbox UI also exposes the per-app agent repair/create step:

```bash
pnpm worker:openclaw-sync-agents -- --apply
```

This is intended to be the final setup step after gateway config and auth are healthy.

## What Was Verified

Verified in code:

- `pnpm typecheck`
- `pnpm build:shell`

Verified live on this machine:

1. inspected current repo `.env.local`
2. inspected `~/.openclaw/openclaw.json`
3. confirmed local OpenClaw identity exists at `~/.openclaw/identity/device.json`
4. applied gateway config via `openclaw config set ...`
5. confirmed `~/.openclaw/openclaw.json` now contains the expected `gateway` block
6. probed runtime state with `openclaw gateway status`

## Machine-Specific Runtime Result

The config bootstrap succeeded.

The runtime probe still failed on this machine.

Observed status:

```text
RPC probe: failed
systemd user services unavailable
```

Important details from the probe:

- gateway target: `ws://127.0.0.1:18789`
- dashboard URL: `http://127.0.0.1:18789/`
- user `systemd` services were unavailable in this environment

So the current state is:

- config is correct
- the gateway runtime is not yet healthy

## Summary

What Softbox now does:

- discovers OpenClaw local config from `~/.openclaw`
- bootstraps gateway config from the UI
- starts and stops the local OpenClaw gateway from the UI when needed
- mirrors worker env into `.env.local`
- runs local auth from the UI
- auto-starts the local gateway before `openclaw onboard` when local gateway mode is configured
- exposes pairing approval and agent sync from the UI
