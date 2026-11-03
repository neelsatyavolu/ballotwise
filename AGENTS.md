<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Before you push to main

Every push to `main` deploys to production, and the deploy no longer waits for lint, typecheck or tests (that made deploys about twice as slow). That makes you the gate. Before every push to `main`, run:

```bash
npm run lint && npm run typecheck && npm test
```

Push only if all three pass. If a failure comes from another session's uncommitted work in this shared checkout, don't stash or revert their files; confirm the failure is outside what you're committing and say so when you report back. The `checks` job in `.github/workflows/deploy.yml` reruns all three after the push, so check its result with `gh run list --workflow deploy.yml -L 1` and fix a red run right away.
