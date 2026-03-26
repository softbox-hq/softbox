# Open Source Checklist

This file tracks the minimum cleanup needed before publishing the repository publicly.

It reflects the current working-tree cleanup pass. Before publishing, these changes still need to be reviewed, committed, and pushed.

## Executed In This Repo

- [x] Added a public-facing top-level `README.md`
- [x] Added an MIT `LICENSE`
- [x] Sanitized and expanded `.env.example`
- [x] Hardened `.gitignore` for local envs, temp files, build output, and sqlite sidecar files
- [x] Removed tracked screenshots that were not referenced anywhere
- [x] Removed tracked build artifacts from `dist-live-app-template/`
- [x] Linked this checklist from the docs index and root README

## Verified

- [x] No `.env.local` or `.env` file is tracked
- [x] No root-level secret-bearing config file is tracked
- [x] Public docs now explain the runtime in open-source terms

## Manual Steps Still Recommended Before Publishing

- [ ] Rotate any credentials that were ever used locally
  - Even if they were only in ignored files, assume they may have been exposed elsewhere.
- [ ] Audit git history for secrets, not just the current working tree
  - If any secret ever landed in history, rewrite history before publishing.
- [ ] Review scratch or low-signal docs before publishing
  - Example: `docs/HUMAN.md` does not look like public-facing documentation yet.
- [ ] Decide which experimental directories should remain public
  - `chat-composer/`
  - `apps/test-app/`
  - `apps/test-app-2/`
  - `apps/test-app-3/`
- [ ] Record one short demo video or GIF
- [ ] Add repository metadata on GitHub
  - description
  - topics
  - homepage/demo link
- [ ] Review naming and polish of example apps
- [ ] Decide whether `datahub` should be documented as a separate companion repo

## Suggested Publish Order

1. Run one final local verification pass:
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm build:shell`
2. Create the GitHub repository
3. Push the cleaned repo
4. Add a short demo to the README or repo description
5. Share it with technical builders first

## Suggested First GitHub Description

`AI-driven host runtime for mutable apps with build, preview, and live version swapping.`

## Suggested First Audience

- AI coding tool builders
- developer tooling people
- runtime / infra tinkerers
- indie hackers who understand prompt -> build -> swap workflows
