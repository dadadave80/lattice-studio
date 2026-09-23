# Golden: shared-contract addresses

Every shared contract's address in the catalog must be where Lattice's `DeployRelease` puts it for the same commit (spec, "Shared contracts are pinned too"), so a build-setting drift can't send people to addresses nothing will ever deploy.

| Path | What it is |
| --- | --- |
| `run.ts` | The suite. `bun run golden` runs it after the recipe routing check; `bun golden/release/run.ts` runs it alone |
| `harness/StudioGoldenRelease.t.sol` | Forge test that calls `DeployRelease.release()` and logs every address it returns |
| `compare.ts` | The pure logic: parse the logs, read the catalog, detect the deployer, compare. `compare.test.ts` covers it with synthetic data |

## What a run does

1. Reads the default catalog from `catalog/manifest.json` and checks that the Lattice checkout (`$LATTICE_DIR`, else `.env.local`, else `lattice/`) is at the catalog's commit. A different commit exits 2: rebuild the catalog with `bun run catalog` first.
2. Copies the harness into `<lattice>/test/.studio-golden-release-<pid>/` and runs it with `FOUNDRY_PROFILE=ci` through `golden/lib/forge.ts`, which deletes the folder afterwards. The harness etches Arachnid's proxy if the test chain lacks it, then calls `this.release(LatticeVersion.VERSION, owner)` as `ReleasePipelineTest` does. Only if that reverts with DeployRelease's "CreateX has no code" does it etch Lattice's `MockCreateX` at CreateX's address and call again (the run says so). It also logs the creation code `vm.getCode` gives for each known-gap facet, which run.ts names in `STUDIO_RELEASE_CODE`. It never calls `run()`, which would write `deployments/<chainid>/release-<version>.json` into the checkout. The owner is the catalog's `registryOwner` (HANDOFF D6's placeholder `0x…dEaD`), passed as `STUDIO_RELEASE_OWNER`, because the registry's init code encodes it and the factory's encodes the registry. Since the owner isn't the caller, the release skips registration, which the comparison doesn't need.
3. Checks that `git status --porcelain` of the checkout is the same before and after.
4. Detects the deployer from where the registry landed: CREATE2 through Arachnid's proxy with the catalog's salt and init-code hash, or through CreateX with `keccak256(salt)` (CreateX's raw-salt guard). Anything else exits 1.
5. Compares the registry, the factory and the 100 facets by address and runtime codehash. `DeployRelease` deploys no init contracts, so inits aren't compared.

## Outcomes

- **At the pin (CreateX raw salts):** first checks that the catalog's salts and init-code hashes give `DeployRelease`'s addresses through CreateX's formula, which proves they're the ones the release uses; the factory is left out there, because its init code holds the registry's address. A drift exits 1. Otherwise it prints `skipped: Lattice A1 (release through Arachnid's proxy) isn't at the pin` last and exits 0.
- **After Lattice A1 (Arachnid's proxy):** every catalog address and codehash must match exactly. Drift exits 1 with one `name: differs: address expected → DeployRelease` line per contract.
- **Known Lattice gap:** a contract whose catalog entry depends only on libraries the catalog releases provisionally (Semaphore and ShieldedPool link PoseidonT3, which Lattice doesn't pin, ledger "For Lattice" #5) may diverge because forge links its own copy of the library. The divergence is printed as `known Lattice gap` and passes only when all of these hold: the catalog's `code/<Name>.creation.hex` hashes to its init-code hash; forge's creation code has the same length and differs from it only in the 20-byte windows where the catalog's code holds the library's catalog address; every such window holds the same forge address; and DeployRelease put the contract where forge's creation code lands. Anything else is `differs` and exits 1. When Lattice pins the library and the catalog is rebuilt, the contract matches like any other.

`--update` is accepted and does nothing here: the catalog is the expectation, and `bun run catalog` rebuilds it.

Exit codes: 0 everything matches or the run is skipped, 1 drift or a harness failure, 2 bad arguments, no `forge`, no checkout, a missing or unparsable catalog, or a catalog built from another commit.
