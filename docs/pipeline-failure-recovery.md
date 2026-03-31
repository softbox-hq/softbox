# Pipeline Failure Recovery Policy

This document describes the failure-recovery policy currently implemented in the worker pipeline.

It is specifically about what happens after a prompt run has already started and one of the later stages fails.

## Goal

The goal is to avoid treating every failed run as a dead end.

A failed pipeline run should:

- keep the active version untouched
- record what failed
- classify the failure
- decide whether automatic recovery is safe

The current implementation is intentionally conservative.

## Current Recovery Model

The worker now distinguishes between:

- `stage_retry`
- `repair_with_agent`
- no automatic recovery

It also records recovery metadata on both the failed `job` and its `pipelineRun`.

Tracked fields now include:

- `failureStage`
- `failureClassification`
- `recoveryMode`
- `recoveryParentJobId`
- `recoveryAttempt`
- `autoRecoveryTriggered`
- `autoRecoveryJobId`

## Failure Classifications

The worker classifies failures into three buckets:

- `infra_transient`
- `code_app`
- `unknown`

The classifier is rule-based and stage-aware.

It currently uses:

- failing pipeline stage
- error text and stack text
- known regex signatures
- current recovery attempt count

## Automatic Recovery Rules

### 1. Infra / transient failures

If a failure looks operational rather than code-related, the worker may enqueue one automatic `stage_retry`.

Examples:

- connection reset
- timeout
- temporary R2/network/service failure
- publish-stage operational failure

What happens:

1. the failed job is marked failed
2. the failure is classified as `infra_transient`
3. the worker enqueues a new recovery job with `recoveryMode: "stage_retry"`
4. that recovery job skips the agent phase
5. it rebuilds and reruns the downstream pipeline from the existing failed workspace candidate

Important detail:

- this retry does not rerun the agent
- it assumes the source code already in the workspace is the candidate to retry

### 2. Code / app failures

If a failure strongly indicates the candidate code itself must change, the worker may enqueue one automatic `repair_with_agent` run.

Examples:

- `Failed to resolve import`
- `Cannot find module`
- `Module not found`
- `Could not resolve`
- TypeScript build errors such as `TS2307`
- syntax errors and similar build-time code failures

What happens:

1. the failed job is marked failed
2. the failure is classified as `code_app`
3. the worker enqueues a new recovery job with `recoveryMode: "repair_with_agent"`
4. the new job prompt tells the agent to repair the failed candidate in place
5. the prompt includes the original user request, failed stage, and failure log
6. the agent edits the current failed workspace candidate instead of restarting from the live version

Important detail:

- this is a new job, not an in-place mutation of the failed job record
- the failed run and the repair run are linked through recovery metadata

### 3. Unknown failures

If the worker cannot classify the failure confidently enough, it does not perform automatic recovery.

What happens:

- the job is marked failed
- the failure is recorded
- no automatic retry or repair job is created

## Recovery Limits

Automatic recovery is limited to one follow-up attempt.

If a job is already a recovery job with `recoveryAttempt >= 1`, the worker will not automatically queue another recovery job.

This prevents infinite repair or retry loops.

## Candidate Handling

The current implementation does not yet create a separate persisted source snapshot artifact before build.

Instead, recovery currently relies on the existing app workspace on disk:

- `stage_retry` reuses the current failed workspace candidate directly
- `repair_with_agent` asks the agent to repair that current failed workspace candidate directly

That means the current recovery model is practical, but not yet fully immutable at the source-tree level.

## Pipeline Stage Coverage

Current automatic recovery focuses on worker-side stages:

- `build`
- `upload`
- `publish`

Preview/runtime failures are still recorded, but they are not yet automatically repaired by the worker.

In particular:

- shell-side `preview` failures still leave the old active version in place
- runtime failures still mark the candidate failed
- no automatic repair job is currently created from `reportRuntimeError(...)`

## What The User Should Expect

When a run fails in the worker pipeline:

- the active version stays unchanged
- the failed stage and classification are recorded
- if the failure looks transient, the system may retry once without rerunning the agent
- if the failure looks like a real code problem, the system may queue one repair run with the agent
- otherwise the run simply stops as failed

## Examples

### Build failure: `Failed to resolve import`

Classification:

- `code_app`

Automatic action:

- enqueue one `repair_with_agent` recovery job

Why:

- rerunning the exact same build is very unlikely to fix a broken import
- the candidate code needs to change

### Upload failure: `ETIMEDOUT`

Classification:

- `infra_transient`

Automatic action:

- enqueue one `stage_retry` recovery job

Why:

- this is likely operational or network related
- rerunning the agent would waste time and tokens

### Unknown error with no strong match

Classification:

- `unknown`

Automatic action:

- none

Why:

- the worker should not guess aggressively when automatic recovery is unsafe

## Current Limits

This is the first recovery layer, not the final design.

Not implemented yet:

- persisted immutable source snapshots for failed candidates
- preview/runtime auto-repair
- multi-step recovery chains
- human-facing retry/repair controls in the UI
- richer confidence scoring and signature grouping

## Source Files

The current implementation lives in:

- [`worker/src/failureRecovery.ts`](/home/fvrlak/ventures/softbox/worker/src/failureRecovery.ts)
- [`worker/src/jobs.ts`](/home/fvrlak/ventures/softbox/worker/src/jobs.ts)
- [`convex/apps.ts`](/home/fvrlak/ventures/softbox/convex/apps.ts)
- [`convex/schema.ts`](/home/fvrlak/ventures/softbox/convex/schema.ts)
