# Golden: shared-contract addresses

Every shared contract's address in the catalog must be where Lattice's `DeployRelease` puts it for the same commit (spec, "Shared contracts are pinned too"), so a build-setting drift can't send people to addresses nothing will ever deploy.

| Path | What it is |
| --- | --- |
| `run.ts` | The suite. `bun run golden` runs it after the recipe routing check; `bun golden/release/run.ts` runs it alone |
| `harness/StudioGoldenRelease.t.sol` | Forge test that calls `DeployRelease.release()` and logs every address it returns |
| `compare.ts` | The pure logic: parse the logs, read the catalog, detect the deployer, compare. `compare.test.ts` covers it with synthetic data |

## What a run does

1. Reads the default catalog from `catalog/manifest.json` and checks that the Lattice checkout (`$LATTICE_DIR`, else `.env.local`, else `lattice/`) is at the catalog's commit. A different commit exits 2: rebuild the catalog with `bun run catalog` first.
2. Copies the harness into `<lattice>/test/.studio-golden-release-<pid>/` and runs it with `FOUNDRY_PROFILE=ci` through `golden/lib/forge.ts`, which deletes the folder afterwards. The harness etches Lattice's `MockCreateX` at CreateX's address (the release requires it at the pin) and Arachnid's proxy if the test chain lacks it, then calls `this.release(LatticeVersion.VERSION, owner)` as `ReleasePipelineTest` does. It never calls `run()`, which would write `deployments/<chainid>/release-<version>.json` into the checkout. The owner is the catalog's `registryOwner` (HANDOFF D6's placeholder `0x…dEaD`), passed as `STUDIO_RELEASE_OWNER`, because the registry's init code encodes it and the factory's encodes the registry. Since the owner isn't the caller, the release skips registration, which the comparison doesn't need.
3. Checks that `git status --porcelain` of the checkout is the same before and after.
4. Detects the deployer from where the registry landed: CREATE2 through Arachnid's proxy with the catalog's salt and init-code hash, or through CreateX with `keccak256(salt)` (CreateX's raw-salt guard). Anything else exits 1.
5. Compares the registry, the factory and the 100 facets by address and runtime codehash. `DeployRelease` deploys no init contracts, so inits aren't compared.

## Outcomes

- **At the pin (CreateX raw salts):** prints `skipped: Lattice A1 (release through Arachnid's proxy) isn't at the pin` and exits 0. The run still checks that the catalog's salts and init-code hashes give `DeployRelease`'s addresses through CreateX's formula, which proves they're the ones the release uses; the factory is left out there, because its init code holds the registry's address. A drift exits 1.
- **After Lattice A1 (Arachnid's proxy):** every catalog address and codehash must match exactly. Drift exits 1 with one `name: differs: address expected → DeployRelease` line per contract.
- **Known Lattice gap:** a contract whose catalog entry depends on a library Lattice doesn't pin (Semaphore and ShieldedPool link PoseidonT3, ledger "For Lattice" #5) diverges because forge links its own copy of the library. It's printed as `known Lattice gap` and doesn't fail the run; when Lattice pins the library and the catalog is rebuilt, it matches like any other contract.

`--update` is accepted and does nothing here: the catalog is the expectation, and `bun run catalog` rebuilds it.

Exit codes: 0 everything matches or the run is skipped, 1 drift or a harness failure, 2 bad arguments, no `forge`, no checkout or catalog, or a catalog built from another commit.
