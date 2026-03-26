# Positioning

This document explains how this project relates to tools like Bolt, v0, and Lovable.

## Short Version

They are cousins, not the same thing.

- Bolt / v0 / Lovable are primarily **AI app generation environments**
- this project is primarily an **AI-driven live application runtime**

That distinction matters.

## Shared Family

All of these systems are in the same broad category:

- prompt-driven software creation
- AI-assisted code changes
- iterative conversation with a generated or editable app
- fast feedback loops between prompt and UI

So the comparison is valid.

## Core Distinction

### Bolt / v0 / Lovable

Center of gravity:

- generate an app, page, or product surface quickly
- iterate on code/UI through prompts
- give the user a preview/building environment

Their main story is usually:

- "describe what you want and get an app/site quickly"

That makes them best described as:

- **AI app generation tools**
- **AI authoring/building environments**

### This Project

Center of gravity:

- keep a stable outer shell
- host a mutable inner app
- let an agent rewrite real source code for that app
- rebuild and publish new immutable versions
- preview and promote candidate versions live
- connect the app to trusted structured backends

Its main story is:

- "the shell stays stable while the inner app is rewritten, rebuilt, and swapped live"

That makes this project best described as:

- **an AI-driven live runtime**
- **a stable shell for mutable applications**
- **a prompt-to-render runtime with versioned live app swaps**

## Why "Runtime" Is The Better Word Here

This project is not mainly about creating a new codebase once.

It is about:

- running a mutable app inside a stable host
- repeatedly changing that app
- versioning those changes
- previewing them before activation
- observing the pipeline that got them there

That is runtime behavior, not just generation behavior.

The shell acts more like:

- an operating system
- a host environment
- a control plane for live mutable apps

That is why this project is better framed as a runtime.

## Architectural Difference

The novelty is not "AI can write code."

The novelty is the combination of:

- stable shell
- mutable inner app
- versioned build artifacts
- candidate preview before promotion
- observable pipeline timings
- trusted tool/data backends

Each individual piece exists elsewhere.

The combination is what gives this project its identity.

## Better Comparison Language

Instead of saying:

- "this is like Bolt"

the better framing is:

- "this is in the same family as Bolt/v0/Lovable, but the emphasis is runtime, not just generation"

Or:

- "those tools help generate apps; this system hosts a live mutable app inside a stable shell"

## Platform vs Vertical

Another important distinction:

- the **runtime** is the platform
- the **astronomy app** is one vertical running inside it
- the **datahub** is the trusted backend serving that vertical

So astronomy is not the whole product identity.
It is the first strong proof of the runtime model.

## Practical Positioning

If this project is described publicly, the strongest framing is:

- **AI-driven live runtime for domain apps**

Not:

- generic app builder
- low-code clone
- "AI makes websites"

The sharper framing is:

- stable host shell
- mutable live app
- trusted tool-backed data
- observable prompt-to-render pipeline

## One-Line Distinction

Bolt / v0 / Lovable:

- **AI generation environments**

This project:

- **AI-driven live runtime**
