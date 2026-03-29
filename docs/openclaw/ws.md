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

Important points:

- `OPENCLAW_GATEWAY_BASE_URL` can be `http://` or `ws://`
- the worker normalizes `http://` to `ws://` and `https://` to `wss://`
- the configured OpenClaw agent workspace was `/home/fvrlak/ventures/softbox`
- the gateway was running locally on loopback

The matching agent was:

- agent id: `softbox`
- workspace: `/home/fvrlak/ventures/softbox`

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

Softbox uses OpenClaw sessions per app.

Two pieces matter:

### Session key

Softbox now uses the canonical OpenClaw agent-scoped session-key shape:

```text
agent:<agentId>:<prefix-or-app-scope>
```

For example:

```text
agent:softbox:softbox:test-app
```

This matters because arbitrary keys like `softbox:test-app` were rejected by the gateway with an agent/session mismatch error.

### Persisted session id

Softbox persists the OpenClaw `sessionId` per app in Convex as:

- `apps.openClawSessionId`

That id is saved after a successful run and sent back on the next run.

Behavior:

- if there is no saved OpenClaw session id, the next run creates one
- if there is a saved OpenClaw session id, Softbox attempts to reuse it
- if OpenClaw returns a different session id while resuming, Softbox throws

This matches the same "no silent fallback" rule used for Codex thread reuse.

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
