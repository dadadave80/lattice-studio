import { getAddress, isAddress as viemIsAddress } from "viem";

/**
 * Hex types (contracts §3.1). Structural, never branded, so plain literals typecheck.
 * Stored and hashed hex is lowercase; parsing accepts either case and C1's `normalizeRecipe` lowercases.
 */
export type Hex = `0x${string}`;
/** Exactly 4 bytes, lowercase: a function selector such as `0xa9059cbb`. */
export type Hex4 = Hex;
/** 20 bytes. EIP-55 checksummed in stored JSON; compare case-insensitively (`sameAddress`). */
export type Address = Hex;

const HEX = /^0x(?:[0-9a-f]{2})*$/;
const HEX_ANY_CASE = /^0x(?:[0-9a-fA-F]{2})*$/;
const HEX4 = /^0x[0-9a-f]{8}$/;
const HEX4_ANY_CASE = /^0x[0-9a-fA-F]{8}$/;

/** Lowercase hex bytes: `0x` then pairs of lowercase hex digits (`0x` alone is empty bytes). */
export function isHex(value: unknown): value is Hex {
  return typeof value === "string" && HEX.test(value);
}

/** Hex bytes in any letter case, as files and links may carry them before normalization. */
export function isHexAnyCase(value: unknown): value is Hex {
  return typeof value === "string" && HEX_ANY_CASE.test(value);
}

/** A lowercase 4-byte selector. */
export function isHex4(value: unknown): value is Hex4 {
  return typeof value === "string" && HEX4.test(value);
}

/** A 4-byte selector in any letter case. */
export function isHex4AnyCase(value: unknown): value is Hex4 {
  return typeof value === "string" && HEX4_ANY_CASE.test(value);
}

/**
 * A 20-byte address: all lowercase, all uppercase, or mixed case with a valid EIP-55 checksum.
 */
export function isAddress(value: unknown): value is Address {
  return typeof value === "string" && viemIsAddress(value, { strict: true });
}

/**
 * The EIP-55 checksummed form (via viem). Call `isAddress` first: an invalid address is a programmer
 * error here and throws.
 */
export function toChecksum(address: string): Address {
  return getAddress(address);
}

/** Lowercases hex (selectors, hashes, data). */
export function toLowerHex<T extends Hex>(value: T): T {
  return value.toLowerCase() as T;
}

/** Case-insensitive address comparison. */
export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
