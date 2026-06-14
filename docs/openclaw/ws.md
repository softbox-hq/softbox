# OpenClaw WS Integration

This note documents the OpenClaw integration that Softbox ended up using, why the earlier approaches were rejected, and what was changed in the worker.

## Outcome

Softbox now uses the OpenClaw Gateway over WebSocket by shelling out to:

```bash
openclaw gateway call agent --expect-final --json
```

This is the OpenClaw path used when:

```bash
AGENT_COMMAND=openclaw
```

The implementation lives in:

- `worker/src/agent.ts`
- `worker/src/jobs.ts`
- `convex/apps.ts`
- `convex/schema.ts`

See also:

- [`gateway-control.md`](/home/fvrlak/ventures/softbox/docs/openclaw/gateway-control.md)
  - How to stop the local OpenClaw gateway cleanly when it is running under `systemctl --user`, and how to run it again in foreground interactive mode.
- [`softbox-ui-auth.md`](/home/fvrlak/ventures/softbox/docs/openclaw/softbox-ui-auth.md)
  - How the Softbox desktop bootstraps local OpenClaw gateway config and runs auth from the UI.
- [`model-auth-repair.md`](/home/fvrlak/ventures/softbox/docs/openclaw/model-auth-repair.md)
  - How to repair local OpenClaw model/auth drift after `openai-codex/*` to `openai/*` migration issues.

## Why WS Was Chosen

Three OpenClaw integration options were evaluated.

### 1. HTTP `/v1/responses`

This looked like the cleanest API boundary, but it did not work reliably in the local OpenClaw install.

Observed failure:

```json
{"ok":false,"error":{"type":"forbidden","message":"missing scope: operator.write"}}
```

This happened even after:

- enabling the responses endpoint
- restarting the gateway
- testing the shared gateway token
- rotating a fresh operator device token with write scopes

Conclusion:

- the local gateway could handle read calls
- the HTTP write path was still blocked by OpenClaw auth/scope behavior
- Softbox should not depend on this path

### 2. `openclaw agent`

This worked locally, but OpenClaw's own CLI code falls back to embedded/local execution when the gateway call fails.

That was not acceptable for Softbox because the desired behavior was:

- reuse the existing session when possible
- never silently fall back
- fail loudly if the gateway/session path is broken

Conclusion:

- `openclaw agent` was rejected because it can hide gateway failures behind an embedded fallback

### 3. `openclaw gateway call agent`

This was the final choice.

It worked against the local gateway, returned structured JSON, exposed the OpenClaw `sessionId`, and did not introduce the hidden fallback behavior of `openclaw agent`.

## Required Local Setup

Softbox expects a running OpenClaw gateway and a configured OpenClaw agent whose workspace can edit this repo.

Working local setup used during implementation:

```bash
AGENT_COMMAND=openclaw
OPENCLAW_GATEWAY_BASE_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=...
OPENCLAW_AGENT_ID=softbox
OPENCLAW_SESSION_KEY_PREFIX=softbox
```

Per-app agent mode is also supported:

```bash
AGENT_COMMAND=openclaw
OPENCLAW_GATEWAY_BASE_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=...
OPENCLAW_AGENT_ID_PREFIX=
OPENCLAW_SESSION_KEY_PREFIX=softbox
```

Important points:

- `OPENCLAW_GATEWAY_BASE_URL` can be `http://` or `ws://`
- the worker normalizes `http://` to `ws://` and `https://` to `wss://`
- either `OPENCLAW_AGENT_ID` or `OPENCLAW_AGENT_ID_PREFIX` must be set
- if `OPENCLAW_AGENT_ID_PREFIX` is blank or still `softbox-`, `pnpm run bootstrap` and `pnpm start` rewrite it to a checkout-scoped value like `softbox-a1b2c3d4-` so multiple clones do not collide
- the configured OpenClaw agent workspace was `/home/fvrlak/ventures/softbox`
- the gateway was running locally on loopback

The matching agent was:

- agent id: `softbox`
- workspace: `/home/fvrlak/ventures/softbox`

In per-app mode, Softbox derives the agent id as:

```text
<OPENCLAW_AGENT_ID_PREFIX><appId>
```

For example:

- `softbox-a1b2c3d4-vite-default` -> `/home/fvrlak/ventures/softbox/apps/vite-default`
- `softbox-a1b2c3d4-dashboard-example` -> `/home/fvrlak/ventures/softbox/apps/dashboard-example`

Softbox validates that a per-app agent exists and that its workspace exactly matches the target app root before starting the rewrite.

To create missing per-app agents for every wrapped app in this repo:

```bash
pnpm worker:openclaw-sync-agents
pnpm worker:openclaw-sync-agents -- --apply
```

## What Softbox Sends

The worker now invokes OpenClaw like this conceptually:

```bash
openclaw gateway call agent \
  --expect-final \
  --json \
  --url ws://127.0.0.1:18789 \
  --token "$OPENCLAW_GATEWAY_TOKEN" \
  --params '{...}'
```

The JSON params include:

- `message`
- `agentId`
- `sessionKey`
- optional `sessionId`
- `timeout`
- `idempotencyKey`
- optional `model`

The transport implementation is in `worker/src/agent.ts`.

## Session Reuse

Softbox uses OpenClaw sessions per box.

Two pieces matter:

### Session key

Softbox now uses the canonical OpenClaw agent-scoped session-key shape:

```text
agent:<agentId>:<prefix-or-box-scope>
```

For the default box on an app:

```text
agent:softbox:softbox:test-app
```

For a secondary box:

```text
agent:softbox-vite-default:softbox:openclaw-vite-default-critic
```

This matters because:

- arbitrary keys like `softbox:test-app` were rejected by the gateway with an agent/session mismatch error
- multiple boxes on the same app need different session keys so they do not collapse into one shared conversation

### Persisted session id

Softbox persists the OpenClaw `sessionId` on the selected box in Convex as:

- `boxes.sessionId`

For the primary/default box, the app record still mirrors the same value in:

- `apps.openClawSessionId`

That mirror exists for backward compatibility with older runtime flows.

Behavior:

- if the selected box has no saved OpenClaw session id, the next run creates one
- if the selected box has a saved OpenClaw session id, Softbox attempts to reuse it
- if OpenClaw returns a different session id while resuming, Softbox throws

This matches the same "no silent fallback" rule used for Codex thread reuse.

## Pairing Required

One additional real-world failure showed up after the WS path was already working:

```text
gateway connect failed: GatewayClientRequestError: pairing required
Gateway call failed: Error: gateway closed (1008): pairing required
```

This is a different class of problem from:

- HTTP `/v1/responses` scope failures
- OpenClaw internal `ws-stream ... falling back to HTTP` warnings

It means the local OpenClaw client/device is not approved for the scopes required by `openclaw gateway call agent`.

### Symptoms

- Softbox pipeline fails in the agent stage with `pairing required`
- `openclaw devices list` shows a pending request
- the paired device only has `operator.read`
- the pending request asks for broader scopes like `operator.write`, `operator.admin`, `operator.approvals`, and `operator.pairing`

Example device-state snapshot:

```text
Pending (1)
... scopes: operator.admin, operator.read, operator.write, operator.approvals, operator.pairing

Paired (1)
... scopes: operator.read
```

### What Did Not Work Reliably

Using an explicit gateway URL for approval:

```bash
openclaw devices approve --latest --url ws://127.0.0.1:18789 --token ...
```

This stayed on the gated gateway path and still failed with `pairing required`.

Also note:

- if the token is pasted incorrectly or split across lines, OpenClaw reports `gateway token mismatch`
- `openclaw config set gateway.remote.token ...` can still be useful, but it was not sufficient by itself

### What Worked

The local-fallback approval path:

```bash
openclaw devices approve --latest
```

OpenClaw fell back to local approval mode and approved the pending request successfully.

After that:

```bash
openclaw devices list
```

showed:

- no pending pairing requests
- the paired device upgraded to the required operator scopes

### Practical Rule

If Softbox fails with `pairing required`:

1. run `openclaw devices list`
2. if there is a pending request, run `openclaw devices approve --latest`
3. verify the paired device now has write/admin/operator scopes
4. retry the Softbox run

## Pipeline Observation Changes

The agent stage detail now records:

- `mode: openclaw_ws`
- `thread: new` or `thread: reused`
- `session_key`
- `session_id`

Notes:

- `thread` still means "new vs reused conversation state" even for OpenClaw
- for OpenClaw, that reuse state is derived from the stored `openClawSessionId`

## Problem Found During Real Runs

After the WS path was working, one real bug still showed up in logs:

```text
[tools] read failed: ENOENT: no such file or directory, access '/home/fvrlak/ventures/softbox/vite-default/AGENTS.md'
```

Root cause:

- the prompt told the agent to read `<liveAppLabel>/AGENTS.md`
- `liveAppLabel` was a label like `vite-default`
- that is not the real path in this repo

The actual file is:

```text
apps/vite-default/AGENTS.md
```

Fix:

- prompt construction now uses the repo-relative app root derived from `liveAppRoot`
- the prompt points to `apps/<app-id>/AGENTS.md` instead of `<label>/AGENTS.md`

## About The `ws-stream ... falling back to HTTP` Log

During successful runs, OpenClaw may still log lines like:

```text
[agent/embedded] [ws-stream] WebSocket connect failed ...; falling back to HTTP
```

Important distinction:

- this is inside OpenClaw's own embedded/provider transport
- it is not the same thing as Softbox failing to use the gateway WS transport

If the run returns structured output and the pipeline completes, Softbox's WS gateway call succeeded.

So:

- treat these lines as OpenClaw-internal warnings
- do not confuse them with the Softbox gateway adapter failing

They may still be worth investigating inside OpenClaw, but they are separate from the Softbox worker transport.

## Files Changed

Main code changes for this integration:

- `worker/src/agent.ts`
  - replaced the OpenClaw HTTP path with the WS gateway path
  - added canonical OpenClaw session-key construction
  - added response parsing for gateway agent JSON
  - added strict OpenClaw session-id reuse checks
  - fixed app-local `AGENTS.md` prompt path construction
- `worker/src/jobs.ts`
  - passes persisted `openClawSessionId`
  - stores returned `openClawSessionId`
- `convex/schema.ts`
  - added `openClawSessionId` to app records
- `convex/apps.ts`
  - returns, resets, and persists `openClawSessionId`
- `worker/src/convex.ts`
  - added client method for `setAppOpenClawSession`
- `worker/src/shared/convexApi.ts`
  - added the mutation name
- `worker/test/agent.test.ts`
  - updated session-key and gateway-response parsing tests

## Verification

Verified locally with:

```bash
pnpm exec vitest run worker/test/agent.test.ts
pnpm typecheck
```

Also verified with live local gateway smoke calls using:

```bash
openclaw gateway call agent --expect-final --json
```

## Reverting

To stop using OpenClaw and go back to the current Codex path:

```bash
AGENT_COMMAND=codex
```

No code removal is required. The OpenClaw path is opt-in.
