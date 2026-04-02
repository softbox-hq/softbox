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
6. repaired local OpenClaw state with `openclaw doctor --repair --non-interactive --yes`
7. verified the real machine gateway path with an unsandboxed `openclaw gateway probe --token ...`
8. completed OpenAI OAuth with `openclaw models auth login --provider openai-codex --method oauth --set-default`
9. verified final runtime state with `openclaw status`

## Machine Walkthrough

This is the exact sequence that worked on this machine.

### 1. Initial state

The repo `.env.local` already had:

```bash
OPENCLAW_GATEWAY_BASE_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=...
OPENCLAW_AGENT_ID_PREFIX=softbox-1997083b-
OPENCLAW_SESSION_KEY_PREFIX=softbox
```

`~/.openclaw/openclaw.json` existed, but the gateway and auth state were inconsistent:

- `openclaw status` reported the dashboard URL but showed the gateway as unreachable
- `openclaw devices list --json` failed because `gateway.auth.token` was configured as a SecretRef that was unavailable on that command path
- `openclaw doctor` reported a missing session store at `~/.openclaw/agents/main/sessions`

### 2. Repair local OpenClaw state

The missing session store was repaired with:

```bash
openclaw doctor --repair --non-interactive --yes
```

That created:

```text
~/.openclaw/agents/main/sessions
```

Important caveat:

- `openclaw doctor` still warned that the gateway token SecretRef was unresolved in some command paths
- that warning was real and later mattered

### 3. Distinguish sandbox failures from real machine state

Inside the Codex sandbox, local gateway probe commands still failed with errors like:

```text
listen EPERM: operation not permitted 0.0.0.0:18789
gateway closed (1006)
```

Running the same probe outside the sandbox succeeded:

```bash
openclaw gateway probe --token "$OPENCLAW_GATEWAY_TOKEN"
```

Observed result:

```text
Reachable: yes
Connect: ok
RPC: ok
```

That meant the real machine gateway was healthy enough for OAuth, and the remaining sandbox-only failures were not the source of truth.

### 4. Re-run local onboarding interactively

The working interactive onboarding command was:

```bash
OPENCLAW_GATEWAY_TOKEN=... openclaw onboard \
  --accept-risk \
  --mode local \
  --flow manual \
  --skip-daemon \
  --skip-health \
  --skip-search \
  --skip-skills \
  --skip-channels \
  --workspace /home/fvrlak/ventures/softbox \
  --gateway-auth token \
  --gateway-token "$OPENCLAW_GATEWAY_TOKEN" \
  --gateway-token-ref-env OPENCLAW_GATEWAY_TOKEN \
  --auth-choice oauth
```

During that wizard, the important choices were:

- `Use existing values`
- gateway port `18789`
- gateway bind `Loopback (127.0.0.1)`
- gateway auth `Token`
- tailscale `Off`
- token storage `Generate/store plaintext token`
- keep the existing token value
- hooks `Skip for now`

That token storage choice matters.

The earlier SecretRef-based gateway token setup caused command-path inconsistency on this machine. Rewriting the gateway token as a locally stored plaintext value in `~/.openclaw/openclaw.json` made the local gateway/tooling behave consistently.

After that onboarding pass, OpenClaw showed:

- Control UI reachable at `http://127.0.0.1:18789/`
- Gateway reachable
- gateway token stored locally

### 5. OpenAI auth: what failed and what worked

The plain OpenAI provider path was not the OAuth path.

This command:

```bash
openclaw models auth login --provider openai --method oauth --set-default
```

opened an API key prompt instead of a browser login.

The working OpenAI OAuth path on this machine was:

```bash
openclaw models auth login --provider openai-codex --method oauth --set-default
```

That launched a browser-based OpenAI OAuth flow with a localhost callback on port `1455`.

After browser completion, OpenClaw reported:

```text
OpenAI OAuth complete
Auth profile: openai-codex:fvrlak@gmail.com (openai-codex/oauth)
Default model set to openai-codex/gpt-5.4
```

### 6. Final verification

The final verification command was:

```bash
openclaw status
```

The important resulting state was:

- gateway reachable at `ws://127.0.0.1:18789`
- local loopback bind
- auth token enabled
- default session model `gpt-5.4`

## Practical Notes

- If the Softbox UI says the gateway is unhealthy, verify whether the failure is inside the sandbox or on the actual machine before changing config again.
- If OpenClaw commands fail with unresolved SecretRef token errors, prefer a local plaintext gateway token for local-only development instead of an env SecretRef.
- For OpenAI browser auth on this machine, use `openai-codex` OAuth, not `openai`.
- The successful OAuth command was external to Convex and external to Softbox state. Softbox only orchestrates the local machine flow.

## Summary

What Softbox now does:

- discovers OpenClaw local config from `~/.openclaw`
- bootstraps gateway config from the UI
- starts and stops the local OpenClaw gateway from the UI when needed
- mirrors worker env into `.env.local`
- runs local auth from the UI
- auto-starts the local gateway before `openclaw onboard` when local gateway mode is configured
- exposes pairing approval and agent sync from the UI

What worked on this machine:

- repair OpenClaw local state first
- validate the gateway outside the sandbox
- switch gateway token storage away from SecretRef for local-only use
- use `openai-codex` OAuth to authenticate OpenAI
