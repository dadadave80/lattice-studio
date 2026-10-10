# Address fixtures

`lattice-6c8db45.json` holds the bytecode that `../anvil.test.ts` deploys on Anvil. It comes from Lattice at the
pinned commit `6c8db45aa46986af2edb6a0d8fb02a4a92faef01`, built with `FOUNDRY_PROFILE=ci` (solc 0.8.36, the
version in Lattice's `foundry.toml`) and Foundry 1.8.3. Don't edit it by hand. Regenerate it whenever the pin
changes.

| Field | Source |
| --- | --- |
| `latticeCreationCode` | `forge inspect src/Lattice.sol:Lattice bytecode` |
| `latticeInitCodeHash` | `keccak256` of `latticeCreationCode`: the `proxyInitCodeHash` that `LatticeFactory` stores (L34-L35, L47) |
| `latticeFactoryCreationCode` | `forge inspect src/LatticeFactory.sol:LatticeFactory bytecode` |
| `mockCreatexRuntimeCode` | `forge inspect test/helpers/MockCreateX.sol:MockCreateX deployedBytecode` |

## Regenerate

Build a copy of the checkout, never `lattice/` itself:

```sh
rsync -a --exclude .git --exclude out --exclude cache --exclude broadcast lattice/ /tmp/lattice-pin/
cd /tmp/lattice-pin
FOUNDRY_PROFILE=ci forge build src/LatticeFactory.sol test/helpers/MockCreateX.sol
FOUNDRY_PROFILE=ci forge inspect src/Lattice.sol:Lattice bytecode > lattice.hex
FOUNDRY_PROFILE=ci forge inspect src/LatticeFactory.sol:LatticeFactory bytecode > factory.hex
FOUNDRY_PROFILE=ci forge inspect test/helpers/MockCreateX.sol:MockCreateX deployedBytecode > mock-createx.hex
cast keccak "$(cat lattice.hex)"   # latticeInitCodeHash
```

Put the four values into the JSON, update `source` with the new commit and tool versions, and rename the file to
the new short commit. Then rerun `bun test packages/core/src/address`. The literal addresses under "vectors pinned
from Anvil" in `../index.test.ts` depend on `latticeInitCodeHash`, so update them from the new Anvil run.

At `6c8db45`, the output of these `forge inspect` commands matches the committed JSON byte for byte. It's the same
bytecode as at the previous pin, `f4a32c8`: the move added facets and changed none of these three contracts, so the
addresses under "vectors pinned from Anvil" stand.
