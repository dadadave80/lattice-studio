# Lattice Studio: rules for agents

Lattice Studio is a static, local-first web app that composes EIP-2535 diamonds from the [Lattice](https://github.com/dadadave80/lattice) library, checks them on every edit, exports Foundry scripts, agent briefs and Safe batches, and deploys them.

v1 was built in parallel by coding agents, one work package per branch, under David's direction; `scripts/wp/` is the tooling that claimed, gated and merged those packages. The rules below are what's left for anyone, person or agent, working here now. Specs and plans are never committed.

## Always

- Branches start from `dev`, with conventional names (`feat/…`, `fix/…`). No agent names in branch names.
- Conventional commits with a scope: `fix(sheet): route seams before defaults`.
- Never push, open or merge pull requests, publish packages, deploy Studio, or send a transaction to a real network. Those need David. Local Anvil is fine.
- Never add, remove or update dependencies without David's say.
- The `lattice/` submodule is pinned and read-only. What Lattice should change goes to David, not into the submodule.
- No secrets in files. RPC URLs with keys stay in the environment.
- Frozen contracts (`packages/core/src/model/`, `apps/studio/src/contracts/`, the configs and `package.json` files) change only with David's say.

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
| `bun run catalog` | Rebuild the catalog from the pinned Lattice (Foundry 1.8.3) |
| `bun run typecheck` · `bun run typecheck:ts6` · `bun run lint` · `bun run check` | Static checks |

## Code

Named exports only. No `any`. Core (`packages/core`) is pure: no DOM, React, network, clock or randomness. UI styling uses token variables only. Quote UI copy exactly as the spec writes it: US spelling, sentence case, no "please", no exclamation marks. Every command says what it did or why it didn't.
