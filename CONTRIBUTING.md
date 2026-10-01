# Contributing

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Taking part means upholding it.

## Setup

```sh
bun install --frozen-lockfile
bun run check   # typecheck, lint, size budgets, schema drift, copy lint
bun test        # core logic, seconds
```

See [README.md](README.md) for the full command table, and `docs/architecture.md` for how the pieces fit together.

## Branches and commits

Branch from `dev`. Commits are [Conventional Commits](https://www.conventionalcommits.org/), scoped to the area they touch: `feat(sheet): route seams before defaults`, `fix(cli): scrub the RPC URL from errors`. Small commits are fine. `dev` is the integration branch; releases are cut from `main` (`docs/release.md`).

Versions and changelogs come from [`release-please`](https://github.com/googleapis/release-please) reading those commit messages — write them as if they'll appear in a changelog, because they will.

## Before opening a pull request

Run `bun run check`, `bun test`, and whichever of `bun run test:browser`, `bun run e2e`, `bun run golden`, or `bun run test:chain` cover what changed (README's command table says what each needs). The pull request template asks you to check off:

- **Accessibility states.** Every state a change touches that's drawn on the design boards gets a browser test and a screenshot baseline in both themes: keyboard-only reachability, focus visible after every action, an accessible name on every control, `aria-disabled` with a stated reason (never a bare disabled control), both themes rendering correctly, and reduced motion respected.
- **Budgets.** `bun scripts/ci/size.ts --build` passes, or the pull request explains what grew and why. No new dependency: the project's dependency set is a deliberate, reviewed list, so a pull request that needs one asks for it rather than adding it.
- **Testing.** `bun run check` and `bun test` pass; the pull request names which browser, e2e, golden, or chain suites were run locally.

## How golden tests pin recipes to Lattice's scripts

Studio's plan for a recipe has to equal what Lattice's own deploy script builds — that's the strongest guarantee this project makes, and `bun run golden` is what checks it. Each Studio recipe template names the Lattice deploy script it corresponds to (`DeployERC20`, `DeployGovernedVault`, `DeploySafeDiamondCut`, and so on). The golden harness calls that script's own `buildCuts(...)` inside a real Foundry test against the pinned Lattice checkout, normalizes the resulting Add/Replace sequence into a final selector-to-facet routing, and compares it with the routing Studio's `core` package computes for the same recipe. Any drift — a selector routed to a different facet, a changed init sequence — fails the check with a per-selector diff, not a vague "something changed".

A second golden suite does the same for shared-contract addresses: it predicts each one from creation code and salt and compares the prediction with what `DeployRelease` actually deploys for the same tag, so a build-setting drift can never quietly send someone to an address nothing will ever deploy.

Full detail, including how to add a recipe to the harness and the expected-file format: [`golden/README.md`](golden/README.md). Golden tests need Foundry 1.8.3 and a Lattice checkout built with the `ci` profile (`FOUNDRY_PROFILE=ci forge build --root lattice`):

```sh
bun run golden            # compares against golden/expected/, exits 1 on drift
bun run golden --update   # rewrites golden/expected/ from the scripts; review the diff before committing
```

## Copy

UI and documentation copy is quoted exactly, US spelling, sentence case: it states what to do or what happened, it doesn't ask, and it never ends with an exclamation mark. `bun run check` runs the mechanical part of this (`lintCopy`, part of `packages/core`) over `apps/studio/src/**`.

## Scope

Frozen paths (`packages/core/src/model/`, `apps/studio/src/contracts/`, every `package.json`, `bun.lock`, and the build configs) change through review, not casually: they're shared contracts other code depends on. If a change needs one, say so in the pull request and expect a closer look.
