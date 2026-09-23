/**
 * What kind of account is connected (spec L564: account, EIP-7702 account, smart account, Safe) and its balance.
 * The kind decides how the review words the Deployer section and whether the deploy goes out as a Safe batch.
 */
import type { Address, Hex } from "@lattice-studio/core";
import { parseAbi } from "viem";
import { getBalance, getCode, readContract } from "viem/actions";
import type { AccountKind } from "@/contracts";
import type { ChainClient } from "./clients";
import { isTransportFailure } from "./probe";

/** An EIP-7702 delegation designator: 0xef0100 ‖ 20-byte address (EIP-7702 "Delegation designation"). */
export function isDelegation(code: Hex): boolean {
  return /^0xef0100[0-9a-f]{40}$/i.test(code);
}

const SAFE_ABI = parseAbi(["function getThreshold() view returns (uint256)", "function getOwners() view returns (address[])"]);

/** A Safe answers `getThreshold()` with at least 1 and `getOwners()` with a list (Safe 1.x, any version). */
async function isSafe(client: ChainClient, address: Address): Promise<boolean> {
  try {
    const [threshold, owners] = await Promise.all([
      readContract(client, { address, abi: SAFE_ABI, functionName: "getThreshold" }),
      readContract(client, { address, abi: SAFE_ABI, functionName: "getOwners" }),
    ]);
    return threshold > 0n && owners.length > 0;
  } catch (error) {
    if (isTransportFailure(error)) throw error;
    return false;
  }
}

/**
 * No code: an account (EOA). A delegation designator: an EIP-7702 account. Other code: a Safe when it answers
 * like one, else a smart account.
 */
export async function accountKind(client: ChainClient, address: Address): Promise<AccountKind> {
  const code = await getCode(client, { address });
  if (code === undefined || code === "0x") return "eoa";
  if (isDelegation(code)) return "delegated";
  return (await isSafe(client, address)) ? "safe" : "smart";
}

/** Balance in wei. */
export function accountBalance(client: ChainClient, address: Address): Promise<bigint> {
  return getBalance(client, { address });
}
