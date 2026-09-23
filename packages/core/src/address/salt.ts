import { toHex } from "viem";
import type { AssertSaltSenderFn, BuildSaltFn, NewEntropyFn } from "../model/api";
import type { Scope } from "../model/chain";
import { isAddress, sameAddress, toChecksum, type Hex } from "../model/hex";
import { err, ok } from "../model/result";
import { assertBytes } from "./bytes";

/** Bytes of entropy a project stores (spec L238, L286). */
export const ENTROPY_BYTES = 11;

/**
 * The flag byte CreateX's `_parseSalt` reads at `salt[20]`: `0x01` turns on cross-chain redeploy protection
 * (this chain only), `0x00` leaves it off (every chain). CreateX reverts `InvalidSalt` for any other value when
 * the first 20 bytes are the sender, so Studio never builds one (spec L239, R15).
 */
export const SCOPE_FLAG: Record<Scope, Hex> = { "every-chain": "0x00", "this-chain": "0x01" };

/**
 * `from ‖ flag ‖ entropy`, 20 + 1 + 11 bytes, lowercase (spec L286, R15). The same layout as Lattice's
 * `CreateXDeployer._guardedSalt` (script/lib/CreateXDeployer.sol L33-L35), with the flag chosen by scope.
 * Diamonds use it on both paths: LatticeFactory folds the sender in again, CreateX guards it.
 */
export const buildSalt: BuildSaltFn = (from, scope, entropy) => {
  if (!isAddress(from)) throw new TypeError(`from must be an address, got ${JSON.stringify(from)}`);
  assertBytes(entropy, ENTROPY_BYTES, "entropy");
  return `${from.toLowerCase()}${SCOPE_FLAG[scope].slice(2)}${entropy.slice(2).toLowerCase()}` as Hex;
};

/**
 * Ok with the salt when `bytes20(salt) == from` and the flag byte is `0x00` or `0x01`, the assertion Studio makes
 * before it asks a wallet to sign (spec L286, L574, L856). Otherwise an error that says which part is wrong.
 */
export const assertSaltSender: AssertSaltSenderFn = (salt, from) => {
  if (!isAddress(from)) return err(`The sending account ${from} isn't an address.`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(salt)) return err(`The salt ${salt} isn't 32 bytes.`);
  const prefix = `0x${salt.slice(2, 42)}`;
  if (!sameAddress(prefix, from)) {
    return err(`The salt starts with ${toChecksum(prefix)}, not the sending account ${toChecksum(from)}.`);
  }
  const flag = salt.slice(42, 44);
  if (flag !== "00" && flag !== "01") return err(`The salt's scope byte is 0x${flag.toLowerCase()}; it must be 0x00 or 0x01.`);
  return ok(salt.toLowerCase() as Hex);
};

/**
 * 11 bytes of fresh entropy from the injected source, lowercase (core has no randomness of its own, spec L102).
 * Throws when the source returns the wrong number of bytes.
 */
export const newEntropy: NewEntropyFn = (random) => {
  const bytes = random(ENTROPY_BYTES);
  if (bytes.length !== ENTROPY_BYTES) {
    throw new TypeError(`random(${ENTROPY_BYTES}) returned ${bytes.length} bytes`);
  }
  return toHex(bytes);
};
