import type { Address, Hex, Hex4 } from "../model/hex";
import { toChecksum } from "../model/hex";

/** Deterministic lowercase hex of `bytes` bytes holding `n`: `hex(1)` is 32 bytes ending in 01. */
export function hex(n: number | bigint, bytes = 32): Hex {
  const digits = BigInt(n).toString(16);
  if (digits.length > bytes * 2) throw new RangeError(`${n} doesn't fit in ${bytes} bytes`);
  return `0x${digits.padStart(bytes * 2, "0")}`;
}

/** Deterministic EIP-55 address holding `n`: `addr(1)` is 0x0000…0001. */
export function addr(n: number | bigint): Address {
  return toChecksum(hex(n, 20));
}

/** Deterministic 4-byte selector holding `n`. */
export function sel(n: number | bigint): Hex4 {
  return hex(n, 4);
}
