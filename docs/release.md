# Release

This describes how a change becomes a release: versioning, CI, hosting, and the CLI publish. Every step that only David can do (create accounts, add secrets, push the repository, click deploy) is marked **Needs David**. Nothing in this repository's build tooling pushes, publishes, deploys, or sends a transaction to a public network on its own — those actions all wait for one of the steps below.

## Versions and changelog

[`release-please`](https://github.com/googleapis/release-please) reads conventional commits and keeps `packages/cli`'s version and `CHANGELOG.md` in step with them (`.github/workflows/release-please.yml`, configured in `.github/release-please-config.json`). On every push to `main`, it opens or updates a pull request proposing the next version from the commits since the last release; merging that pull request bumps `packages/cli/package.json`, writes the changelog, and tags the release. `apps/studio` and the other packages aren't independently versioned — the CLI is the one thing this project ships as a package.

**Needs David:** the workflow only runs once the repository has a `main` branch on GitHub (see below).

## Hosting

Studio is a static app with two homes: Vercel, the primary origin with security headers, and an IPFS mirror behind a stable origin.

### Vercel

The Vercel project's root directory is `apps/studio`, with **Include source files outside of the Root Directory** turned on in the project settings — the committed `apps/studio/vercel.json`'s build command starts with `cd ../..` to reach the workspace root, and that setting is what lets it see the rest of the monorepo.

`apps/studio/vercel.json` is generated, not hand-edited (`packages/core/src/format` and `apps/studio/build/headers.ts` compute its Content Security Policy from the exact chunks a build produces). To release:

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

**Needs David:** where the built folder is pinned, and the ENS name or other stable origin the IPFS mirror is served behind, are both undecided (see `.handoff` decision D11 in the internal plan — there's no public tracker for this yet). Until a domain is chosen, exported `recipe.json` files carry a placeholder `$schema` URL (`https://lattice-studio.invalid/schema/recipe.v1.json`); it still validates locally, it just doesn't resolve.

## CI

`.github/workflows/` is written and ready but not running: `ci.yml` (the pull request gate: typecheck, lint, unit, browser, e2e, golden, chain, catalog drift, size, Lighthouse), `fork.yml` (the Sepolia fork suite), `nightly.yml` (the golden and chain suites against Lattice's `dev`, report-only), `release-please.yml`, and `publish-cli.yml`.

**Needs David:**

- Create the GitHub repository and push. None of these workflows run before that.
- Add the `SEPOLIA_RPC_URL` repository secret. Without it, `fork.yml`'s gate job checks for the secret, finds it missing, and stops there — the pull request gate's own `chain` job still runs against a local Anvil node either way, so this only adds the fork suite, it doesn't block anything by its absence.
- Add the `NPM_TOKEN` repository secret, scoped to publish `lattice-studio` with provenance. Needed before `publish-cli.yml` can run at all.
- Foundry's `foundry-toolchain` action installs Foundry 1.8.3 for the `golden`, `chain`, and `catalog-drift` jobs; it installs solc 0.8.36 as part of that (Lattice's pin), so no separate solc setup step is needed once that action runs — but check this holds the first time CI actually runs, since it's untested against a live GitHub Actions run until the repository exists.

## Publishing the CLI

`packages/cli` publishes to npm as `lattice-studio`, with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) from a frozen lockfile and install scripts blocked. Publishing is manual and separate from tagging a release: `.github/workflows/publish-cli.yml` only runs on `workflow_dispatch`, and only does anything if the person dispatching it types `publish` into the `confirm` input.

**Needs David:** after `release-please`'s pull request is merged and the version is tagged, dispatch `publish-cli.yml` by hand with `confirm=publish`. This is the one step that actually sends a package to a public registry, so it's never automatic.

## Re-pinning to a tagged Lattice release

The catalog in `catalog/` is currently built from Lattice's `dev` branch, not a tagged release, and every shared-contract address in it will change once it's rebuilt from a real tag — see `docs/architecture.md` and `README.md`'s "Rebuilding and verifying the catalog".

**Needs David:** once Lattice `v0.4.0` is tagged and released through Arachnid's proxy, update the pinned submodule commit and run `bun run catalog` to rebuild. That rebuild is what clears the "Provisional catalog" notice the app and CLI print today.

## Wallet connections

Studio's chain module supports WalletConnect as one wallet option, but it needs a WalletConnect Cloud project id to work, and none has been supplied yet. Until it is, the chain module says "WalletConnect isn't set up in this build of Studio"; every other wallet path (an injected wallet, `viem`'s other connectors) works without it.

**Needs David:** create a WalletConnect Cloud project and supply its project id. Where that id is read from is the chain module's own concern; check its documentation once that module ships.
