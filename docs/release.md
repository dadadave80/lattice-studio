# Release

This describes how a change becomes a release: versioning, CI, hosting, and the CLI publish. Every step that only David can do (create accounts, add secrets, push the repository, click deploy) is marked **Needs David**. Nothing in this repository's build tooling pushes, publishes, deploys, or sends a transaction to a public network on its own — those actions all wait for one of the steps below.

## Versions and changelog

[`release-please`](https://github.com/googleapis/release-please) reads conventional commits and keeps two packages' versions and changelogs in step with them (`.github/workflows/release-please.yml`, configured in `.github/release-please-config.json` and `.github/release-please-manifest.json`): `packages/cli`, the one thing this project ships to a registry, and `apps/studio`, versioned so every export it writes (a Foundry script's header, an agent brief, a Safe batch) carries a real version instead of the placeholder `0.0.0` its `package.json` starts at. On every push to `main`, release-please opens or updates a pull request per package proposing its next version from the commits that touch it since its last release; merging a pull request bumps that package's `package.json`, writes its changelog, and tags its release. The other packages (`core`, `catalog-gen`, `tokens`) aren't independently versioned.

**Needs David:** the workflow only runs once the repository has a `main` branch on GitHub (see below).

## Hosting

Studio is a static app with two homes: Vercel, the primary origin with security headers, and an IPFS mirror behind a stable origin.

### Vercel

The Vercel project's root directory is `apps/studio`, with **Include source files outside of the Root Directory** turned on in the project settings — the committed `apps/studio/vercel.json`'s build command starts with `cd ../..` to reach the workspace root, and that setting is what lets it see the rest of the monorepo.

`apps/studio/vercel.json` is generated, not hand-edited (`apps/studio/build/csp.ts` and `apps/studio/build/headers.ts` compute its Content Security Policy from the exact chunks a build produces). To release:

1. Regenerate it against the release build: `STUDIO_VERCEL_JSON=1 bun run build`. This writes `apps/studio/vercel.json` with the CSP hash for that build's inline style and import map.
2. Commit `apps/studio/vercel.json`.
3. **Needs David:** push and deploy. Vercel's own build command (already in the committed file) then runs `bun run build` again, carries the previous release's hashed chunks forward from `$STUDIO_PREVIOUS_RELEASE` (an environment variable **David** sets to the live origin, so a tab that hasn't refreshed still finds the chunks it's asking for), and finally runs `apps/studio/build/verify-headers.ts`, which **fails the deploy** if the committed `vercel.json`'s CSP doesn't match the index.html this build actually produced. A stale, hand-edited, or forgotten-to-regenerate `vercel.json` is caught there, not silently shipped.

On the very first release, `$STUDIO_PREVIOUS_RELEASE` is empty; `carry-previous.ts` says so in its output and carries nothing forward.

### IPFS

The IPFS build can't send a CSP header, so its policy goes in a `<meta>` tag instead, and asset paths are relative:

```sh
bun run build --mode ipfs
bun apps/studio/build/carry-previous.ts --out apps/studio/dist --from <previous release's dist folder or URL>
bun apps/studio/build/verify-headers.ts apps/studio/dist
```

The last command, run with only the `dist` folder and no `vercel.json` path, checks the built `index.html`'s `<meta>` CSP against its own inline style and import map instead of a headers file.

**Needs David:** where the built folder is pinned, and the ENS name or other stable origin the IPFS mirror is served behind, are both undecided. Until a domain is chosen, exported `recipe.json` files carry a placeholder `$schema` URL (`https://lattice-studio.invalid/schema/recipe.v1.json`); it still validates locally, it just doesn't resolve.

## CI

`.github/workflows/` is written and ready but not running: `ci.yml` (the pull request gate: typecheck, lint, unit, browser, e2e, golden, chain, catalog drift, size, Lighthouse), `fork.yml` (the Sepolia fork suite), `nightly.yml` (the golden and chain suites against Lattice's `dev`, report-only), `release-please.yml`, `publish-cli.yml`, and `update-screenshots.yml` (manual, `workflow_dispatch` only: regenerates the missing `chromium-linux` screenshot baselines as a downloadable artifact — see "Linux screenshot baselines" below).

**Needs David:**

- Create the GitHub repository and push. None of these workflows run before that.
- Add the `SEPOLIA_RPC_URL` repository secret. Without it, `fork.yml`'s gate job checks for the secret, finds it missing, and stops there — the pull request gate's own `chain` job still runs against a local Anvil node either way, so this only adds the fork suite, it doesn't block anything by its absence.
- Add the `NPM_TOKEN` repository secret, scoped to publish `lattice-studio` with provenance. Needed before `publish-cli.yml` can run at all.
- Install solc 0.8.36 (Lattice's pin) before the `golden`, `chain`, and `catalog-drift` jobs run, so `forge build` inside the pinned Lattice checkout has it available.

## Linux screenshot baselines

Every `toMatchScreenshot` baseline committed today is `*-chromium-darwin.png`: made on a Mac, since that's where Studio has been built so far. `ci.yml`'s `browser` job runs on `ubuntu-latest`, so its first real run has no `chromium-linux` baseline to compare against for any of the 93 states on the Claude Design States boards, and the Components gate fails on missing references, not an actual difference.

`update-screenshots.yml` (`workflow_dispatch` only) regenerates them: it runs `bun x vitest run --update` for `apps/studio` on `ubuntu-latest`, which writes a `chromium-linux` reference beside each test's existing `chromium-darwin` one, and uploads every `*-chromium-linux.png` it produced as a build artifact.

**Needs David:** once the repository exists, dispatch `update-screenshots.yml`, download the `chromium-linux-baselines` artifact, review the images, and commit them into each test's `__screenshots__` folder next to the existing `chromium-darwin` files. This workflow only produces and uploads the images; nothing commits them automatically.

## Publishing the CLI

`packages/cli` publishes to npm as `lattice-studio`, with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) from a frozen lockfile and install scripts blocked. Publishing is manual and separate from tagging a release: `.github/workflows/publish-cli.yml` only runs on `workflow_dispatch`, and only does anything if the person dispatching it types `publish` into the `confirm` input.

**Needs David:** after `release-please`'s pull request is merged and the version is tagged, dispatch `publish-cli.yml` by hand with `confirm=publish`. This is the one step that actually sends a package to a public registry, so it's never automatic.

## Re-pinning to a tagged Lattice release

The catalog in `catalog/` is currently built from Lattice's `dev` branch, not a tagged release, and every shared-contract address in it will change once it's rebuilt from a real tag — see `docs/architecture.md` and `README.md`'s "Rebuilding and verifying the catalog".

**Needs David:** once Lattice `v0.4.0` is tagged and released through Arachnid's proxy, update the pinned submodule commit and run `bun run catalog` to rebuild. That rebuild is what clears the "Provisional catalog" notice the app and CLI print today. `docs/examples/erc20.recipe.json` is pinned to the current catalog's hash, so regenerate it from the rebuilt catalog's ERC20 template at the same time, or `lattice-studio check` on that example starts exiting 3 (catalog mismatch).

## Wallet connections

Studio's chain module supports WalletConnect as one wallet option, but it needs a WalletConnect Cloud project id to work, and none has been supplied yet. Until it is, the chain module says "WalletConnect isn't set up in this build of Studio"; every other wallet path (an injected wallet, `viem`'s other connectors) works without it.

The id goes in the `VITE_WALLETCONNECT_PROJECT_ID` build-time environment variable, read by `apps/studio/src/contracts/env.ts` as `env.walletConnectProjectId`.

**Needs David:** create a WalletConnect Cloud project and supply its project id, as `VITE_WALLETCONNECT_PROJECT_ID`.

**Config follow-up, once an id is set:** with `VITE_WALLETCONNECT_PROJECT_ID` set, the build's `codeSplitting` app group currently pulls `viem`, `ox` and `noble` into the entry chunk instead of the lazy chain module, adding about 79 KB gz to first load, and the WalletConnect SDK's own chunks miss the build's `NO_BUDGET_PATTERN` allowance. Both need a build-config change (chunking rule and budget pattern) before the id is set for real; until then the size budget check would fail on set. Not yet filed as its own work package — raise it against `apps/studio/vite.config.ts` and `scripts/ci/size-logic.ts` once David supplies an id.

## Contract verification

After a deploy Studio verifies the diamond on Sourcify, which needs no key, and on Etherscan (API V2, one key for every chain), which does. The build's default key goes in the `VITE_ETHERSCAN_API_KEY` build-time environment variable, read by `apps/studio/src/contracts/env.ts` as `env.etherscanApiKey`; a key typed in Settings → Deploy overrides it for that browser. Without either, Studio verifies on Sourcify alone.

The variable is inlined into the bundle and readable by anyone, so it must be a dedicated free-tier key, never a paid one (see `SECURITY.md`). Set it in the Vercel project's environment (Production and Preview), never in a GitHub workflow: CI uploads build artifacts.

**Needs David:** create an Etherscan API key and set it as `VITE_ETHERSCAN_API_KEY` in Vercel. Etherscan lists Base Sepolia as a paid-tier chain; with a free key, verification there may answer "Etherscan's free plan doesn't cover this chain." while Sepolia and Sourcify go on working. Etherscan API V2 doesn't serve HashKey Chain testnet (chain 133; its explorer is Blockscout), so Studio never asks Etherscan about a diamond there and verifies it on Sourcify alone.

## Real-device performance check

The performance budgets (`docs/architecture.md`'s size, LCP and drag figures; spec "Performance and reliability") are measured in CI on a 4×-throttled headless Chromium, which the spec calls a stand-in: "must be re-checked on a real low-end phone before they are frozen."

**Needs David:** before shipping v1, run the app on a real low-end Android phone over a slow (or throttled) connection, with WebPageTest, Chrome DevTools remote debugging, or Lighthouse's own mobile device emulation against the deployed preview, and confirm first-load JavaScript, LCP and the drag-cost figure hold on real hardware, not only in the emulated CI profile. Record the device, connection and measured figures next to this step before treating the budgets as frozen.

## The v1 cut line

v1 ships only once every gate below passes (spec "Phasing", cut line for "v1: compose and deploy on testnets"). Each row names its command or its owner; "Needs David" rows are steps only he can run.

| Gate | Command or owner |
| --- | --- |
| Golden tests pass for all three recipes and shared-contract addresses | `bun run golden` |
| Every exported script deploys on an Anvil fork once the shared contracts are in it | `bun run test:chain` (local Anvil); `fork.yml`'s Sepolia fork suite once **Needs David** adds `SEPOLIA_RPC_URL` |
| A first-time user deploys and verifies on Sepolia in under 5 minutes, moderated | **Needs David**: run the timed script in `MANUAL.md` once it exists (pending Q25's permission decision) |
| First-load JavaScript budget met | `bun scripts/ci/size.ts --build`, plus the real-device check above; **Needs David** to choose among Q19's budget options while the interim 370 KB gate holds |
| LCP and drag-cost budgets met | `bun scripts/perf/run.ts` (or the `perf.yml` job); LCP and drag stay report-only until an open first-load decision is made; `scripts/perf/report.ts`'s `REPORT_ONLY` names both, and when it lands their entries drop and Lighthouse's assert moves from `warn` to `error` |
| axe clean, with the manual keyboard scripts and screen readers | `bun run e2e apps/studio/e2e/a11y`; **Needs David**: the twelve manual keyboard scripts and the tier 1/2 screen-reader passes in [`apps/studio/e2e/a11y/MANUAL.md`](../apps/studio/e2e/a11y/MANUAL.md), before each minor release |
| Type-check, lint, size, schema and copy checks | `bun run check` |

Mainnet stays off in v1 regardless of the above (spec "Phasing"; "Open questions → Mainnet"); that's a separate decision for David, not a cut-line gate.
