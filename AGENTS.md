# Lattice Studio: rules for agents

Lattice Studio is a static, local-first web app that composes EIP-2535 diamonds from the [Lattice](https://github.com/dadadave80/lattice) library, checks them on every edit, exports Foundry scripts, agent briefs and Safe batches, and deploys them. The spec, the plan and the work-package briefs live in `.handoff/` (gitignored; the canonical copy is in `~/.codex/specs/`). Specs and plans are never committed.

## Who does what

- **Orchestrator** (the main Claude Code session): follows `.handoff/HANDOFF.md`, spawns agents, merges into local `dev` with `scripts/wp/merge.ts`, keeps `.handoff/ledger.md`.
- **wp-implementer**: builds one work package in its own worktree, inside the paths its brief owns. `.claude/agents/wp-implementer.md` is its full protocol.
- **wp-helper**, **wp-reviewer**, **conformance-auditor**: see `.claude/agents/`.

## Always

- Branches start from `dev`: `feat/wp-<id>` for work packages, conventional names otherwise. No agent names in branch names.
- Conventional commits, scoped by work package: `feat(c2): route seams before defaults`.
- Local merges of work-package branches into local `dev` go through `scripts/wp/merge.ts`. Nothing else merges.
- Never push, open or merge pull requests, publish packages, deploy Studio, or send a transaction to a real network. Those need David. Local Anvil is fine.
- Never add, remove or update dependencies unless you're the orchestrator, and then only within `.handoff/plan/contracts.md` §2.
- The `lattice/` submodule is pinned and read-only. What Lattice should change goes to David, not into the submodule.
- No secrets in files. RPC URLs with keys stay in the environment.
- Frozen contracts (`packages/core/src/model/`, `apps/studio/src/contracts/`, the configs and `package.json` files) change only through the orchestrator.

## Commands

| Command | Does |
| --- | --- |
| `bun install --frozen-lockfile` | Install (install scripts blocked) |
| `bun dev` | App on `$STUDIO_PORT` (default 5173) |
| `bun test [paths]` | Pure TypeScript tests |
| `bun run test:browser [paths]` | Component tests in Vitest Browser Mode |
| `bun run e2e [paths]` | Playwright |
| `bun run test:chain` | Anvil and Foundry tests |
| `bun run golden` | Golden tests against Lattice's deploy scripts |
| `bun run catalog` | Rebuild the catalog from the pinned Lattice (Foundry 1.8.1) |
| `bun run typecheck` · `bun run typecheck:ts6` · `bun run lint` · `bun run check` | Static checks |
| `bun scripts/wp/status.ts` | Where every work package stands |

## Code

Named exports only. No `any`. Core (`packages/core`) is pure: no DOM, React, network, clock or randomness. UI styling uses token variables only. Quote UI copy exactly as the spec writes it: US spelling, sentence case, no "please", no exclamation marks. Every command says what it did or why it didn't. The full conventions are `.handoff/plan/contracts.md` §6.
