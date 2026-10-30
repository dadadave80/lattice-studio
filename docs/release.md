# Release

This describes how a change becomes a release: versioning, CI, hosting, and the CLI publish. Every step that only David can do (create accounts, add secrets, push the repository, click deploy) is marked **Needs David**. Nothing in this repository's build tooling pushes, publishes, deploys, or sends a transaction to a public network on its own — those actions all wait for one of the steps below.

## Versions and changelog

[`release-please`](https://github.com/googleapis/release-please) reads conventional commits and keeps two packages' versions and changelogs in step with them (`.github/workflows/release-please.yml`, configured in `.github/release-please-config.json` and `.github/release-please-manifest.json`): `packages/cli`, the one thing this project ships to a registry, and `apps/studio`, versioned so every export it writes (a Foundry script's header, an agent brief, a Safe batch) carries a real version instead of the placeholder `0.0.0` its `package.json` starts at. On every push to `main`, release-please opens or updates a pull request per package proposing its next version from the commits that touch it since its last release; merging a pull request bumps that package's `package.json`, writes its changelog, and tags its release. The other packages (`core`, `catalog-gen`, `tokens`) aren't independently versioned.

The workflow runs on every push to `main` with a token from the lattice-release-please GitHub App (`RELEASE_PLEASE_APP_CLIENT_ID` variable, `RELEASE_PLEASE_APP_PRIVATE_KEY` secret), so the release PR it opens runs CI like any other. **Needs David:** merging that PR cuts the first version; it proposes 0.1.0 for both packages (`initial-version`).

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

`ci.yml` runs on pull requests and on `workflow_dispatch`, not on pushes: a pull request is the only way into `dev` or `main`, so a merge doesn't test the same commit again. On a pull request each job and step runs only when its inputs changed: a first `changes` job diffs the pull request against its base, and `scripts/ci/changes.sh` maps the paths to the jobs that read them. A job gated off shows as skipped, which GitHub counts as passing. A change to Markdown at the root, `docs/` or `skills/` runs nothing; a pitch deck runs check, unit and size; a change to a workflow, `.github/actions/`, `bun.lock` or a root config runs everything. A `workflow_dispatch` run is always the full suite, and `nightly.yml` sends one for `dev` every night.

Related suites share a runner instead of each paying for the same install: `static` runs check, unit and size; `foundry` builds Lattice once, then runs chain with the Sepolia fork suite, golden and catalog drift, each step even when an earlier one failed. End to end runs as five parallel jobs: the `chromium` project split four ways with Playwright's `--shard`, and the `webkit-smoke` project on its own, the only runner that installs WebKit. Every job sets up through `.github/actions/setup` (Bun, the frozen install, and Node, Foundry or Playwright's browsers as needed), which restores Playwright's browsers; `.github/actions/lattice-build` restores the Lattice build, keyed on the submodule's commit. GitHub shows a pull request only the caches saved on its own ref or its base branch, so `warm-cache.yml` saves them on `dev` and `main` whenever `bun.lock`, the Lattice pin or the setup changes; catalog drift needs no cache, since `bun run catalog` always builds a fresh copy.

**Needs David:**

- Add the `SEPOLIA_RPC_URL` repository secret. The Sepolia fork suite runs without it: the fork suite forks a recent finalized Sepolia block from the first public RPC that serves it and uses the secret only when every public one fails, so the secret is a fallback, not a gate. The local Anvil chain tests run either way.
- Add the `NPM_TOKEN` repository secret, scoped to publish `lattice-studio` with provenance. Needed before `publish-cli.yml` can run at all.
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

`packages/cli` publishes to npm as `lattice-studio`, with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) from a frozen lockfile and install scripts blocked. Publishing is manual and separate from tagging a release: `.github/workflows/publish-cli.yml` only runs on `workflow_dispatch`, and only does anything if the person dispatching it types `publish` into the `confirm` input.

**Needs David:** after `release-please`'s pull request is merged and the version is tagged, dispatch `publish-cli.yml` by hand with `confirm=publish`. This is the one step that actually sends a package to a public registry, so it's never automatic.

## Re-pinning to a tagged Lattice release

The catalog in `catalog/` is currently built from Lattice commit `6c8db45`, which carries the tag `hedera-template-pin-6c8db45` but isn't a `vX.Y.Z` release, and every shared-contract address in it will change once it's rebuilt from a release tag — see `docs/architecture.md` and `README.md`'s "Rebuilding and verifying the catalog".

**Needs David:** Lattice `v0.5.0` was released on October 9, 2026, so the re-pin is unblocked, and it is larger than `bun run catalog`. Lattice #321 changed `RecipeEntry` (it gains `bytes4[] exclude`), with it the `deploy` selector, and the `DiamondDeployed` event, so the frozen contracts layer (`packages/core/src/model/`, `apps/studio/src/contracts/`) changes as well; every shared-contract address moves, and the shared contracts placed on Hedera testnet on October 4, 2026 need redeploying. Until then the catalog's notice keeps naming 0.4.0 as the target: `TARGET_VERSION` in `packages/catalog-gen/src/main.ts` is baked into the committed catalog, and the `catalog-drift` job rebuilds and diffs it, so the constant and the catalog move together. To re-pin: update the pinned submodule commit and `TARGET_VERSION`, run `bun run catalog` to rebuild, and regenerate `docs/examples/erc20.recipe.json` from the rebuilt catalog's ERC20 template, since it is pinned to the catalog's hash and `lattice-studio check` on it otherwise starts exiting 3 (catalog mismatch). That rebuild is what clears the "Provisional catalog" notice the app and CLI print today.

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
