/**
 * CreateX's and Multicall3's real runtime code (vendor/README.md), etched onto a fresh Anvil node. A file whose
 * keccak256 differs from the pinned codehash is refused, so nothing unverified ever reaches a test.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keccak256, type Address, type Hex } from "viem";
import { CREATEX, CREATEX_CODEHASH, MULTICALL3, MULTICALL3_CODEHASH } from "@lattice-studio/core";
import type { Node } from "./node";

export { CREATEX_CODEHASH, MULTICALL3_CODEHASH };

type Vendored = { name: string; address: Address; codehash: Hex; file: string };

const VENDORED: readonly Vendored[] = [
  { name: "CreateX", address: CREATEX, codehash: CREATEX_CODEHASH, file: "CreateX.runtime.hex" },
  { name: "Multicall3", address: MULTICALL3, codehash: MULTICALL3_CODEHASH, file: "Multicall3.runtime.hex" },
];

/** The vendored runtime code, after checking its keccak256 against the pin. */
export function vendoredCode(name: "CreateX" | "Multicall3"): Hex {
  const item = VENDORED.find((v) => v.name === name);
  if (item === undefined) throw new Error(`${name} isn't vendored`);
  const code = readFileSync(join(import.meta.dir, "../vendor", item.file), "utf8").trim() as Hex;
  const hash = keccak256(code);
  if (hash !== item.codehash) throw new Error(`vendor/${item.file} hashes to ${hash}, not ${item.codehash}; refusing to etch it`);
  return code;
}

/** Puts CreateX and Multicall3 at their canonical addresses, then reads the codehash back from the node. */
export async function etchVendored(node: Node): Promise<void> {
  for (const item of VENDORED) {
    const code = vendoredCode(item.name as "CreateX" | "Multicall3");
    await node.client.setCode({ address: item.address, bytecode: code });
    const live = keccak256(await node.rpc<Hex>("eth_getCode", [item.address, "latest"]));
    if (live !== item.codehash) throw new Error(`${item.name} at ${item.address} reads back as ${live}`);
  }
}
