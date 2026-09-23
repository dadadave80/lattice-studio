/**
 * The Safe Transaction Builder's batch file model and checksum (safe-wallet-monorepo
 * `apps/tx-builder/src/typings/models.ts` and `src/lib/checksum.ts`), reimplemented so Studio's batch imports
 * without the "checksum doesn't match" warning.
 */
import { keccak256, stringToHex } from "viem";
import type { Hex } from "../../model/hex";

/** One transaction of a batch file. Studio sends raw calldata, which the Builder imports as custom data. */
export type BatchTransaction = {
  to: string;
  /** Wei, as a decimal string. */
  value: string;
  data?: string;
};

/** A batch file's `meta`. The Builder ignores `name` when it computes the checksum. */
export type BatchFileMeta = {
  name: string;
  description?: string;
  txBuilderVersion?: string;
  createdFromSafeAddress?: string;
  createdFromOwnerAddress?: string;
  checksum?: string;
};

/** Transaction Builder 1.0: `chainId` a string, `createdAt` milliseconds, every `value` a string. */
export type BatchFile = {
  version: "1.0";
  chainId: string;
  createdAt: number;
  meta: BatchFileMeta;
  transactions: BatchTransaction[];
};

/** `JSON.stringify` drops `undefined`; the Builder writes it as `null` so a checksum survives the round trip. */
const undefinedAsNull = (_key: string, value: unknown): unknown => (value === undefined ? null : value);

/**
 * The Builder's serializer: an array is its serialized elements joined by commas in brackets; an object is
 * `{` + the JSON of its sorted keys + each value serialized and followed by a comma + `}`; anything else is
 * its JSON, with `undefined` as `null`.
 */
export function serializeForChecksum(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => serializeForChecksum(item)).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${JSON.stringify(keys, undefinedAsNull)}${keys.map((key) => `${serializeForChecksum(record[key])},`).join("")}}`;
  }
  return `${JSON.stringify(value, undefinedAsNull)}`;
}

/**
 * keccak256 of the UTF-8 serialization of the file with `meta.name` set to null, as the Builder computes it.
 * Hashes exactly the object it's given: pass the file without `meta.checksum`.
 */
export function batchChecksum(file: BatchFile): Hex {
  return keccak256(stringToHex(serializeForChecksum({ ...file, meta: { ...file.meta, name: null } })));
}

/** The file with `meta.checksum` computed over everything else. */
export function withChecksum(file: BatchFile): BatchFile {
  const { checksum: _previous, ...meta } = file.meta;
  const bare: BatchFile = { ...file, meta };
  return { ...bare, meta: { ...meta, checksum: batchChecksum(bare) } };
}

/** True when `meta.checksum` equals the checksum of the rest of the file, as the Builder checks on import. */
export function hasValidChecksum(file: BatchFile): boolean {
  const { checksum, ...meta } = file.meta;
  return checksum !== undefined && checksum === batchChecksum({ ...file, meta });
}
