/**
 * Arachnid's proxy reverts with no reason (spec R21), so a failed shared-contract deploy is diagnosed the way the
 * spec says (L75, Flow 12 step 3): check the address for code, then replay the creation with `eth_call`.
 */
import { concat, keccak256, type Address, type Hex } from "viem";
import { ARACHNID_PROXY, arachnidAddress } from "@lattice-studio/core";
import type { Node } from "./node";

export type Diagnosis =
  | { status: "deployed"; address: Address; codehash: Hex }
  | { status: "failed"; address: Address; replay: { ok: boolean; data: Hex } };

export async function diagnoseArachnid(node: Node, salt: Hex, creation: Hex): Promise<Diagnosis> {
  const address = arachnidAddress(salt, keccak256(creation));
  const code = await node.rpc<Hex>("eth_getCode", [address, "latest"]);
  if (code !== "0x") return { status: "deployed", address, codehash: keccak256(code) };
  const replay = await node.call({ to: ARACHNID_PROXY, data: concat([salt, creation]) });
  return { status: "failed", address, replay };
}
