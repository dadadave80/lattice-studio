# Fixture catalogs

Test data in the exact catalog file format (contracts §4), so core and UI work can start before catalog-gen
exists. **This is not the catalog.** Its `lattice.tag` is `fixture`, which the chain module refuses to deploy
("Fixture catalog: build the real catalog first"), and every release value is invented.

```
fixtures/
├─ catalog/
│  ├─ manifest.json          { default: "fixture", catalogs: [fixture, fixture-next] }; paths are relative to catalog/
│  ├─ provenance.json        where every fact comes from, with path#Lx-Ly at the pin (generated)
│  ├─ fixture/               index.json · shards/<Facet>.json · code/<Name>.creation.hex · json/Lattice.standard.json
│  └─ fixture-next/          the same with three changes, for the migrate flow
├─ gen/                      the generator and the overlay facts it reads
└─ validate.test.ts          schemas, formulas, references, routing counts and Lattice's source
```

Load them in tests with `loadFixtureCatalog(id)` and `loadFixtureShard(name, id)` from
`@lattice-studio/core/testing`.

## Regenerate

```sh
bun fixtures/gen/build.ts [--prototype <prototype-data.json>]
```

It reads Lattice's Solidity source at the pin (`LATTICE_DIR`, else the `lattice/` submodule; never `forge`
artifacts), the design prototype's data (`.handoff/design/prototype/prototype-data.json` by default) and the overlay
facts in `gen/overlay.ts`. Every overlay fact names a phrase on the Lattice line it comes from; the generator
resolves it to `path#Lx-Ly`, so a citation that stops matching the source fails the build. Don't edit
`catalog/` by hand.

## What is real

At Lattice `f4a32c8330934d39bcfdffff87d35a04b7fa6a79` (diamond-lib `393435fb`), `LatticeVersion.VERSION` =
`0.2.0` (`src/LatticeVersion.sol#L22`). `provenance.json` has the full list; the main sources:

| Fact | Source at the pin |
| --- | --- |
| The 100 facets, in order, and their source paths | `script/lib/FacetInventory.sol#L20-L228` |
| Each facet's selectors, in order | its `exportSelectors()` body (packed `hex"…"`, or `this.f.selector` for diamond-lib's four) |
| Signatures | the prototype's, each checked: `keccak256(signature)[:4]` equals the exported selector |
| ABI mutability, parameter names, elementary outputs | the facet's own `function` declaration |
| Storage ids | the prototype's namespaces; slots computed with ERC-7201 (R13) and each found as a constant in the source. DiamondCutFacet and DiamondLoupeFacet only call into `diamond.lib.storage` (`DiamondCutFacet.sol#L28`, `DiamondLoupeFacet.sol#L18`), so it's in their `touches` |
| Arachnid's proxy runtime codehash | the real one, `ARACHNID_PROXY_CODEHASH` from `packages/core/src/address` |
| `after` | `VaultCoreLib.sol#L64-L65`, `GovernedDiamondCutLib.sol#L113-L114` |
| GovernedVault template | `script/base/defi/DeployGovernedVault.s.sol#L76-L92` (cuts) and `#L117-L167` (exclusions) |
| ERC20 template (immutable default) | `script/base/tokens/DeployERC20.s.sol#L58-L64`, init chain `#L30-L37` |
| SafeDiamondCut template | `script/base/governance/DeploySafeDiamondCut.s.sol#L35-L43` |
| Account, Account6900 templates (v1.1) | `script/base/accounts/DeployAccount.s.sol#L35-L45`, `DeployAccount6900.s.sol#L31-L42` |
| Seams (R19) | `DeployGovernedVault.s.sol#L28-L35`, `DeployERC20Votes.s.sol#L21-L22`, `src/governance/Votes.sol#L43-L44` |
| Default owners | `docs/guides/compose-your-own-diamond.md#L40-L42` |
| VaultCore requires ERC4626 | `src/defi/libraries/VaultCoreLib.sol#L64-L65` |
| DiamondCutFacet needs OwnableInit | `lib/diamond-lib/src/facets/DiamondCutFacet.sol#L24-L26` |
| InitSpec signatures, parameter names and docs, `initializes` | each init contract's `init` body (see `provenance.json`) |
| GovernedVaultInit's struct and sequence | `src/defi/GovernedVaultInit.sol#L20-L30`, `#L44-L87` |
| GovernedVault examples | `script/base/defi/GrantExample.s.sol#L26` |
| Salt, address and slot formulas | `script/deploy/DeployRelease.s.sol#L94-L97`, `#L238`; ERC-7201 |

## What is invented

- `lattice.tag`: `fixture`, `fixture-next`. `provisional` says so.
- Every creation code: the UTF-8 bytes of `fixture:<Name>` (`fixture-next:ERC20` for the rebuilt facet). The
  formulas on top are real: `initCodeHash = keccak256(code)`, facet and init salts
  `keccak256(abi.encodePacked("lattice.", name, ".", version))`, LatticeRegistry and LatticeFactory
  `keccak256("lattice.<Name>")`, addresses CREATE2 through Arachnid's proxy `0x4e59b44847b379578588920cA78FbF26c0B4956C`.
- Every runtime codehash except Arachnid's proxy's: `keccak256("fixture:<Name>:runtime")`.
- DiamondCutFacet's summary: its source NatSpec is OwnableFacet's ("Simple single owner and multiroles
  authorization mixin."), so the fixture writes one from its `diamondCut` function.
- `json/Lattice.standard.json`: an empty stand-in.
- Shard ABIs carry functions only (no errors or events); outputs are listed only when every return type is
  elementary. NatSpec: the contract notice (the prototype's summary), no per-function docs.
- Examples marked `exampleSource: "studio"`: ERC20Init `name_` "Example Token" and `symbol_` "EXT",
  SafeDiamondCutInit `minThreshold` "2". GovernedVault's come from GrantExample.
- Template recipes' `catalog.hash` is the zero hash: an index can't contain its own hash, so `loadTemplate`
  stamps the live catalog's.
- `chains` is empty.
- `libraries`: PoseidonT3's release (salt by the facet formula, fake code). The link is real:
  `lib/zk-kit/lean-imt/InternalLeanIMT.sol#L4` imports the library, whose `hash` is `public`, and Semaphore and
  ShieldedPool build their trees on that LeanIMT. Their releases carry `dependsOn: ["PoseidonT3"]` and
  `provisional: "links PoseidonT3, which Lattice doesn't pin yet"`.
- `registryOwner`: decision D6's placeholder `0x000000000000000000000000000000000000dEaD`.
- `fixture-next`: EmergencyStop gains `guardianCount()` (invented) and Governor loses `version()`; both get new
  code, as a real release would, and ERC20 gets new code with the same selectors. New code is
  `fixture-next:<Name>`, so the codehash, init code hash and address change and the salt stays. Everything else
  equals `fixture`.

## Modeling choices

- **DiamondIntrospectionInit** has two entry points and an InitSpec has one `fn`, so it is two specs:
  `DiamondIntrospectionInit.initUpgradeable` and `DiamondIntrospectionInit.initImmutable`, one contract and one
  release. Both have `registersInterfaces`.
- **Template inits hold only what the script passes.** The automatic ERC-165 step isn't stored (the planner
  appends it). SafeDiamondCut calls its init directly; the template stores it as one step.
- **`initializes[].with`**: a value that names a parameter (`name_`, `p.name`) or a constructor argument
  (`entryPoint_` in the account inits' `ctorArgs`) refers to it; anything else is a literal (`"1"`,
  `"ERC6538Registry"`, `"address(this)"`, `"[address(0)]"`).
- **`after` names modules** (contracts §4): an init satisfies `after: [M]` when earlier steps initialize M or it
  initializes M itself. VaultCoreInit has `after: ["AccessControl", "ERC4626"]` and GovernedDiamondCutInit
  `after: ["AccessControl"]`; both run those modules themselves, so neither fires on its own. `sameCall` is empty
  everywhere (ERC20VotesInit, which needs it, isn't in the fixture).
- **OwnableInit and the account inits initialize `Ownable`** through `OwnableLib.initializeOwner`, which isn't a
  `__X_init`; they list it so INIT-04 can see DiamondCutFacet's owner is set.
- **Facet `init`** is set only where the facet has its own init contract in the fixture. ERC165Facet has none:
  no Lattice recipe runs ERC165Init (the known "no recipe registers 0x01ffc9a7" issue), and INIT-04 would block
  every template.
- **Families**: `upgrade` is R4's five; `access` is AccessControl, AccessControlEnumerable and
  AccessControlTimed (the same role selectors over one store); `account` marks one facet per account model,
  AccountSigner and ERC6900Validation (spec L324), so the account templates don't raise DEP-03 against themselves.
- **Requirements**: VaultCore → ERC4626 (hard); all four `diamondCut` mechanisms (AccessControlDiamondCut,
  GovernedDiamondCut, SafeDiamondCut, GovernedSafeDiamondCut) → EmergencyStop (convention, "a guardian can halt
  upgrades"), so the Blank diamond shows that one DEP-02 warning. Role writers carry no `requires` on
  AccessControl: C3 derives the namespace DEP-02 from `touches` against `storage.id` (contracts §4).
- **Storage**: `storage` is a namespace the facet owns; no two facets share a `storage.id` or slot.
- **Roles on authority parameters**: `DEFAULT_ADMIN_ROLE`, `owner`, `diamondCut` (SafeDiamondCut's Safe),
  `scheduleCut` (GovernedSafeDiamondCut's Safe), `signer` (AccountInit's owner).
- **GovernedVaultInit's `sequence`** names modules, plus `ERC-165 flags` for `DiamondLib.registerInterface()`.
- **The Blank diamond** (spec L990) isn't a Lattice deploy script, so it isn't a catalog template; the test builds
  it from the spec's list.

## Differences from the prototype data

- TimelockControllerStandalone is dropped: it isn't in `FacetInventory`.
- Version `0.2.0` (the pin), not `0.3.0`.
- GovernedVaultInit's sequence follows the Solidity: no Pausable step, and EIP712 and Nonces are in it.
- `requires` come from the source (above), not the prototype's "reads storage" list.
- Selectors, their order, the ERC-7201 slots and the templates' exclusions all match the prototype.
