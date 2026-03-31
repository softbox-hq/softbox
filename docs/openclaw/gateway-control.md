# OpenClaw Gateway Control

This note documents one operational detail that was easy to miss during local debugging:

- killing the `openclaw-gateway` process is not always enough
- on this machine the gateway was being managed by a user `systemd` unit
- so the process could come back immediately unless the service itself was stopped

## What Was Running

The live gateway was owned by:

- unit: `openclaw-gateway.service`
- scope: `systemctl --user`

Relevant checks:

```bash
systemctl --user list-units --type=service --all | rg -i "openclaw|gateway"
systemctl --user list-unit-files | rg -i "openclaw|gateway"
ps -ef | rg -i "openclaw|gateway"
```

## Clean Stop

To stop the gateway so it stays down:

```bash
systemctl --user stop openclaw-gateway.service
```

To confirm it is really down:

```bash
systemctl --user status openclaw-gateway.service --no-pager
ps -ef | rg -i "openclaw|gateway"
```

Expected status:

- `Active: inactive (dead)`

## Foreground Interactive Run

There is no separate `--interactive` mode flag here.

Foreground mode is simply:

```bash
openclaw gateway run --port 18789
```

For a more verbose interactive session:

```bash
openclaw gateway run --port 18789 --verbose
```

`openclaw gateway run` stays attached to the terminal and prints logs directly, which is what you want for local interactive debugging.

## Optional: Prevent Auto-Restart

If you want the user service disabled as well, not just stopped:

```bash
systemctl --user disable --now openclaw-gateway.service
```

To re-enable it later:

```bash
systemctl --user enable --now openclaw-gateway.service
```

Use that only if you actually want to change the machine's default startup behavior.
