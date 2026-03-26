# Multi-Agent Shell Idea

This note captures the idea of putting OpenClaw-style bots into the shell.

## Core Idea

The shell does not have to be only:

- a prompt box
- a status panel
- a place where one agent rewrites one app

It could become:

- a multi-agent operations room
- a host for several specialized bots with explicit roles

That would shift the shell from:

- "single agent edits the app"

to:

- "a stable runtime where specialized agents cooperate on a live app"

## Why This Could Matter

One general agent is good for direct edits.

But many real tasks contain several different jobs at once:

- data lookup
- entity resolution
- scene generation
- UI edits
- verification
- explanation

Those jobs do not always belong in the same agent.

## Useful Bot Roles

The value is not "more agents."
The value is explicit roles.

### 1. Resolver Bot

Purpose:

- resolves entities and user intent
- finds the right bodies, systems, datasets, or IDs
- decides what structured tools should be used

Examples:

- "Did the user mean Europa the moon or Europa the asteroid?"
- "Which bodies should be auto-included?"

### 2. Builder Bot

Purpose:

- edits the live app
- updates rendering, layout, interactions, and UX

Examples:

- adds labels
- changes scene framing
- modifies controls

### 3. Tool Bot

Purpose:

- calls trusted structured tools only
- talks to `datahub` or generator scripts
- does not improvise domain data

Examples:

- run `generate:datahub`
- call body lookup
- request a solar-system scene

### 4. Verifier Bot

Purpose:

- checks whether the result matches the request
- catches regressions and mismatch

Examples:

- shape got stripped out again
- controls were removed
- labels overlap too much
- focus body is wrong

### 5. Analyst Bot

Purpose:

- compares alternatives
- proposes tradeoffs
- evaluates multiple render modes or app variants

Examples:

- compare fit vs focus camera
- compare two scale modes
- compare two layouts

### 6. Narrator Bot

Purpose:

- explains what is happening
- generates calm status language or voice lines
- makes the shell feel like a command center

Examples:

- "Resolving target bodies."
- "Entering Jovian system."
- "Visual contact established."

## Best First Version

Do not start with many bots.

The strongest first version would only use:

- `Resolver`
- `Builder`
- `Verifier`

That is enough to make the shell feel meaningfully different without turning it into chaos.

## Where It Becomes Powerful

### Complex prompt decomposition

Example:

- "Show Jupiter and all major moons, focus on Europa, compare scale modes."

Possible split:

- resolver identifies relevant bodies
- tool bot generates scene options
- builder updates the app
- verifier checks the output

### Live operations room

The shell could show:

- each bot's role
- current status
- current tool/action
- output summary
- confidence / verification status

This would make the shell feel less like a chat wrapper and more like a control surface.

### Domain-specific copilots

The same shell could host different bot sets for different verticals:

- astronomy
- CRM
- finance
- logistics

The shell stays stable.
The agent roles and app internals change per vertical.

### Continuous watchdogs

A verifier-style bot could run continuously and watch for:

- runtime regressions
- failed controls
- bad data output
- performance regressions

## Why This Fits This Project

This repository is already built around a distinction between:

- stable shell
- mutable app

Adding specialized bots fits that architecture naturally.

The shell becomes:

- the operating system / control room

The mutable app becomes:

- the live program being updated

The bots become:

- specialized operators inside the control room

## Risks

This idea only works if roles stay clear.

Main risks:

- too many bots with overlapping jobs
- noisy UI
- hard-to-understand coordination
- users not knowing which bot to trust

So the rule should be:

- few bots
- explicit responsibilities
- visible handoff points

## Good Principle

Do not add agents to make the system look more advanced.

Add them only when they remove ambiguity between:

- data retrieval
- app mutation
- verification

That is where multiple agents become genuinely useful.
