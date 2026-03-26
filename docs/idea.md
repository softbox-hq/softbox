# The Idea

## What This Project Is Trying To Prove

Most AI product demos stop at one of these layers:

- prompt to state mutation
- prompt to JSON actions
- prompt to code generation in a chat window
- prompt to a new git diff that still requires a normal rebuild/deploy cycle

This project is testing a different interaction:

1. the user writes a natural-language prompt
2. an agent rewrites real frontend code
3. the app rebuilds immediately
4. the running browser session swaps to the new bundle
5. the previous version stays alive if the new one is broken

The goal is to make code itself part of the live runtime loop.

## The Key Mental Model

There are two systems in the repository:

- the shell
- the live app

The shell is stable.
It owns:

- prompt submission
- version loading
- health checks
- runtime error reporting
- rollback

The live app is intentionally mutable.
It is the thing Claude edits in response to prompts.

This is closer to an operating system and a guest program than to a traditional single-bundle app.

## Why Rewrite Code At All

A lot of AI UI demos can be implemented as:

- intent parsing
- structured actions
- direct state updates

That is often the right answer.

But this project is exploring a more ambitious possibility:

- the user is not only manipulating scene state
- the user is asking the system to evolve the app itself

Examples:

- "Move object A to the center"
- "Change the labels to a minimal HUD"
- "Turn this scene into a CRM-style customer table"
- "Add a side panel with object details and selection controls"

Once the agent is allowed to edit real source, the target is no longer just state. It is the application.

## Why The Shell Exists

If the model edits the same app that is responsible for its own prompt UI, version management, and rollback, the whole thing becomes fragile very quickly.

So the project isolates the responsibilities:

- the shell stays dependable
- the live app can be rewritten aggressively

That separation lets the project support:

- side-by-side preview of new versions
- safe promotion only after `reportHealthy()`
- automatic rollback on import, mount, or startup failure

## Why Claude Gets The Project Root

The project intentionally avoids a heavily hand-authored "rewrite API".

Instead, Claude is launched from the real repository root and told to read `CLAUDE.md`.

That means the behavior is guided primarily by:

- the repository structure
- the root instructions
- the live files themselves

The worker is not supposed to be the intelligence layer.
It is just the relay that:

- claims jobs
- invokes Claude
- builds
- uploads
- records results

## Why Convex And R2

The system needs two kinds of storage:

- a realtime control plane
- immutable build artifact hosting

Convex is used for:

- app records
- editable file snapshots
- prompt jobs
- versions and metadata
- runtime/build error state

R2 is used for:

- immutable versioned JavaScript artifacts
- manifests
- chunk files

This keeps "system state" separate from "deployed bundle artifacts."

## What Makes This Different From A Normal Dev Server

This is not Vite hot module replacement.

In HMR, a local toolchain detects file changes and swaps modules for developers.

In this project:

- the edits come from an AI agent
- the output is versioned like deployment artifacts
- the browser promotes a new version only after runtime health checks
- the shell can keep running while the live app changes under it

So the feel is similar to hot reload, but the mechanism is closer to a tiny deployment platform.

## Current Non-Goals

This repository is not trying to solve everything yet.

Current non-goals:

- public multi-user access
- security hardening for hostile prompts or hostile users
- arbitrary backend code generation
- persistent multi-step agent planning
- dynamic dependency installation during normal prompts
- general app hosting for strangers on the internet

This version is intentionally local-first and controlled.

## What Success Looks Like

A successful prompt does not merely update data.

It produces a real new version of the app:

- Codex edits `apps/live-app-template/src/**`
- the worker builds `vN+1`
- the shell previews it
- the shell promotes it only after the new bundle proves it is healthy

That is the central idea:

prompt -> code edit -> build -> immutable version -> live swap
