# Horizons Generator

This repo now has a dedicated NASA/JPL Horizons-backed scene generator for planets and major moons.

## Why

`ELEMENTS.NUMBR` is an asteroid/minor-planet catalog. It is not a correct source for:

- Earth
- Moon
- Jupiter
- Europa / Ganymede / Io / Callisto

So planet-and-moon prompts need a different authority.

## Command

Script:

- [`scripts/generate-horizons.ts`](/home/fvrlak/projects/softbox/scripts/generate-horizons.ts)

Run it with:

```bash
pnpm generate:horizons -- --bodies earth,moon,jupiter
```

Or:

```bash
pnpm generate:horizons -- --bodies jupiter,io,europa,ganymede,callisto
```

Optional date:

```bash
pnpm generate:horizons -- --bodies earth,moon --date 2026-03-19
```

## What It Does

1. Resolves each supported body to a known Horizons numeric ID.
2. Requests heliocentric vector ephemerides from the official JPL Horizons API.
3. Converts the returned kilometer vectors into scene units.
4. Applies a simple radius-based visual scale and stable color mapping.
5. Writes the generated dataset to:
   - [`live-app-template/src/generated/sceneObjects.ts`](/home/fvrlak/projects/softbox/apps/live-app-template/src/generated/sceneObjects.ts)

The live app then consumes that generated file through:

- [`live-app-template/src/objects.ts`](/home/fvrlak/projects/softbox/apps/live-app-template/src/objects.ts)

## Supported Bodies

Currently supported:

- `sun`
- `mercury`
- `venus`
- `earth`
- `moon`
- `mars`
- `jupiter`
- `io`
- `europa`
- `ganymede`
- `callisto`
- `saturn`
- `titan`
- `uranus`
- `neptune`

This is intentionally curated so agent prompts remain deterministic and do not depend on ambiguous name resolution.

## Why A Script Instead Of Direct Agent Calls

The script gives the agent a sanctioned, repeatable tool:

- stable arguments
- stable output path
- stable source authority
- no need to hand-write fake planet data

That means prompts like:

- "show Earth, Moon, and Jupiter"
- "show Jupiter and the Galilean moons"

can be handled by a command instead of improvised scene edits.
