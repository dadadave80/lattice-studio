import { describe, expect, test } from "bun:test";
import type { Hex } from "../../model/hex";
import { exportSafeCall, type SafeCallArgs } from "./call";
import { hasValidChecksum, type BatchFile } from "./checksum";

const SAFE = "0x00000000000000000000000000000000000000bb";
const TO = "0x00000000000000000000000000000000000000aa";
const args = (): SafeCallArgs => ({ safe: SAFE, chainId: 11155111, tx: { to: TO, value: 123456789012345678901234567890n, data: "0x12345678abcdef" as Hex }, now: 0, studioVersion: "test", label: "Transfer token" });

describe("generic Safe Call batch", () => {
  test("contains one exact target/value/calldata Call with a valid Builder checksum", () => {
    const exported = exportSafeCall(args());
    expect(exported.ok).toBe(true);
    if (!exported.ok) throw new Error(exported.error);
    const file = JSON.parse(exported.value.text) as BatchFile;
    expect(file.transactions).toEqual([{ to: "0x00000000000000000000000000000000000000AA", value: "123456789012345678901234567890", data: "0x12345678abcdef" }]);
    expect(file.meta.createdFromSafeAddress).toBe(SAFE);
    expect(file.chainId).toBe("11155111");
    expect(hasValidChecksum(file)).toBe(true);
    expect(file.meta.description).toContain("Call");
    expect(file.meta.description).toContain("proposal");
    expect(file.meta.description).toContain("does not execute");
    expect(exported.value.text.endsWith("\n")).toBe(true);
    expect(exportSafeCall(args())).toEqual(exported);
  });

  test.each([
    { ...args(), safe: "0x0000000000000000000000000000000000000000" },
    { ...args(), chainId: -1 },
    { ...args(), now: -1 },
    { ...args(), tx: { ...args().tx, value: -1n } },
    { ...args(), tx: { ...args().tx, value: 1n << 256n } },
    { ...args(), tx: { ...args().tx, data: "0x123" as Hex } },
  ] satisfies SafeCallArgs[])("refuses invalid call arguments", (input) => {
    expect(exportSafeCall(input).ok).toBe(false);
  });
});
