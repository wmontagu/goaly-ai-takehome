---
name: full-check
description: Run typecheck, lint, unit tests, and production build as one gate before any commit to this project. Use after any change to app/, lib/, apps/, or tests/, before committing.
---

# full-check

Ported from governed-agent-harness. Run all four in sequence and stop at the
first failure. Don't commit until all four are clean.

1. `npx tsc --noEmit`
2. `npm run lint`
3. `npm test` (vitest, no LLM calls)
4. `npm run build`

Fix root causes. Don't silence type errors with `as any`, don't disable a
lint rule to hide a real finding, and don't skip a failing unit test.
