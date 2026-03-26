# `ELEMENTS.NUMBR` Ingest

This repo now treats [`live-app-template/ELEMENTS.NUMBR`](/home/fvrlak/projects/softbox/apps/live-app-template/ELEMENTS.NUMBR) as a raw source catalog, not as something the browser should load directly.

## Why

- The file is huge: about `887,105` lines.
- The rows are orbital elements, not ready-made scene coordinates.
- Rendering that raw file directly in React/threejs would be the wrong layer and far too heavy.

## What We Did

We added a preprocessing step:

- Script: [`scripts/generate-elements-numbr.ts`](/home/fvrlak/projects/softbox/scripts/generate-elements-numbr.ts)
- Generated output: [`live-app-template/src/generated/minorPlanets.ts`](/home/fvrlak/projects/softbox/apps/live-app-template/src/generated/minorPlanets.ts)

The script currently:

1. Reads the source file line-by-line.
2. Skips the header rows.
3. Applies optional filters.
4. Parses a bounded subset, currently defaulting to the first `50` matching rows.
5. Converts orbital elements into approximate heliocentric 3D positions.
6. Writes a compact typed dataset for the live app.

## Conversion Model

Each row provides:

- `a`: semi-major axis
- `e`: eccentricity
- `i`: inclination
- `w`: argument of perihelion
- `Node`: longitude of ascending node
- `M`: mean anomaly

The script converts these into a snapshot position like this:

1. Solve Kepler's equation for eccentric anomaly `E`.
2. Compute orbital-plane coordinates:
   - `x' = a (cos(E) - e)`
   - `y' = a sqrt(1 - e^2) sin(E)`
3. Rotate by `w`, `i`, and `Node` into 3D heliocentric space.
4. Scale astronomical units into scene units.

This is a static approximation at the catalog epoch, which is good enough for a first visualization pass.

## Scene Mapping

- `Sun` is added manually at the origin.
- Minor planets are emitted as sphere scene objects.
- AU values are scaled into world units with a constant multiplier.
- Absolute magnitude `H` is converted into a rough visible sphere size.
- Color is derived from orbital characteristics for visual separation.

## Why Only 50

The goal here is to make the pipeline work cleanly before optimizing rendering strategy.

The first `50` rows are enough to:

- verify parsing
- verify orbital conversion
- verify the scene wiring
- avoid flooding the scene with hundreds of thousands of meshes

## How To Regenerate

Run:

```bash
pnpm generate:elements-numbr
```

Or choose a different limit:

```bash
pnpm generate:elements-numbr -- --limit 200
```

Filter by name:

```bash
pnpm generate:elements-numbr -- --name-includes ceres
```

Filter by orbital range:

```bash
pnpm generate:elements-numbr -- --min-a 2.2 --max-a 2.8
```

Filter by brighter/larger objects using absolute magnitude:

```bash
pnpm generate:elements-numbr -- --max-h 7
```

The current live app uses the generated dataset through [`live-app-template/src/objects.ts`](/home/fvrlak/projects/softbox/apps/live-app-template/src/objects.ts).

## Agent Workflow

The intended agent behavior is:

1. recognize when a request is about catalog-derived content
2. run the generator command with the right flags
3. avoid hand-editing the generated dataset unless explicitly asked

Examples that fit the current source:

- "show the first 50 asteroids"
- "show only brighter objects"
- "show objects whose names include Ceres"
- "show only inner-belt objects"

Important limitation:

- `ELEMENTS.NUMBR` is not a general solar-system database
- it does not contain Jupiter moon data
- so a request like "give me all moons of Jupiter" needs another source file or dataset and should not be faked

## Next Steps

If this grows beyond the first 50 objects, the right next steps are:

- render with `InstancedMesh` instead of one React mesh per body
- add optional orbit lines only for selected bodies
- separate data generation from runtime scene state more cleanly
- add camera presets for inner-belt / outer-belt views
