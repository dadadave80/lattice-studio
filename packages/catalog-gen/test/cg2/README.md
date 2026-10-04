# CG2 · Release addressing

`src/addressing.ts` (pure rules) and `src/release.ts` (Lattice build + Anvil) produce, for every shared contract, the salt, version, creation code, init-code hash, address through Arachnid's proxy (`0x4e59…956C`) and runtime codehash. For the `Lattice` proxy they produce the creation code, init-code hash and a pruned standard JSON input.

## Rules at the pin

Lattice `6c8db45`, `VERSION` 0.2.0. Every address is provisional until the 0.4.0 re-pin (HANDOFF D2). At this pin Lattice's `DeployRelease` still releases through CreateX raw salts wherever CreateX exists, so there these addresses don't match Lattice's own release until Lattice A1 lands; on a chain without CreateX (Hedera) it falls back to Arachnid's proxy with the same salts and lands at these addresses. GT2 checks that.

- **Version**: `LatticeVersion.VERSION`, read from `src/LatticeVersion.sol`.
- **Salt**: `sharedSalt(name, version)` = `keccak256("lattice.<Name>.<version>")`. LatticeRegistry and LatticeFactory are versionless.
- **Constructor arguments**: `LatticeRegistry(0x000000000000000000000000000000000000dEaD)`. That owner is the D6 placeholder, recorded as `ReleaseData.registryOwner`. `LatticeFactory(registry, 0, 0)` takes the registry's predicted address and no ENS reverse registrar (`DeployRelease.s.sol` L161-L171). Any other contract whose ABI has constructor inputs is per-deployment, so it's listed in `skipped` with no release data.
- **Linked libraries** (PoseidonT3): Lattice pins no library address. Studio releases each library as a shared contract of its own, through Arachnid's proxy at `sharedSalt("<Lib>", version)` (`keccak256("lattice.PoseidonT3.0.2.0")` at the pin), and links that address. The library's entry has `library: true`. Every contract that links it (Semaphore, ShieldedPool) carries `links`, `dependsOn: ["PoseidonT3"]` and a `provisional` sentence, and the library must be deployed first.
- **Codehash**: `keccak256(eth_getCode)` after deploying through Arachnid's proxy on Anvil. Each deployment is simulated first, and the proxy must return the predicted address.
- **Proxy**: the init-code hash is `keccak256(type(Lattice).creationCode)`, which `checkProxyInitCodeHash` confirms against a deployed factory's `predict`. The standard JSON is pruned from a build-info file that compiled this very creation code, down to the sources the metadata lists, with each source checked against the metadata's hash. `outputSelection` is normalized and settings keys are sorted. An incremental build can leave several such files. They must all prune to byte-identical standard JSON, and then the first one by name is used. Only when they differ, or when none qualifies, run `buildLattice(dir, { clean: true })`; the error names what differs.

- **Compiler**: `ReleaseData.compiler` and `ProxyRelease.compiler` hold the solc version and EVM version from the metadata, which Sourcify needs. Contracts built with different ones are refused. Lattice pins no `evm_version`, so the value is Foundry's default ("osaka" for solc 0.8.36). The real-build test asserts it, because a change there would move every address.
- **Catalog entries**: `toSharedContract(entry, ref)` carries `dependsOn` and `provisional` through. `toLibraryItem(entry, ref)` builds a `Catalog.libraries` item.
- **Building**: `buildLattice` refuses the main checkout's read-only `lattice/`, which is `$STUDIO_MAIN/lattice`, with symlinks resolved. A fresh CI clone that owns its submodule passes `allowMainCheckout: true`.

## Tests

- `addressing.test.ts`: the pure rules.
- `release.test.ts`: hand-assembled contracts on a real Anvil (ordering, constructor arguments, linking, skipping, reuse).
- `real-build.test.ts`: the pinned Lattice on two Anvils with different chain ids. Every prediction must equal the deployment, and both runs must give identical data. solc 0.8.36 must recompile the proxy's standard JSON to its creation code. The test also prints the report: one line per contract with its salt, address and codehash. Several build-info files that compiled the proxy are fine: this was tested with GT1's harness compiled on top, as happens in the merge gate. If they genuinely differ, the test fails with the "build clean" message. Set `CG2_CLEAN_BUILD=1` to let it run `forge clean` and rebuild instead, which takes about 2 minutes.
