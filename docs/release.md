# Release

This describes how a change becomes a release: versioning, CI, hosting, and the CLI publish. Every step that only David can do (create accounts, add secrets, push the repository, click deploy) is marked **Needs David**. Nothing in this repository's build tooling pushes, publishes, deploys, or sends a transaction to a public network on its own — those actions all wait for one of the steps below.

## Versions and changelog

On a push to `main`, Release Please groups the pending Studio and CLI releases in one PR. It calculates each product’s version from conventional commits that changed files under `apps/studio/` or `packages/cli/` since that product’s last tag. Both started at `0.1.0`. A fix-only release increments the patch number. A feature increments the minor number, as does a declared breaking change while the product is on `0.x`. The largest applicable bump wins for each product. [Release configuration](../.github/release-please-config.json)

The lattice-release-please GitHub App opens the release PR so it receives normal CI (`RELEASE_PLEASE_APP_CLIENT_ID` and `RELEASE_PLEASE_APP_PRIVATE_KEY`). David merges the reviewed release PR to record the versions, changelogs, and tags. CLI publication remains a separate manual step.

### Shared-core fixes

For a `fix:` or `fix(scope):` commit that changes runtime code under `packages/core/src/`, include a file under each affected product in the same commit. A regression test that exercises the fix through Studio or the CLI counts. When existing tests already cover the behavior, record the user-visible change in the affected product’s `.release-impact` file. This file can contain just the latest fix. Release Please takes the changelog wording from the commit subject.

CI checks both the individual fix commits and the proposed squash title and diff. Use `fix(studio): align facet cards` for a Studio-only fix, or `fix(cli): correct the exported filename` for a CLI-only fix, and include a file under that product. Other fix scopes, such as `fix(export)`, require files under both products. Keep unrelated product changes separate because Release Please counts every product path touched. When squash-merging, retain the reviewed fix title and affected files. Test-only and documentation-only work can use their usual commit types.

### When to ship a fix on its own

Ship a patch on its own when users of the tagged release need the correction before the next feature is ready. An incorrect export that users could deploy is a reason to expedite. A cosmetic correction can usually travel with the next feature.

Land the fix on `dev` as a self-contained commit. If `dev` also contains unreleased features, have David promote just the fix and its required fixes through a PR against `main`, preserving their conventional commit messages. Check the release PR against the last tag for each affected product. From `0.2.0`, a fix-only batch should propose `0.2.1`. If a feature for that product has already landed on `main`, the batch qualifies for a minor release. After a selective promotion, bring the release history back into `dev` before the next full promotion.

## Hosting

Studio is a static app with two homes: Vercel, the primary origin with security headers, and an IPFS mirror behind a stable origin.

### Vercel

The Vercel project's root directory is `apps/studio`, with **Include source files outside of the Root Directory** turned on in the project settings — `apps/studio/vercel.json`'s build command starts with `cd ../..` to reach the workspace root, and that setting is what lets it see the rest of the monorepo.

`apps/studio/vercel.json` only says how to build. The headers and routes come from the build itself, through Vercel's [Build Output API](https://vercel.com/docs/build-output-api): the CSP has to carry the hash of an import map that changes with any code change, so `apps/studio/build/vercel-output.ts`, the build command's last step, computes it from the finished page and writes `.vercel/output/config.json`. There's nothing to regenerate or commit, and a `VITE_*` variable set in Vercel can't put the header out of step with the page.

**Needs David:** push and deploy. Vercel's build command runs `bun run build`, carries the previous release's hashed chunks forward from `$STUDIO_PREVIOUS_RELEASE` (an environment variable **David** sets to the live origin, so a tab that hasn't refreshed still finds the chunks it's asking for), then writes the Build Output. `vercel-output.ts` moves `dist/` into it, so if Vercel ever stops reading the Build Output, the deploy fails on the missing output directory instead of shipping the page without its headers.

On the very first release, `$STUDIO_PREVIOUS_RELEASE` is empty; `carry-previous.ts` says so in its output and carries nothing forward.

### IPFS

The IPFS build can't send a CSP header, so its policy goes in a `<meta>` tag instead, and asset paths are relative:

```sh
bun run build --mode ipfs
bun apps/studio/build/carry-previous.ts --out apps/studio/dist --from <previous release's dist folder or URL>
bun apps/studio/build/verify-headers.ts apps/studio/dist
```

The last command, run with only the `dist` folder and no `vercel.json` path, checks the built `index.html`'s `<meta>` CSP against its own inline style and import map instead of a headers file.

**Needs David:** where the built folder is pinned, and the ENS name or other stable origin the IPFS mirror is served behind, are both undecided. Exported `recipe.json` files carry a `$schema` URL that resolves today: `https://raw.githubusercontent.com/dadadave80/lattice-studio/main/apps/studio/public/schema/recipe.v1.json`, the committed schema on `main`. lattice.wtf will host the schema later; recipes exported before then keep the raw URL, so that file must stay at that path on `main` (`apps/studio/build/recipe-schema.test.ts` fails if it moves).

## CI

`.github/workflows/` runs on GitHub: `ci.yml` (the pull request gate: typecheck, lint, unit, size, browser, e2e, the performance budgets with the only Lighthouse CI run, and the Foundry suites: chain, the Sepolia fork suite, golden and catalog drift), `warm-cache.yml` (saves the caches CI restores, on `dev` and `main`), `nightly.yml` (the golden and chain suites against Lattice's `dev`, report-only, plus a nightly dispatch of the full `ci.yml` on Studio's `dev`), `release-please.yml`, `publish-cli.yml`, and `update-screenshots.yml` (manual, `workflow_dispatch` only: regenerates the missing `chromium-linux` screenshot baselines as a downloadable artifact — see "Linux screenshot baselines" below).

`ci.yml` runs on pull requests and on `workflow_dispatch`. On a pull request a first `changes` job diffs against the base, and `scripts/ci/changes.sh` selects the suites that read those paths. The aggregate gate verifies their outcomes. A change to Markdown at the root, `docs/` or `skills/` skips the expensive suites and still runs path detection and the aggregate gate; a pitch deck selects check, unit and size; workflows, `.github/actions/`, `bun.lock` and root configs select every suite. An ordinary manual dispatch runs the full suite, as does `nightly.yml` for `dev`; an explicitly selected browser-transport dispatch runs its separate diagnostic matrix. The lightweight `post-merge.yml` checks the exact revision pushed to `dev` or `main`.

Related suites share a runner instead of each paying for the same install: `static` runs the unit suite, then one production `bun run check`; a size-only change keeps its size/React Compiler fallback. Unit build tests use scratch output, so they cannot overwrite that production build. `foundry` builds Lattice once, then runs chain with the Sepolia fork suite, golden and catalog drift, each step even when an earlier one failed. Inspection runtime and Anvil-proof changes select the chain job as well as app checks.

End to end runs as five parallel jobs: the `chromium` project split four ways with Playwright's `--shard`, and the `webkit-smoke` project on its own, the only runner that installs WebKit. Each shard uploads compact test identities, durations, attempts and pass/skip/fail/flaky counts, plus its HTML report and retained failed-attempt traces. Uploads also run after a retry recovers; the raw JSON report containing configuration and error/stdout payloads is excluded. Retries and assertion tolerances are unchanged.

Suite jobs use `.github/actions/setup` (pinned Bun, frozen install, and Node, Foundry or Playwright browsers as needed). Its summary records actual runtimes, OS, browser-cache state and separate install/apt/browser timings. `.github/actions/lattice-build` restores the Lattice build, keyed on the submodule's commit. GitHub shows a pull request only the caches saved on its own ref or its base branch, so `warm-cache.yml` saves them on `dev` and `main` whenever `bun.lock`, the Lattice pin or setup changes; catalog drift always builds a fresh copy.

The stable **CI gate** job checks every ordinary job's result against the selected inputs. Failed path detection, malformed group outputs, a selected job that was skipped, and failed/cancelled jobs all fail the gate. This aggregate job needs only Node, without installing packages or browsers. A manual transport-only run publishes a separate diagnostic selection status, so it cannot certify the required ordinary CI context. Its cancellation group also differs from ordinary full CI.

`post-merge.yml` verifies the exact pushed revision on `dev` and `main`: one production build with size budgets, React Compiler, generated deployment headers and the security/routing contracts. It records the SHA in the job summary and uses a separate cancellation group. It complements full PR and nightly coverage.

Repository settings are separate from these workflow files. After **CI gate** has run successfully on the relevant branch, the repository owner enables required PRs and this exact required check, requires an up-to-date base, and blocks force-push/deletion. Choose administrator/bot bypass rules explicitly. Apply the requirement to `main` only after its workflow can emit the new status; otherwise release PRs from an older `main` would wait for a check that cannot run. Workflow changes alone do not enable branch protection.

**Needs David:**

- Add the `SEPOLIA_RPC_URL` repository secret. The Sepolia fork suite runs without it: the fork suite forks a recent finalized Sepolia block from the first public RPC that serves it and uses the secret only when every public one fails, so the secret is a fallback, not a gate. The local Anvil chain tests run either way.
- Add the `NPM_TOKEN` repository secret with `Read and write (stage only)` access and 2FA bypass unchecked. Select `lattice-studio` for an existing package, or `All packages` for its first publication.
- Install solc 0.8.36 (Lattice's pin) before the `foundry` job's suites run, so `forge build` inside the pinned Lattice checkout has it available.

## Linux screenshot baselines

Every `toMatchScreenshot` state has two committed baselines: `*-chromium-darwin.png`, made on a Mac, where Studio was built, and `*-chromium-linux.png`, made on `ubuntu-24.04`, where `ci.yml`'s `browser` job runs. The Linux set landed on October 9, 2026 (#18, #19); before that the `browser` job failed on missing references, not on an actual difference.

`update-screenshots.yml` (`workflow_dispatch` only) regenerates the Linux set: it runs `bun x vitest run --update` for `apps/studio` on `ubuntu-24.04`, after deleting the committed Linux set so every reference is redrawn on that image, and writes a `chromium-linux` reference beside each test's `chromium-darwin` one, and uploads every `*-chromium-linux.png` it produced as a build artifact.

**Needs David:** when a change moves a state, dispatch `update-screenshots.yml`, download the `chromium-linux-baselines` artifact, review the images, and commit them into each test's `__screenshots__` folder next to the `chromium-darwin` files. This workflow only produces and uploads the images; nothing commits them automatically.

## Runner image

Every workflow pins its runner image (`runs-on: ubuntu-24.04`), never `ubuntu-latest`. When `ubuntu-latest` moved from 24.04 to 26.04 in October 2026, the same commit that had passed failed on a rerun, because the new image renders text differently and one screenshot drifted past the 3% tolerance. With a pinned image, only a commit can change the runner.

Studio stays on 24.04 for now: on 26.04, the component tests failed in 4 of 7 runs because some test files never loaded ("Failed to fetch dynamically imported module"), different files each time. Fix that before moving to 26.04.

To move to a newer image, roughly once a year when GitHub makes a new Ubuntu LTS image generally available (see [actions/runner-images](https://github.com/actions/runner-images)), and before GitHub retires the pinned one:

1. On a branch from `dev`, replace `ubuntu-24.04` with the new label in every file under `.github/workflows/`.
2. Push, then dispatch `update-screenshots.yml` on that branch: `gh workflow run update-screenshots.yml --ref <branch>`.
3. Download the `chromium-linux-baselines` artifact, review the images, and commit them over the old ones.
4. Open the pull request. CI runs on the new image against the new baselines.

## Publishing the CLI

`packages/cli` is staged on npm as `lattice-studio`, with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) from a frozen lockfile and install scripts blocked. The workflow uses `npm stage publish` with npm 11.15.0 or later. Staging is manual and separate from tagging a release. `.github/workflows/publish-cli.yml` runs on `workflow_dispatch` with `confirm=publish`.

After the release PR merges, David runs the workflow from the CLI tag printed in the GitHub release. For example, the command for a tagged CLI version of `0.2.1` is

```sh
gh workflow run publish-cli.yml --ref lattice-studio-v0.2.1 -f confirm=publish
```

The workflow checks out the dispatched commit and compares its CLI package version with the full tag ref before installing dependencies or building. The first tag containing this workflow enforces the check. GitHub uses the historical workflow definition when dispatching from an older tag.

When the run succeeds, David opens **Staged Packages** on npm, reviews the package name, version, and contents, then chooses **Approve** and completes the 2FA challenge to publish it. The CLI equivalent is `npm stage approve <stage-id>`. Staging the first release creates a public `0.0.0-stage` placeholder. The submitted release contents become public after approval. [npm staged publishing](https://docs.npmjs.com/staged-publishing/)

## Re-pinning to a tagged Lattice release

The catalog in `catalog/` is built from Lattice `v0.5.0` (commit `cca133b`). `dev-6c8db45` and `dev-f4a32c8` stay in the manifest so recipes and passports made against them still open.

To re-pin to a later release: check out its tag in the `lattice/` submodule, set `TARGET_VERSION` in `packages/catalog-gen/src/main.ts`, fix the overlay citations `bun run catalog` reports (it needs Foundry 1.8.3), and run it until it passes. `TARGET_VERSION` is baked into the committed catalog and the `catalog-drift` job rebuilds and diffs it, so the constant and the catalog move together. Then regenerate `docs/examples/erc20.recipe.json` from the new ERC20 template (it is pinned to the catalog's hash, and `lattice-studio check` on it otherwise exits 3), point `BUNDLED_CATALOG_ID` and the imports in `packages/cli/src/catalogs.ts` at the new catalog, run `bun run golden --update`, and check the factory ABI in `packages/core/src/deploy/abi.ts` against the release's `LatticeFactory`.

**Needs David:** every shared-contract address moved at the `v0.5.0` re-pin, so the shared contracts placed on Hedera testnet on October 4, 2026 need redeploying at the new addresses before a factory deploy there works.

## Wallet connections

Studio's chain module supports WalletConnect as one wallet option, but it needs a WalletConnect Cloud project id to work, and none has been supplied yet. Until it is, the chain module says "WalletConnect isn't set up in this build of Studio"; every other wallet path (an injected wallet, `viem`'s other connectors) works without it.

The id goes in the `VITE_WALLETCONNECT_PROJECT_ID` build-time environment variable, read by `apps/studio/src/contracts/env.ts` as `env.walletConnectProjectId`.

**Needs David:** create a WalletConnect Cloud project and supply its project id, as `VITE_WALLETCONNECT_PROJECT_ID`.

**Config follow-up, once an id is set:** with `VITE_WALLETCONNECT_PROJECT_ID` set, the build's `codeSplitting` app group currently pulls `viem`, `ox` and `noble` into the entry chunk instead of the lazy chain module, adding about 79 KB gz to first load, and the WalletConnect SDK's own chunks miss the build's `NO_BUDGET_PATTERN` allowance. Both need a build-config change (chunking rule and budget pattern) before the id is set for real; until then the size budget check would fail on set. Not yet filed as its own work package — raise it against `apps/studio/vite.config.ts` and `scripts/ci/size-logic.ts` once David supplies an id.

## Contract verification

After a deploy Studio verifies the diamond on Sourcify, which needs no key, and on Etherscan (API V2, one key for every chain), which does. The build's default key goes in the `VITE_ETHERSCAN_API_KEY` build-time environment variable, read by `apps/studio/src/contracts/env.ts` as `env.etherscanApiKey`; a key typed in Settings → Deploy overrides it for that browser. Without either, Studio verifies on Sourcify alone, and each record on a chain Etherscan serves points to Settings → Deploy. A key added later reaches diamonds deployed before it: the open project's records are submitted once it's saved, and a record Etherscan hasn't been asked about yet offers Verify on Etherscan.

The variable is inlined into the bundle and readable by anyone, so it must be a dedicated free-tier key, never a paid one (see `SECURITY.md`). Set it in the Vercel project's environment (Production and Preview), never in a GitHub workflow: CI uploads build artifacts.

**Needs David:** create an Etherscan API key and set it as `VITE_ETHERSCAN_API_KEY` in Vercel. Etherscan lists Base Sepolia as a paid-tier chain; with a free key, verification there may answer "Etherscan's free plan doesn't cover this chain." while Sepolia and Sourcify go on working. Etherscan API V2 doesn't serve HashKey Chain testnet (chain 133; its explorer is Blockscout) or Hedera testnet (chain 296; its explorer is HashScan), so Studio never asks Etherscan about a diamond on either and verifies it on Sourcify alone. Etherscan API V2 does serve Avalanche Fuji (chain 43113, through Snowscan) and Monad Testnet (chain 10143, through Monadscan); whether a free key covers either is unconfirmed, the same caveat as Base Sepolia. Sourcify support for Monad Testnet could not be confirmed from this environment.

## Real-device performance check

The performance budgets (`docs/architecture.md`'s size, LCP and drag figures; spec "Performance and reliability") are measured in CI on a 4×-throttled headless Chromium, which the spec calls a stand-in: "must be re-checked on a real low-end phone before they are frozen."

**Needs David:** before shipping v1, run the app on a real low-end Android phone over a slow (or throttled) connection, with WebPageTest, Chrome DevTools remote debugging, or Lighthouse's own mobile device emulation against the deployed preview, and confirm first-load JavaScript, LCP and the drag-cost figure hold on real hardware, not only in the emulated CI profile. Record the device, connection and measured figures next to this step before treating the budgets as frozen.

## The v1 cut line

v1 ships only once every gate below passes (spec "Phasing", cut line for "v1: compose and deploy on testnets"). Each row names its command or its owner; "Needs David" rows are steps only he can run.

| Gate | Command or owner |
| --- | --- |
| Golden tests pass for all three recipes and shared-contract addresses | `bun run golden` |
| Every exported script deploys on an Anvil fork once the shared contracts are in it | `bun run test:chain` (local Anvil); the Sepolia fork suite in `ci.yml`'s `foundry` job (`SEPOLIA_FORK=1 bun run test:chain`, public RPCs, `SEPOLIA_RPC_URL` as the fallback) |
| A first-time user deploys and verifies on Sepolia in under 5 minutes, moderated | **Needs David**: run the timed script in `MANUAL.md` once it exists (pending Q25's permission decision) |
| First-load JavaScript budget met | `bun scripts/ci/size.ts --build` (also with `VITE_WALLETCONNECT_PROJECT_ID` set), plus the real-device check above; the gate is 255 KB, the measured first load after Q19 plus headroom, and the spec's 240 KB waits on the contracts' analysis provider going lazy |
| LCP and drag-cost budgets met | `bun scripts/perf/run.ts` (or `ci.yml`'s `perf` job); LCP and drag stay report-only until an open first-load decision is made, INP until Undo is made cheaper (#21), and the analysis of 30 colliding cards until `analyze` is (2026-10-10); `scripts/perf/report.ts`'s `REPORT_ONLY` names each, and when a fix lands its entry drops and the row enforces again |
| axe clean, with the manual keyboard scripts and screen readers | `bun run e2e apps/studio/e2e/a11y`; **Needs David**: the twelve manual keyboard scripts and the tier 1/2 screen-reader passes in [`apps/studio/e2e/a11y/MANUAL.md`](../apps/studio/e2e/a11y/MANUAL.md), before each minor release |
| Type-check, lint, size, schema and copy checks | `bun run check` |

Mainnet stays off in v1 regardless of the above (spec "Phasing"; "Open questions → Mainnet"); that's a separate decision for David, not a cut-line gate.
