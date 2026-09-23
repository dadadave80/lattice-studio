@AGENTS.md

## Claude Code notes

- If you are the main session and `.handoff/HANDOFF.md` exists, it is your operating manual: read it before doing anything else, then resume from `.handoff/ledger.md` and `bun scripts/wp/status.ts`.
- Subagent concurrency and depth are set in `.claude/settings.json`. Worktrees branch from the current `HEAD` (`worktree.baseRef: "head"`), so keep the main checkout on `dev`.
- Hooks in `.claude/hooks/` block pushes, publishing, deploys, real-network transactions and, for work-package agents, edits outside their scope. When a hook blocks you, its message says why and what to do instead; don't look for another way to do the same thing.

## What David has authorized here

For the build-out in `.handoff/HANDOFF.md`, David authorizes: creating and removing git worktrees and `feat/wp-*` and `fix/wp-*` branches in this repository; merging work-package branches into the local `dev` branch through `scripts/wp/merge.ts`; installing exactly what `bun.lock` pins with `bun install --frozen-lockfile`; running tests, builds and local servers; starting local Anvil nodes and sending transactions to them. He has not authorized pushing, publishing, deploying, sending a transaction to any public network (testnets included), changing dependencies outside `.handoff/plan/contracts.md` §2, or reading secrets.
