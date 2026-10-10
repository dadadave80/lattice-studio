# @lattice-studio/catalog-gen

Builds Studio's catalog (`catalog/<id>/`) from a Lattice checkout, and verifies a committed catalog against a rebuild.

## `bun run catalog`

```sh
bun run catalog [--lattice <dir>] [--out <dir>] [--clean] [--copy] [--allow-main-checkout]
```

Needs Foundry 1.8.3 exactly (forge and anvil); any other version stops the run with the fix. The checkout must be
clean, because the catalog records its commit.

1. Builds the checkout with `FOUNDRY_PROFILE=ci forge build`, then diamond-lib's initializers, which the plain build
   leaves out. The main checkout's `lattice/` (the default, and what CI's drift check uses) is read-only, so every
   run copies its tracked files to a fresh temporary directory and builds that from nothing: about 100 s each time,
   and `--clean` changes nothing there. A checkout of your own (`--lattice <dir>`, or a worktree's `LATTICE_DIR`) is
   built in place, incrementally: seconds when `out/` is current, and `--clean` runs `forge clean` first. `--copy`
   gives any checkout the fresh-copy treatment; `--allow-main-checkout` builds the main checkout in place, for a
   fresh CI clone that owns it only.
2. On a local Anvil (from `ANVIL_PORT_BASE`): facets and their exported selectors, storage namespaces, init
   contracts with the overlay, seams and recipe templates, release data for every shared contract through
   Arachnid's proxy, the `Lattice` proxy, and per-chain releases from `deployments/<chainid>/release-<version>.json`
   when Lattice has any.
3. Checks everything against everything else: selectors against ABIs, storage slots against their formulas, the
   overlay lint (errors stop the run; warnings are listed), template routing against the scripts, citations against
   the checkout, and the factory's `predict` against the proxy's init-code hash.
4. Writes `catalog/<id>/` atomically and makes it `manifest.json`'s default. `<id>` is the checkout's release tag, or
   `dev-<commit7>`. When the checkout's `VERSION` isn't 0.4.0, the catalog's `provisional` says so
   ("Lattice 0.2.0 at dev 6c8db45; v1 targets 0.4.0"). The index is minified, and keeps template recipes and init
   parameter docs in `recipes.json` and `init-docs.json` beside it, which the app loads on first use.

The summary lists the release report (salt, address and codehash of every shared contract), the overlay lint, init
notes, template gaps, chain-release gaps for Lattice A4, and the index size against its 60 KB gzip target. That
target isn't met: what's left (about 72 KB gz) is shared contracts' release data, accepted as the floor.

Two runs from the same commit write the same bytes. Never edit `catalog/` by hand.

## Verifying a catalog

```sh
bun packages/catalog-gen/src/verify.ts [--lattice <dir>] [--catalog <dir>] [--in-place]
```

Rebuilds the catalog from the checkout in a fresh temporary copy, built clean (nothing the checkout built is
trusted, and nothing is written into it), and compares every file and the manifest's hash with the committed
`catalog/<id>/`. `--in-place` builds incrementally in the checkout itself instead, trusting its `out/`; the main
checkout's `lattice/` is read-only, so it's copied either way.
Exit codes: 0 match, 2 the rebuild couldn't run, 3 catalog mismatch. The CLI's `verify-catalog` uses the same
`verifyCatalog` and `verifyExitCode`.

## Modules

| File | Does |
| --- | --- |
| `inventory.ts`, `artifacts.ts`, `natspec.ts`, `anvil.ts` | Facets, artifacts, NatSpec, a local Anvil (CG1) |
| `addressing.ts`, `release.ts` | Salts, addresses, release data, the proxy, `buildLattice` (CG2) |
| `storage.ts` | ERC-7201 namespaces and touches (CG3) |
| `inits.ts` | Init contracts (CG4) |
| `overlay.ts`, `overlay-lint.ts` | The metadata overlay and its lint (CG5) |
| `recipes.ts` | Seams and recipe templates (CG6) |
| `write.ts`, `shards.ts`, `size-report.ts` | Assembling and writing a catalog (CG7) |
| `main.ts`, `verify.ts`, `chains.ts` | The command, the verifier and chain releases (CG8) |
