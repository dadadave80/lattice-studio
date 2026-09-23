import { isHexAnyCase } from "../model/hex";

/**
 * Throws when `value` isn't hex of exactly `bytes` bytes (either letter case). A wrong-sized salt or hash is a
 * programmer error here, never user input: the UI builds salts with `buildSalt` and hashes come from the catalog.
 */
export function assertBytes(value: string, bytes: number, label: string): void {
  if (!isHexAnyCase(value) || value.length !== 2 + bytes * 2) {
    throw new TypeError(`${label} must be ${bytes} bytes of hex, got ${JSON.stringify(value)}`);
  }
}
