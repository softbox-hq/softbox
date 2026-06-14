# OpenClaw Model/Auth Repair

This note records the OpenClaw failure mode seen on this checkout on
2026-06-14 and the repair sequence that fixed it.

## Symptoms

The first gateway call failure was:

```text
GatewayClientRequestError: provider/model overrides are not authorized for this caller.
```

Softbox was passing an explicit model override from `AGENT_MODEL`, so the worker
was changed to leave OpenClaw gateway model overrides off by default:

```bash
AGENT_MODEL=
OPENCLAW_ALLOW_MODEL_OVERRIDES=false
```

After removing Softbox's per-call override, OpenClaw then failed from its own
local default model state:

```text
GatewayClientRequestError: FailoverError: Unknown model: openai-codex/gpt-5.4.
Found agents.defaults.models["openai-codex/gpt-5.4"], but no matching models...
```

That second error was not caused by Softbox request parameters. It came from
OpenClaw's local config and auth store.

## Root Cause

The installed OpenClaw version was already current:

```bash
openclaw --version
npm view openclaw version
```

Both reported `2026.6.6`.

The real issue was local state drift after an OpenClaw model/auth migration:

- `~/.openclaw/openclaw.json` still referenced legacy
  `openai-codex/gpt-5.4` model routes.
- Current OpenClaw expected canonical `openai/gpt-5.4` routes with the Codex
  runtime attached.
- auth profiles still existed in legacy per-agent JSON files, but active
  gateway execution was reading per-agent SQLite auth stores.
- the running gateway process had been started before the repair and had not
  loaded the newly installed/enabled `codex` agent harness.

## Repair Sequence

Repair OpenClaw's own state first:

```bash
openclaw doctor --repair --non-interactive --yes
```

The useful doctor repairs were:

- migrated `openai-codex/*` routes to `openai/*`
- installed/enabled the `codex` runtime plugin
- migrated legacy auth profile JSON into per-agent SQLite auth databases
- repaired old session metadata that still referenced `openai-codex`

Then repair Softbox's per-app agent registrations:

```bash
pnpm worker:openclaw-sync-agents -- --apply
```

If the gateway was already running before doctor repaired OpenClaw, restart the
gateway so it loads the repaired config and the `codex` harness:

```bash
openclaw gateway run --port 18789 --verbose
```

For a detached local run:

```bash
setsid openclaw gateway run --port 18789 --verbose >/tmp/softbox-openclaw/gateway.log 2>&1 < /dev/null &
```

## Verification

After repair, the effective default model looked like:

```json
{
  "model": {
    "primary": "openai/gpt-5.4"
  },
  "models": {
    "openai/gpt-5.4": {
      "agentRuntime": {
        "id": "codex"
      }
    }
  }
}
```

The failing app agent had active SQLite auth profiles:

```bash
openclaw models auth list --agent softbox-1997083b-app_c5056a44 --json
```

The final gateway smoke call returned:

```text
status: ok
text: OK
provider: openai
model: gpt-5.4
agentHarnessId: codex
```

## Notes

`openclaw doctor --repair` can change files under `~/.openclaw` and may also
rewrite local heartbeat templates. Check the repo worktree after running it and
do not commit unrelated template churn.
