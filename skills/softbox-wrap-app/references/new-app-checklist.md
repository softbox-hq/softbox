# New app checklist

Use this checklist when a human says they added a new app under `/apps`.

## 1. Read the human-facing explanation

Read:

- `HUMAN.md`

This keeps the explanation aligned with repo expectations.

## 2. Inspect the app

Check:

- framework
- bundler
- client vs server assumptions
- current app entry points
- whether a plain browser mount is possible

## 3. Decide the onboarding path

If the app is browser-first:

- wrap it
- keep it standalone
- register it

If the app is not browser-first:

- explain the mismatch
- identify the smallest client-side slice that could be wrapped
- avoid claiming the work is already done

## 4. Add the wrapper files

Usually add:

- `src/entry.tsx`
- `src/defaultState.ts`
- shell adapter file

## 5. Register the template

Update:

- `worker/src/templates.ts`

## 6. Tell the human what is still missing

Common remaining work:

- seed app record
- choose template id
- fix framework mismatch
- add missing standalone entry
- make default state JSON-safe
- test preview and promotion flow
