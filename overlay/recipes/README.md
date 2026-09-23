# Recipe templates

One file per Lattice deploy script (spec L192-L197, "Recipes are pinned to scripts" L912): what the script's
`buildCuts` builds, written as the steps it takes, so Studio's template is the script's own diamond.
`packages/catalog-gen/src/recipes.ts` reads these files and `../seams.yaml`, and `bun run catalog` folds them into
the catalog's `recipes` and `seams`.

Every script under `script/base/` is a template here or is listed in `SKIPPED_SCRIPTS` in `recipes.ts` with the
reason (demos that build no diamond, GrantExample, and the two scripts whose facets aren't in `FacetInventory`).

```yaml
name: ERC20                        # the file's name; the recipe's name in Studio
order: 2                           # optional: position among the phase's recipes (Flow 2's card order)
script: script/base/tokens/DeployERC20.s.sol
buildCuts: buildCuts(string,string)          # the overload, as the golden harness names it
source: script/base/tokens/DeployERC20.s.sol#L30-L37   # that function
proxy: Lattice                     # Lattice | AccountDiamond | ModularAccount6900
phase: v1                          # v1 (loads) | v1.1 | later
immutable: true                    # exactly when the script cuts no upgrade mechanism
cuts:                              # in the script's order
  - add: ERC20                     # all the facet exports
    source: script/base/tokens/DeployERC20.s.sol#L61-L61
  - add: ERC4626                   # only these
    selectors: ["asset()", "totalAssets()"]
    source: …#L69-L74              # the cut line (and where the facet is constructed)
    listSource: …#L82-L100         # where the list is spelled out, when elsewhere
  - add: Votes                     # all but these (_cutExcept)
    except: ["delegate(address)"]
    source: …
    listSource: …
  - replace: ERC20Pausable         # Replace: all it exports, or only `selectors`
    source: …
init:                              # what the script passes, never the automatic ERC-165 step (R11)
  kind: steps                      # steps | bundle | none
  steps:
    - spec: ERC20Init              # an init spec name (`<Contract>.<fn>` only with two usable entry points)
      args:                        # by parameter name; tuples by field; integers as quoted decimal strings
        name_: "Example Token"
      source: …                    # optional: when the step comes from a base recipe's file
  source: script/base/tokens/DeployERC20.s.sol#L35-L36
gaps: >-                           # what the template doesn't carry yet (required when an argument is empty)
  …
notes: Free text for maintainers.
```

## Rules

- **Selectors** are signatures (`transfer(address,uint256)`) or quoted lowercase hex (`"0xa9059cbb"`).
- **Citations** are `path#L<a>-L<b>` in the Lattice checkout at the pin. The cited lines must name what they're
  cited for: a cut's facet, each listed selector's function, each step's init contract, the `buildCuts` overload.
- **Owners and exclusions are derived**, never written: the cuts are applied in order with DiamondLib's rules
  (Add needs a free selector, Replace one another facet serves), every selector two placed facets export gets its
  final server as owner, and every exported selector the script leaves out goes to `exclude`.
- **Arguments** in v1 templates are the overlay's examples (`overlay/inits/`): Lattice's callers where they exist
  (GovernedVault's from `script/base/defi/GrantExample.s.sol`), Studio's otherwise. An argument with no safe
  example stays empty so INIT-01 asks for it (GovernedVault's `asset`, SafeDiamondCut's `safe`). References are
  `{ $ref: deployer }` or `{ $ref: self }`.
- Templates store the zero hash in `recipe.catalog.hash`; `loadTemplate` stamps the live catalog's (contracts §3.1).

`bun test packages/catalog-gen/test/cg6` checks every file: schema, cuts against the facets' selectors, citations
and each script's facets against the checkout, routing through core against what the script builds, and the three
v1 templates against the golden routing (`golden/expected/`).
