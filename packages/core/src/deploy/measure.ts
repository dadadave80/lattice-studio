import { keccak256 } from "viem";
import type { CalldataHashFn, GasShareFn } from "../model/api";
import type { Hex } from "../model/hex";

/**
 * keccak256 of the calldata, lowercase, for comparison with a wallet's data view (spec L573). Throws a TypeError
 * for anything that isn't hex bytes: the caller hashes calldata it just built.
 */
export const calldataHash: CalldataHashFn = (data) => {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(data)) throw new TypeError(`calldata must be hex bytes, got ${JSON.stringify(data)}`);
  return keccak256(data.toLowerCase() as Hex);
};

/**
 * The estimate against the chain's per-transaction cap (R16, NET-06): `share` is gas / cap to four decimal places
 * (rounded down), `level` is "over" above the cap, "warning" from 80% up to and including the cap (EIP-7825 allows
 * exactly the cap), else "ok". Callers must pass a positive cap (`ChainState.gasCap`, parsed) and a non-negative
 * estimate: the frozen type returns `GasShare`, not a `Result`, so anything else throws a RangeError. Without a
 * known cap, don't call it.
 */
export const gasShare: GasShareFn = (gas, cap) => {
  if (cap <= 0n) throw new RangeError(`the gas cap must be positive, got ${cap}`);
  if (gas < 0n) throw new RangeError(`the gas estimate can't be negative, got ${gas}`);
  const share = Number((gas * 10_000n) / cap) / 10_000;
  const level = gas > cap ? "over" : gas * 10n >= cap * 8n ? "warning" : "ok";
  return { share, level };
};
