import { getContractAddress, keccak256, stringToHex } from "viem";
import type { ArachnidAddressFn, SharedSaltFn } from "../model/api";
import type { Address, Hex } from "../model/hex";
import { assertBytes } from "./bytes";

/**
 * Arachnid's deterministic deployment proxy (spec R21, decision 6): Foundry's default CREATE2 deployer and an
 * OP Stack preinstall. It runs `create2(salt, initcode)` with the caller's salt and nothing else.
 */
export const ARACHNID_PROXY: Address = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

/**
 * `keccak256` of the proxy's runtime code, which S8a compares with `eth_getCode` at `ARACHNID_PROXY`
 * (`ChainState.deployer.codehash`). The test checks it against the proxy Anvil preinstalls.
 */
export const ARACHNID_PROXY_CODEHASH: Hex = "0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989";

/**
 * Shared contracts whose salt carries no version. Mirrors `DeployRelease.s.sol` L93-L97 at the pin:
 * `REGISTRY_SALT = keccak256("lattice.LatticeRegistry")`, `FACTORY_SALT = keccak256("lattice.LatticeFactory")`.
 */
const VERSIONLESS = new Set(["LatticeRegistry", "LatticeFactory"]);

/**
 * The raw CREATE2 salt of a shared contract, passed unhashed to the deployer (spec L150).
 * Facets and inits mirror `DeployRelease.facetSalt` (L237-L238):
 * `keccak256(abi.encodePacked("lattice.", name, ".", version))`. LatticeRegistry and LatticeFactory are
 * versionless whatever `version` says (L93-L97). Any other name without a version throws a TypeError:
 * `"lattice.<name>"` alone is the registry name hash (L204), not a release salt.
 */
export const sharedSalt: SharedSaltFn = (name, version) => {
  if (VERSIONLESS.has(name)) return keccak256(stringToHex(`lattice.${name}`));
  if (version === undefined || version === "") {
    throw new TypeError(`${name} needs a version: only LatticeRegistry and LatticeFactory have versionless salts`);
  }
  return keccak256(stringToHex(`lattice.${name}.${version}`));
};

/**
 * CREATE2(`ARACHNID_PROXY`, salt, initCodeHash), checksummed: `keccak256(0xff ‖ proxy ‖ salt ‖ initCodeHash)[12:]`.
 * The proxy passes the caller's salt straight to `create2` (spec R21), so this is plain EIP-1014 with the proxy as
 * the creator: the same on every chain, and committed to the bytecode.
 */
export const arachnidAddress: ArachnidAddressFn = (salt, initCodeHash) => {
  assertBytes(salt, 32, "salt");
  assertBytes(initCodeHash, 32, "initCodeHash");
  return getContractAddress({ opcode: "CREATE2", from: ARACHNID_PROXY, salt, bytecodeHash: initCodeHash });
};
