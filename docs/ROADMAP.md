# Roadmap

This document is a step-by-step plan for turning the current prototype into something broadly usable without losing the core idea:

- a stable shell
- a mutable live app
- an agent that can change the app live
- trusted structured data behind the app

The roadmap starts from the current state of the repository on 2026-03-19.

## Current State

What already works:

- stable shell with overlay controls
- prompt-to-job pipeline through Convex and the worker
- versioned live bundle builds and swaps
- pipeline timing telemetry
- Codex SDK integration with reusable threads in the worker
- `datahub` prototype as a separate FastAPI app
- local `generate:datahub` script in this repo
- first `datahub` endpoints:
  - `GET /health`
  - `GET /bodies/{id}`
  - `POST /bodies/lookup`
  - `POST /scene/solar-system`
- focus mode from `datahub` into the generated scene config
- auto-inclusion of parent bodies for moons

What is still prototype-level:

- body data is curated/static, not yet pulled from a real provider at runtime
- `datahub` is not yet using Convex for cache/storage
- agent routing still relies heavily on prompt instructions
- the scene UX is good enough for testing, not yet polished
- no auth or multi-app data separation in `datahub`
- no formal integration contract between `softbox` and `datahub`

## Product Goal

The meaningful end state is not "AI can edit a threejs demo."

The meaningful end state is:

- the user can ask for domain-specific views and behavior
- the agent uses trusted structured tools and data sources
- the app updates live and predictably
- the system stays debuggable and observable
- the same architecture can support multiple verticals, not only astronomy

That means the work should now shift from “prove the concept” to:

- make the system predictable
- make the data path authoritative
- make the agent deterministic enough for repeated use

## Guiding Rules

These rules should shape all future work:

1. Keep the shell stable.
2. Move domain intelligence out of prompts and into tools/services.
3. Prefer one trusted API over many source-specific hacks.
4. Keep the agent as orchestrator, not source-of-truth.
5. Make rendering state explicit and inspectable.
6. Optimize only after measuring.
7. Avoid adding broad abstractions before one vertical is solid.

## Phase 1: Stabilize The Current Astronomy Vertical

Goal:

- make the current solar-system flow reliable enough that it works repeatedly without manual intervention

### 1.1 Agent reliability

Tasks:

- tighten `AGENTS.md` around `datahub` usage
- add more explicit examples for:
  - `show X`
  - `focus on X`
  - `show X and Y`
  - `show moon and parent`
- ensure the agent prefers:
  - `generate:datahub`
  - then `generate:horizons` <--- there is no need for generate horizons. preference? we just delete that .... all will be datathub
  - then manual code edits only when truly needed

Done when:

- common prompts reliably choose the right generation path

### 1.2 Scene correctness baseline

Tasks:

- keep `shape` preserved in runtime state
- keep object rendering, labels, and controls as hard baseline rules
- keep camera focus from generated config working
- keep selected body visible after generation
- verify moon parent auto-inclusion for all supported moons

Done when:

- the app consistently renders the requested bodies with correct shapes, camera focus, and usable spacing

### 1.3 Rendering UX cleanup

Tasks:

- finalize label strategy:
  - selected/hovered only
  - maybe optional toggle later
- smooth camera transition on scene update
- reduce initial clutter in dense scenes
- confirm `WASDQE` plus mouse orbit always survives agent edits

Done when:

- the astronomy scene is comfortable to inspect and navigate, not just technically correct

## Phase 2: Formalize The Runtime <-> Datahub Contract

Goal:

- stop relying on “whatever the generator happens to write” and define a stable application protocol

### 2.1 Freeze the scene schema

Tasks:

- define a stable JSON schema for:
  - scene objects
  - camera
  - selection
  - metadata
- document it in `docs/`
- validate generated responses against it in both repos

Done when:

- both `datahub` and `softbox` agree on one render contract

### 2.2 Add generated config as first-class concept

Tasks:

- keep `sceneObjects.ts` and `sceneConfig.ts` as the canonical generated pair
- document ownership clearly:
  - generator owns them
  - agent should not hand-edit them
- add guardrails/tests against regressions

Done when:

- scene content and camera config are generated intentionally, not by convention

### 2.3 Improve generator ergonomics

Tasks:

- add support for:
  - `--focus-body-id`
  - `--view fit|focus`
  - `--auto-include-parents true|false`
- make error messages clean and agent-friendly
- add a dry-run or inspect mode later if useful

Done when:

- the generator is a proper tool surface, not a thin script hack

## Phase 3: Make Datahub A Real Source Of Truth

Goal:

- evolve `datahub` from curated prototype to authoritative service

### 3.1 Expand domain model

Tasks:

- move body definitions out of a tiny hardcoded catalog where appropriate
- support more planets and major moons
- support aliases and canonical ids systematically
- normalize display vs physical values explicitly

Done when:

- the body model feels intentional and extensible

### 3.2 Add provider layer

Tasks:

- implement real provider adapters behind `datahub`
- start with one external source path
- keep provider-specific quirks behind service adapters
- do not leak provider naming into route contracts

Candidate sources:

- Horizons
- later SPICE

Done when:

- API consumers do not care which source produced the data

### 3.3 Add Convex-backed cache/storage

Tasks:

- add `datahub` cache lookups through Convex
- store:
  - resolved body metadata
  - scene responses
  - request fingerprints
  - source metadata
- define cache invalidation policy

Done when:

- repeated requests stop recomputing everything
- responses are inspectable and traceable

## Phase 4: Make The Agent Deterministic Enough For Reuse

Goal:

- reduce prompt ambiguity and move toward repeatable system behavior

### 4.1 Route prompts into tool paths

Tasks:

- classify requests into:
  - data generation
  - scene/view change
  - renderer/UI change
  - broader code refactor
- use that to bias the agent:
  - tool first for data
  - code edit first for UI

Done when:

- the agent stops guessing between “edit code” and “call generator” for common requests

### 4.2 Improve worker hints

Tasks:

- provide minimal structured hints to the agent when useful:
  - target app
  - preferred tool
  - likely focus body
- keep it small enough to avoid returning to giant prompt stuffing

Done when:

- the agent is faster and more reliable without heavy context injection

### 4.3 Capture richer agent telemetry

Tasks:

- log:
  - thread reuse
  - tool path used
  - files changed
  - generation command executed
  - agent latency split if possible

Done when:

- failures are attributable to either tool choice, code edit choice, or runtime behavior

## Phase 5: Broaden The Data Model Beyond One Demo

Goal:

- prove this architecture is not limited to one astronomy slice

### 5.1 Add second astronomy mode

Tasks:

- support a second scene family, for example:
  - asteroid subsets
  - orbital groups
  - system presets

Done when:

- the datahub routes feel like a real domain service, not a planet-only toy

### 5.2 Add a second non-astronomy vertical

Tasks:

- choose one additional vertical where the same architecture makes sense
- examples:
  - finance/markets visualization
  - logistics graph
  - CRM/network visualization

Done when:

- the runtime + agent + datahub pattern proves reusable

## Phase 6: Operational Hardening

Goal:

- make the system stable enough to share more broadly

### 6.1 Runtime hardening

Tasks:

- improve rollback and failure reporting
- keep runtime errors obvious in the shell
- guard against agent regressions in scene controls and rendering

### 6.2 Datahub hardening

Tasks:

- health/readiness checks
- request tracing
- error normalization
- timeouts and fallback behavior
- source outage handling

### 6.3 Developer ergonomics

Tasks:

- one command to run runtime + datahub together
- documented local setup
- clearer logs across both apps
- sample prompts

Done when:

- another developer can run the whole thing without hand-holding

## Phase 7: Publicly Usable Beta

Goal:

- make it coherent enough to show, explain, and reuse outside the current local workflow

Minimum bar:

- stable shell UX
- predictable agent tool routing
- real structured data path
- scene generation that works repeatedly
- clear docs
- understandable architecture
- reproducible local setup

At this point, the project becomes more than a prototype.
It becomes:

- a reusable local runtime architecture
- an agent-driven app mutation system
- a pattern for combining trusted APIs with live editable UIs

## Immediate Next Steps

These are the highest-value next tasks from the current state:

1. Tighten `AGENTS.md` examples around `datahub` focus and parent inclusion.
2. Add one or two integration checks for `generate:datahub` output shape.
3. Add a small camera transition polish in the live app.
4. Move `datahub` from curated-only toward a provider-backed model.
5. Add Convex-backed caching to `datahub`.

## What To Avoid

Avoid these for now:

- overbuilding generic abstractions before one vertical is solid
- exposing many source-specific APIs directly to the agent
- adding many parallel data paths
- making the shell depend on backend internals
- letting the agent hand-author generated datasets
- chasing micro-optimizations before behavior is reliable

## Success Criteria

This system is “usable in a broader meaning” when:

- a user can ask for a domain-specific scene in plain language
- the agent reliably chooses a trusted tool path
- the backend returns normalized structured data
- the runtime renders it live and predictably
- follow-up prompts like focus, add, compare, and refine work consistently
- failures are observable and debuggable
- the architecture is reusable for more than one vertical
