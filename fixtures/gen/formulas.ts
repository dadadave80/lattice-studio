/**
 * The formulas the fixture's invented release data follows, shared by the generator and the test so both
 * compute them one way. Real formulas, fake inputs: the init code is the text `fixture:<Name>`.
 */
import { encodeAbiParameters, encodePacked, getContractAddress, keccak256, stringToBytes, toHex } from "viem";
import type { Address, Hex } from "../../packages/core/src/model/hex.ts";

/** Arachnid's deterministic deployment proxy (spec L144, R21). */
export const ARACHNID: Address = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

/** Facet and init salt: `keccak256(abi.encodePacked("lattice.", name, ".", version))` (FacetInventory.sol L12-L14). */
export function releaseSalt(name: string, version: string): Hex {
  return keccak256(encodePacked(["string", "string", "string", "string"], ["lattice.", name, ".", version]));
}

/** LatticeRegistry's and LatticeFactory's versionless salt: `keccak256("lattice.<Name>")` (DeployRelease). */
export function versionlessSalt(name: string): Hex {
  return keccak256(stringToBytes(`lattice.${name}`));
}

/** The fixture's fake creation code for a shared contract: the UTF-8 bytes of `fixture:<Name>`. */
export function fakeCreationCode(name: string, prefix = "fixture"): Hex {
  return toHex(stringToBytes(`${prefix}:${name}`));
}

/** The fixture's fake runtime codehash: keccak256 of `fixture:<Name>:runtime`. */
export function fakeCodehash(name: string, prefix = "fixture"): Hex {
  return keccak256(stringToBytes(`${prefix}:${name}:runtime`));
}

/** CREATE2 through Arachnid's proxy: `keccak256(0xff ‖ proxy ‖ salt ‖ initCodeHash)[12:]`, EIP-55. */
export function create2Address(salt: Hex, initCodeHash: Hex): Address {
  return getContractAddress({ opcode: "CREATE2", from: ARACHNID, salt, bytecodeHash: initCodeHash });
}

/** ERC-7201: `keccak256(abi.encode(uint256(keccak256(id)) - 1)) & ~0xff` (R13). */
export function erc7201Slot(id: string): Hex {
  const inner = BigInt(keccak256(stringToBytes(id))) - 1n;
  const outer = BigInt(keccak256(encodeAbiParameters([{ type: "uint256" }], [inner])));
  return toHex(outer & ~0xffn, { size: 32 });
}

/**
 * Canonical JSON for the catalog hash: keys sorted by UTF-16 code units, no whitespace. The fixture holds only
 * strings, safe integers, booleans, arrays and objects, where this equals RFC 8785.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** `Catalog.hash`: keccak256 of the canonical index without its `hash` field (C1's `catalogHash`). */
export function indexHash(index: Record<string, unknown>): Hex {
  const { hash: _omitted, ...rest } = index;
  return keccak256(stringToBytes(canonicalJson(rest)));
}

/** A ShardRef's hash: keccak256 of the file's bytes. */
export function fileHash(bytes: Uint8Array): Hex {
  return keccak256(bytes);
}
