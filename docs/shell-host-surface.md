# Shell Host Surface Notes

This note records the recent layout changes around the shell host surface so they are easy to trace later if spacing or mounting behavior regresses.

## Files

- `shell/src/App.tsx`
- `shell/src/ShellHostSurface.tsx`
- `shell/src/shellHostConfig.ts`

## What Changed

The old shell host empty-state card was extracted from `App.tsx` into its own component:

- `shell/src/ShellHostSurface.tsx`

The intention is that this component is not just a temporary empty-state message. It is the shell-facing surface shown when no mounted app is active.

## Runtime Structure

In `shell/src/App.tsx`, the runtime mount root is still separate and should be treated as important runtime structure:

- `main`
- absolute runtime wrapper
- `div` with `ref={hostRef}` and class `h-screen min-h-[800px] w-full`

That `hostRef` container is the actual host mount target for the live app runtime.

The `ShellHostSurface` sits on top as UI. It can be redesigned freely without changing the runtime mount root.

## Padding Change

The shell host surface was changed from a centered rounded card into a full-viewport surface.

Current outer container in `shell/src/ShellHostSurface.tsx`:

```tsx
<section className="pointer-events-none absolute inset-0 z-10 flex items-stretch justify-stretch">
  <div className="pointer-events-auto relative h-full w-full overflow-hidden border-0 bg-[#0d1014]/72 px-6 py-6 shadow-none backdrop-blur-xl sm:px-8 sm:py-8">
```

### Meaning

- `absolute inset-0`: the surface covers the full host viewport
- `h-full w-full`: no centered card width limit
- `border-0 shadow-none`: removes the old card framing
- `px-6 py-6 sm:px-8 sm:py-8`: small outer breathing room only

Previously, the surface had much heavier inset padding and card styling. That made it feel like a floating modal/card rather than a desktop/surface layer.

## Why This Matters

If the shell host surface later appears to have strange spacing, check `shell/src/ShellHostSurface.tsx` first.

The padding for that surface now lives there, not in `App.tsx`.

If layout breaks in the future, inspect:

- outer `section` in `shell/src/ShellHostSurface.tsx`
- outer surface `div` padding classes
- any additional margin/padding on the inner content block

## Safe Rule

You can redesign `ShellHostSurface` UI freely.

Do not casually remove or repurpose the runtime host container in `shell/src/App.tsx`:

- `ref={hostRef}`
- `className="h-screen min-h-[800px] w-full"`

That element is part of the actual app mounting behavior.
