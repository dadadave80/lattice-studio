import { isAddress, isHexAnyCase, sameAddress, toChecksum, type Address } from "../../model/hex";
import type { TxRequest } from "../../model/chain";
import type { ExportFile } from "../../model/io";
import { err, ok, type Result } from "../../model/result";
import { withChecksum, type BatchFile } from "./checksum";
import { plainText, SAFE_BATCH_MIME } from "./safe";

export type SafeCallArgs = { safe: Address; chainId: number; tx: TxRequest; now: number; studioVersion: string; label?: string };

/** A Builder Call proposal for exactly this contract call. Exporting does not execute or change chain facts. */
export function exportSafeCall(args: SafeCallArgs): Result<ExportFile, string> {
  const zero = "0x0000000000000000000000000000000000000000";
  if (!isAddress(args.safe) || sameAddress(args.safe, zero)) return err("Enter a valid, nonzero Safe address.");
  if (!Number.isSafeInteger(args.chainId) || args.chainId <= 0) return err("Enter a positive chain id.");
  if (!isAddress(args.tx.to) || sameAddress(args.tx.to, zero) || !isHexAnyCase(args.tx.data)) return err("Enter a valid call target and calldata.");
  if (typeof args.tx.value !== "bigint" || args.tx.value < 0n || args.tx.value >= 1n << 256n) return err("Enter a call value in wei between 0 and 2²⁵⁶ − 1.");
  if (!Number.isSafeInteger(args.now) || args.now < 0) return err("Enter a valid creation time in milliseconds.");
  const safe = toChecksum(args.safe);
  const to = toChecksum(args.tx.to);
  const label = plainText(args.label ?? "Contract call", "Contract call", 80);
  const file = withChecksum({
    version: "1.0", chainId: String(args.chainId), createdAt: args.now,
    meta: {
      name: `${label} · Safe ${safe} · chain ${args.chainId}`,
      description: `Lattice Studio ${plainText(args.studioVersion, "unknown")}\nCall proposal from Safe ${safe} to ${to} on chain ${args.chainId}, with value ${args.tx.value} wei and the exact calldata below. Downloading this file does not execute the call. Import it only into this Safe on this chain.`,
      createdFromSafeAddress: safe, createdFromOwnerAddress: "",
    },
    // Builder raw transaction entries execute as Call; its file model has no DelegateCall operation field.
    transactions: [{ to, value: args.tx.value.toString(), data: args.tx.data }],
  } satisfies BatchFile);
  return ok({ filename: `call-${args.chainId}-${to.toLowerCase()}.safe.json`, mime: SAFE_BATCH_MIME, text: `${JSON.stringify(file, null, 2)}\n` });
}
