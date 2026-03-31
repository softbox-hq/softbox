# Preview Promotion Race After Iframe Isolation

## Summary

This document records a shell runtime regression that showed up after moving mounted apps into isolated iframes.

The visible failure looked like this:

- pipeline step `6/7` `Preview Mount` could hang indefinitely
- or the candidate app would flash correctly for a moment
- then the shell would fall back to its dark gradient background
- a manual page reload would finally show the newly promoted version correctly

The bug was in the shell runtime lifecycle, not in app code.

## Why This Happened

Mounted apps previously shared the shell document.

That caused CSS conflicts because standalone apps often style:

- `:root`
- `body`
- `#root`

Those selectors only behave correctly when the app owns its own document.

To fix that, the shell runtime was changed so live apps mount inside an iframe-backed document in [`shell/src/runtime.ts`](/home/fvrlak/ventures/softbox/shell/src/runtime.ts).

That isolation fixed the CSS problem, but it also exposed a few lifecycle races in preview and promotion.

## Symptoms

The regression had two main forms.

### 1. Preview mount stuck

The run would reach `Preview Mount` and stay there for much longer than normal.

Practical rule during debugging:

- more than `10s` was suspicious
- more than `30s` was effectively stuck
- waiting `60s` confirmed it was not recovering

### 2. Preview flashes, then shell background returns

The new app version would visibly render for a moment in preview.

Then the candidate would disappear and the shell background would show through again.

Reloading the browser would mount the new active version correctly, which proved the version itself was valid and the failure was in the promotion transition.

## Root Causes

There were three separate shell-side issues.

### 1. Runtime effects depended on unstable callback props

`useLiveAppRuntime(...)` received fresh callback functions from [`shell/src/App.tsx`](/home/fvrlak/ventures/softbox/shell/src/App.tsx) on every render:

- `publishState`
- `activateVersion`
- `reportRuntimeError`
- `recordPipelineStageForVersion`

The shell re-renders every second while a pipeline run is visible because elapsed time updates continuously.

That meant the preview effect could be cancelled and restarted while stage `preview` was already in progress.

### 2. Runtime effects depended on whole Convex objects

The active and preview effects also depended on whole `activeVersion` and `nextReadyVersion` objects instead of stable version identities.

Convex subscription refreshes can recreate those objects even when the actual version did not change.

That caused effect cleanup and restart during:

- pipeline stage updates
- version promotion
- other shell state refreshes

### 3. Promotion invalidated the preview effect mid-flight

After `activateVersion(versionId)` succeeds:

- `activeVersion` changes to the candidate
- `nextReadyVersion` becomes `null`

The preview effect originally tracked those values directly.

So the same promotion update that meant "success" could also trigger preview cleanup and unmount the candidate before it finished becoming the new active mount.

That is why the user could see a brief correct preview and then fall back to the shell background until a full reload remounted the already-promoted active version.

## Fixes Applied

The final shell-side fix had four parts.

### 1. Keep live apps in isolated iframe documents

The runtime now mounts each live app in its own iframe-backed document.

That preserves standalone app expectations for:

- `html`
- `body`
- `:root`
- `#root`

Relevant files:

- [`shell/src/runtime.ts`](/home/fvrlak/ventures/softbox/shell/src/runtime.ts)
- [`shell/src/styles.css`](/home/fvrlak/ventures/softbox/shell/src/styles.css)

### 2. Move shell callbacks behind refs

The runtime stores mutation callbacks in refs so effect lifetimes do not restart just because React recreated function props.

This removed render churn from the preview/promotion path.

### 3. Key active remount logic to stable version signatures

The active mount effect now tracks stable version fields instead of whole objects:

- version id
- manifest URL
- serialized state JSON

That prevents Convex object churn from looking like a real version change.

### 4. Pin preview promotion to the in-flight candidate

The preview flow now stays keyed to the candidate version currently being promoted, using `previewVersionRef` as the stable source of truth.

That prevents the effect from cancelling itself just because `nextReadyVersion` clears or `activeVersion` updates during promotion.

## Result

After these fixes:

- `Preview Mount` completes normally again
- the candidate no longer disappears after step `6`
- the promoted version remains visible without a manual reload
- the app CSS stays isolated from the shell document

Verification after the fixes:

- `pnpm typecheck`
- `pnpm build:shell`

## Guardrails

This regression is a good reminder of a few runtime rules.

- Preview/promotion effects must not depend on render-unstable callbacks.
- Preview/promotion effects must not depend on whole subscription objects when only version identity matters.
- Promotion should be treated as one continuous transaction from preview mount to active remount.
- CSS isolation and lifecycle isolation are different problems. Fixing one can expose races in the other.

## Related Files

- [`shell/src/runtime.ts`](/home/fvrlak/ventures/softbox/shell/src/runtime.ts)
- [`shell/src/App.tsx`](/home/fvrlak/ventures/softbox/shell/src/App.tsx)
- [`shell/src/styles.css`](/home/fvrlak/ventures/softbox/shell/src/styles.css)
- [`docs/runtime-flow.md`](/home/fvrlak/ventures/softbox/docs/runtime-flow.md)
