# R2 Upload Bottleneck Investigation

## Summary

This document explains the investigation into the `R2 Upload` stage inside the live rebuild pipeline, what the actual bottleneck was, what changes were made, and how the runtime was reduced from roughly `30s` upload time to roughly `3.8s`.

The raw timing samples used for this analysis are stored in:

- [`bottleneck.json`](/home/fvrlak/projects/softbox/docs/bottleneck.json)

Those records come from the persisted `pipelineRuns` / `pipelineStages` data in Convex and show the real timing of:

- `queued`
- `agent`
- `build`
- `upload`
- `publish`
- `preview`
- `activate`

## Initial Problem

At the start of the investigation, the slowest stage in many runs was `R2 Upload`.

Representative observation:

- total pipeline was often around `35s` to `45s`
- `R2 Upload` alone could take roughly `20s` to `30s`

This made the system feel slow even when:

- the agent rewrite was reasonably fast
- local bundling was already fast
- Convex publish and browser preview were relatively small

The user correctly identified that remote artifact publishing was dominating the loop.

## What R2 Is Responsible For

Cloudflare R2 is the immutable artifact store for built live app bundles.

After the worker builds a candidate version, it publishes:

- the browser entry file
- any generated JS chunks
- generated CSS
- the version manifest

The shell then reads the manifest URL from Convex and loads the built bundle from R2.

So the `R2 Upload` stage is the handoff from:

- local build output

to:

- remotely fetchable versioned artifacts

## Early Misconception

At first glance it looked like “R2 is just slow”.

That was incomplete.

The real problem was a combination of:

- sequential uploads
- version-based artifact keys that forced re-uploading everything
- inline source maps inflating browser bundle size
- large changing entry files

So the storage backend was only part of the story.

## Investigation Steps

### 1. Add pipeline timing visibility

First, timing data was added and persisted in Convex:

- `pipelineRuns`
- `pipelineStages`

This made it possible to measure:

- per-run total duration
- per-stage duration
- recent run history

Without this step, optimization would have been guesswork.

Relevant files:

- [`convex/schema.ts`](/home/fvrlak/projects/softbox/convex/schema.ts)
- [`convex/apps.ts`](/home/fvrlak/projects/softbox/convex/apps.ts)
- [`worker/src/jobs.ts`](/home/fvrlak/projects/softbox/worker/src/jobs.ts)
- [`shell/src/runtime.ts`](/home/fvrlak/projects/softbox/shell/src/runtime.ts)
- [`shell/src/App.tsx`](/home/fvrlak/projects/softbox/shell/src/App.tsx)

### 2. Parallelize uploads

Originally the uploader sent one artifact at a time.

Old behavior:

- `PutObject`
- wait
- next `PutObject`
- wait
- repeat

This was changed to bounded parallel upload with configurable concurrency.

Relevant files:

- [`worker/src/r2.ts`](/home/fvrlak/projects/softbox/worker/src/r2.ts)
- [`worker/src/config.ts`](/home/fvrlak/projects/softbox/worker/src/config.ts)

Config:

- `R2_UPLOAD_CONCURRENCY`

Default:

- `6`

This helped, but it did not solve the whole problem.

### 3. Stop versioning every artifact key

Originally artifact keys looked like:

- `apps/demo/v38/entry.js`
- `apps/demo/v38/chunk-....js`
- `apps/demo/v39/entry.js`
- `apps/demo/v39/chunk-....js`

That meant even a tiny code change forced a full new remote object set because all keys were version-scoped.

This was replaced with:

- shared immutable bundle artifacts under `apps/<app>/shared/...`
- small versioned manifests under `apps/<app>/v<version>/manifest.json`

So now:

- unchanged shared artifacts can be reused
- only the manifest must always be published per version

Relevant files:

- [`worker/src/artifacts.ts`](/home/fvrlak/projects/softbox/worker/src/artifacts.ts)
- [`worker/src/build.ts`](/home/fvrlak/projects/softbox/worker/src/build.ts)
- [`worker/src/jobs.ts`](/home/fvrlak/projects/softbox/worker/src/jobs.ts)
- [`worker/src/seed.ts`](/home/fvrlak/projects/softbox/worker/src/seed.ts)

### 4. Skip uploads for existing artifacts

After moving to shared immutable keys, the uploader was taught to check whether an object already exists in R2 before uploading it.

That means:

- if chunk hash is unchanged, skip upload
- if CSS hash is unchanged, skip upload
- if entry hash is unchanged, skip upload

Manifest is still uploaded per version.

Relevant file:

- [`worker/src/r2.ts`](/home/fvrlak/projects/softbox/worker/src/r2.ts)

### 5. Add upload tracing

To avoid guessing, the worker was updated to log:

- how many artifacts were uploaded
- how many were skipped
- byte sizes
- content types
- exact artifact keys

Example log shape:

- `R2 upload summary: uploaded X/Y artifact(s), skipped Z existing artifact(s)`
- then per-artifact `uploaded` / `skipped` lines

Relevant files:

- [`worker/src/r2.ts`](/home/fvrlak/projects/softbox/worker/src/r2.ts)
- [`worker/src/jobs.ts`](/home/fvrlak/projects/softbox/worker/src/jobs.ts)

This made the next bottleneck obvious.

### 6. Remove inline source maps

The worker build path originally emitted browser bundles with:

- `sourcemap: "inline"`

That massively inflated artifact size, especially the browser entry bundle.

This was changed to:

- `sourcemap: false`

Relevant file:

- [`worker/src/build.ts`](/home/fvrlak/projects/softbox/worker/src/build.ts)

This was one of the highest-impact fixes in the whole investigation.

### 7. Minify browser bundles

After removing inline source maps, the next clear win was enabling minification for the live browser bundle.

This was changed to:

- `minify: true`

Relevant file:

- [`worker/src/build.ts`](/home/fvrlak/projects/softbox/worker/src/build.ts)

This reduced upload size again and pushed the bottleneck away from R2.

## What The Data Showed

### Before the fixes

Representative bad case from logs:

- `R2 Upload`: around `21s` to `30s`
- a changing `entry-*.js` artifact around `10.76 MB`

At that point, remote upload clearly dominated the loop.

### After dedup + upload tracing

Representative case:

- `uploaded 2/6 artifact(s)`
- `skipped 4 existing artifact(s)`
- but still uploaded a very large `entry` file

This proved:

- dedup worked
- but the bundle itself was still too large

### After removing inline source maps

Representative case from [`bottleneck.json`](/home/fvrlak/projects/softbox/docs/bottleneck.json):

- total duration: `24975ms`
- `R2 Upload`: `8871ms`

This was already a major improvement from the earlier ~`30s` upload cases.

### After minification

Representative case from [`bottleneck.json`](/home/fvrlak/projects/softbox/docs/bottleneck.json):

- total duration: `19823ms`
- `R2 Upload`: `3836ms`

Representative upload log:

- total uploaded bytes: `1.67 MB`
- uploaded entry bundle: `1.05 MB`

This is the key result.

## Timeline of Improvement

Approximate progression:

1. Initial state
   - upload around `30s`
   - entry bundle around `10.76 MB`

2. After removing inline source maps
   - upload around `8.9s`
   - entry bundle around `3.11 MB`

3. After minification
   - upload around `3.8s`
   - entry bundle around `1.05 MB`

So the upload stage was reduced by roughly an order of magnitude.

## Final Diagnosis

The root cause was not simply “R2 is slow”.

The true causes were:

- browser bundle bloat
- especially a huge changing entry bundle
- version-scoped artifact keys that prevented reuse
- sequential upload behavior

The strongest single insights were:

1. The browser entry bundle was far too large.
2. Inline source maps were a major contributor.
3. Shared immutable artifact keys plus dedup were necessary.
4. Once upload size was reduced, `agent` became the dominant stage.

## What Is True Now

After these fixes:

- R2 is no longer the dominant bottleneck in normal small-edit runs
- `agent` often takes longer than `upload`
- upload is still meaningful, but no longer catastrophic
- the system now behaves much more like a bounded prompt/build/publish loop

## What Was Not Done

The following ideas were discussed but intentionally not implemented as part of this optimization:

- replacing R2 with another cloud bucket
- using a separate local-only dev artifact path

The user explicitly wanted production/dev behavior to stay aligned, which is a reasonable constraint. The implemented fixes preserved the production-style publish path instead of bypassing it.

## Remaining Optimization Ideas

If more speed is needed, the next areas are:

1. Reduce agent latency
   - narrower prompt context
   - fewer source files sent to the agent
   - better targeted edits
   - faster model for simple changes

2. Reduce entry chunk invalidation
   - keep entry as a thin bootstrap
   - keep heavier code/data in stable chunks

3. Add richer uploader metrics
   - wall time per artifact
   - HEAD latency vs PUT latency
   - total dedup hit ratio over time

4. Add regression alerts
   - if entry bundle exceeds a size threshold
   - if upload stage exceeds a duration threshold

## Files Changed During This Investigation

Core performance work:

- [`worker/src/config.ts`](/home/fvrlak/projects/softbox/worker/src/config.ts)
- [`worker/src/r2.ts`](/home/fvrlak/projects/softbox/worker/src/r2.ts)
- [`worker/src/artifacts.ts`](/home/fvrlak/projects/softbox/worker/src/artifacts.ts)
- [`worker/src/build.ts`](/home/fvrlak/projects/softbox/worker/src/build.ts)
- [`worker/src/jobs.ts`](/home/fvrlak/projects/softbox/worker/src/jobs.ts)
- [`worker/src/seed.ts`](/home/fvrlak/projects/softbox/worker/src/seed.ts)
- [`worker/test/build.test.ts`](/home/fvrlak/projects/softbox/worker/test/build.test.ts)

Related observability work:

- [`convex/schema.ts`](/home/fvrlak/projects/softbox/convex/schema.ts)
- [`convex/apps.ts`](/home/fvrlak/projects/softbox/convex/apps.ts)
- [`shell/src/runtime.ts`](/home/fvrlak/projects/softbox/shell/src/runtime.ts)
- [`shell/src/App.tsx`](/home/fvrlak/projects/softbox/shell/src/App.tsx)

## Recommended Reading

- [`README.md`](/home/fvrlak/projects/softbox/docs/README.md)
- [`runtime-flow.md`](/home/fvrlak/projects/softbox/docs/runtime-flow.md)
- [`architecture.md`](/home/fvrlak/projects/softbox/docs/architecture.md)
- [`bottleneck.json`](/home/fvrlak/projects/softbox/docs/bottleneck.json)
