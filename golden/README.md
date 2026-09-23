# Golden tests

Studio's plan for a recipe must equal what Lattice's own deploy script builds (spec, "Recipes are pinned to scripts"). This folder asks the scripts and records the answer.

| Path | What it is |
| --- | --- |
| `run.ts` | `bun run golden`: runs the harness, compares with `expected/`, then runs every other suite (`golden/<suite>/run.ts`) |
| `harness/StudioGoldenRouting.t.sol` | Forge test that calls each recipe script's `buildCuts(...)` and logs what it returned |
| `lib/` | The pure logic (parse, apply cuts, diff) and the Forge runner, with `bun test` coverage |
| `expected/<Recipe>.routing.json` | Expected routing and init sequence per recipe. Generated: only `bun run golden --update` writes them |

## Running it

```sh
bun run golden            # compare; exit 1 with a per-selector diff on drift
bun run golden --update   # rewrite expected/ from the scripts, then review the git diff
```

Needs Foundry 1.8.3 and a Lattice checkout built with the ci profile (`FOUNDRY_PROFILE=ci forge build --root <lattice>`). The checkout is `$LATTICE_DIR`, else `LATTICE_DIR` from the repo's `.env.local`, else `lattice/`. A run with a warm build takes about 35 seconds, almost all of it compiling the harness.

Exit codes: 0 everything matches, 1 drift or a harness failure, 2 bad arguments, no `forge`, or no checkout.

## How it works

1. `run.ts` copies the harness into `<lattice>/test/.studio-golden-<pid>/` and runs `forge test --root <lattice> --match-path 'test/.studio-golden-<pid>/*' --json-file … -vv` with `FOUNDRY_PROFILE=ci` in the environment. Lattice picks its profile from that variable, and the SafeDiamondCut script shells out to `forge inspect`, which reads the variable and ignores `--profile`. The folder, including the JSON result, is deleted afterwards, even when forge fails or the run is interrupted. `run.ts` also compares `git status --porcelain` of the checkout before and after and fails if the run changed anything.
2. Each harness test calls one script's own `buildCuts` (BaseDeploy has none): `DeployERC20.buildCuts(string,string)` (the default, immutable overload), `DeploySafeDiamondCut.buildCuts(address,address,uint256)` and `DeployGovernedVault.buildCuts(GovernedVaultParams)`. Without CreateX on the test chain, `BaseDeploy._facet` falls back to `deployCode`, so every facet and init is a fresh contract.
3. The harness names each contract by its runtime codehash: facets against every `FacetInventory` entry (so names are the catalog's facet names), inits against `_initArtifacts()`. It logs one `STUDIO_GOLDEN` line per recipe header, cut, init and init step. It never writes files, so Lattice's `fs_permissions` stay untouched.
4. `lib/report.ts` applies the cuts in order to an empty selector map with DiamondLib's rules (Add needs a free selector, Replace an existing one on another facet, Remove the zero address). A sequence the diamond would reject fails the harness rather than counting as drift. What's left is the final selector-to-facet routing, so Add-then-Replace sequences normalize to their result.
5. The init: ERC20 wraps its steps in `MultiInit([ERC20Init, DiamondIntrospectionInit.initImmutable])`, which the harness decodes into steps, stopping where `MultiInit` stops (the first zero address). GovernedVault and SafeDiamondCut call their init directly, recorded as a one-step sequence.
6. `run.ts` looks up each selector's signature in the serving contract's build artifact, builds `expected/<Recipe>.routing.json`'s content and compares it with the committed file (`lib/diff.ts`).

## Expected file format

GT1b's comparison reads these files, so treat the shape as an interface.

```jsonc
{
  "recipe": "ERC20",                                   // Studio's recipe template name
  "script": "script/base/tokens/DeployERC20.s.sol",    // relative to the Lattice checkout
  "buildCuts": "buildCuts(string,string)",             // the overload the harness calls
  "facets": ["ERC165Facet", "ERC20", "DiamondLoupeFacet", "Receive"],
                                                       // facets serving ≥ 1 selector, in first-cut order
  "routing": { "0x00000000": "Receive", "0x01ffc9a7": "ERC165Facet" },
                                                       // selector (lowercase) → FacetInventory name, sorted
  "signatures": { "0x00000000": "receive()", "0x01ffc9a7": "supportsInterface(bytes4)" },
                                                       // same keys; 0x00000000 is Receive's empty-calldata route
  "init": {
    "kind": "MultiInit",                               // "MultiInit" | "direct" | "none"
    "steps": [                                         // call order
      { "init": "ERC20Init", "selector": "0x7029144c", "signature": "init(string,string)" },
      { "init": "DiamondIntrospectionInit", "selector": "0xd1a4dbd8", "signature": "initImmutable()" }
    ]
  }
}
```

Addresses and codehashes aren't recorded: they're artifacts of the test chain. `golden/release/` (GT2) compares shared-contract addresses.

A plain run prints drift as `selector signature: expected → Lattice now`, for example `0xa9059cbb transfer(address,uint256): ERC20 → GovernedVault`, plus changed facets, init kind and init steps. A file that differs from what `--update` would write in any other way (an extra key, a different key order) fails too.

## Adding a recipe

1. In `harness/StudioGoldenRouting.t.sol`, add a `test_<Recipe>()` that logs `_recipe("<Recipe>", "<script path>", "<buildCuts signature>")`, calls the script's `buildCuts(...)` with plausible arguments and passes the result to `_report`.
2. If the recipe deploys an init that isn't in `_initArtifacts()`, add its artifact id (`File.sol:Name`). A run names the missing one.
3. Add the recipe's name to `RECIPES` in `run.ts` and to the list in `lib/diff.test.ts`.
4. Run `bun run golden --update`, check the new file against the script's exclusion notes, and commit it.

## Adding a suite

Any `golden/<suite>/run.ts` runs after the routing check, with the same arguments (`--update` included) and environment, and its exit code counts toward `bun run golden`'s. `lib/forge.ts` exports `runForgeHarness` (copy files into a unique test folder, run them with the ci profile, parse the JSON, clean up) and `latticeDir` for reuse.
