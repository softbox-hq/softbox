# Datahub Architecture

This document sketches the recommended architecture for a standalone `datahub` service that the live runtime can call over HTTP.

## Why A Separate Datahub

The runtime currently has too many possible data paths:

- generated asteroid scenes from `ELEMENTS.NUMBR`
- generated planet/moon scenes from JPL Horizons
- ad hoc object edits from the agent

That creates drift and ambiguity. The better model is:

- one authoritative backend
- one JSON contract
- one place for astronomy/domain logic
- one place for caching and normalization

The runtime should not own external data-source logic directly.

## Placement

Build it as a standalone sibling project, not inside this repository.

Recommended path:

```text
/home/fvrlak/projects/datahub
```

This repository stays focused on:

- shell UI
- worker / agent orchestration
- live app templates
- prompt-to-render pipeline

The `datahub` owns:

- upstream astronomy sources
- normalization
- cache/storage
- stable scene payloads

## Recommended Stack

- Python
- FastAPI
- Pydantic
- `httpx`
- Convex for cache / metadata / request history

Rationale:

- Python is the better foundation for future astronomy/scientific libraries.
- FastAPI gives a clean local HTTP service on `localhost:3001`.
- Pydantic gives explicit schemas for the JSON contract.
- Convex can hold normalized cached results without introducing Postgres.

## Architectural Boundary

Make the boundary HTTP/JSON only.

That means:

- `softbox` does not import backend code
- the worker does not reach into backend internals
- the agent should use sanctioned commands or HTTP calls only
- all cross-app communication happens through explicit API endpoints

This keeps the language split clean and intentional.

## High-Level Flow

1. User asks for a scene, body lookup, or domain-derived visualization.
2. The worker/agent chooses a sanctioned datahub action.
3. The runtime or generator calls `datahub` on `localhost:3001`.
4. `datahub` checks Convex cache.
5. On cache miss, `datahub` fetches and computes from upstream sources.
6. `datahub` normalizes the result into one stable scene schema.
7. `datahub` writes the normalized result back to Convex.
8. The caller receives JSON and writes/uses generated scene state.

## Suggested Project Structure

```text
datahub/
  app/
    main.py
    config.py
    api/
      health.py
      scene.py
      bodies.py
    services/
      horizons.py
      scene_builder.py
      cache.py
    clients/
      convex.py
    models/
      body.py
      scene.py
  tests/
  pyproject.toml
  README.md
```

## First Endpoints

Start narrow.

- `GET /health`
- `POST /scene/solar-system`
- `POST /scene/catalog`
- `GET /bodies/{id}`
- `POST /bodies/lookup`

## Example Contract

Request:

```json
{
  "bodies": ["earth", "moon", "jupiter", "europa"],
  "date": "2026-03-19"
}
```

Response:

```json
{
  "objects": [],
  "camera": {
    "position": { "x": 0, "y": 0, "z": 10 },
    "target": { "x": 0, "y": 0, "z": 0 },
    "fov": 45
  },
  "meta": {
    "source": "datahub",
    "cacheHit": true
  }
}
```

## What Datahub Should Own

The `datahub` should be the only place that knows about:

- JPL Horizons requests
- future SPICE/ephemeris integration
- catalog parsing rules
- body aliases and supported identifiers
- caching policy
- scene normalization rules

This repository should only consume normalized results.

## Role Of The Agent

The headless agent should not invent data.

For data tasks, its job becomes:

- understand the prompt
- choose the correct sanctioned command or API route
- trigger generation
- optionally make small UI/rendering edits

Examples:

- `show Neptune and Triton`
  - agent should call a datahub-backed generation path
- `make labels larger`
  - agent should edit frontend code

That is the correct split:

- data retrieval/normalization = `datahub`
- UI behavior = live app code
- agent = orchestrator

## First Milestone

Do only one useful vertical first:

- `GET /health`
- `POST /scene/solar-system`
- support bodies like:
  - `sun`
  - `earth`
  - `moon`
  - `jupiter`
  - `io`
  - `europa`
  - `ganymede`
  - `callisto`
  - `neptune`
  - `triton`

Do not try to build a universal data backend on day one.

## Future Evolution

Later, the worker can replace direct Horizons generators with one sanctioned path like:

```bash
pnpm generate:datahub -- --system jupiter --moons major
```

or call `datahub` directly over HTTP.

That would give the runtime:

- fewer source-specific scripts
- better consistency
- easier auditing
- better agent reliability
