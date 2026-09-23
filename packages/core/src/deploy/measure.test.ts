import { describe, expect, test } from "bun:test";
import { keccak256 } from "viem";
import { calldataHash, gasShare } from "./measure";

describe("calldataHash", () => {
  test("is keccak256 of the calldata, whatever its letter case", () => {
    expect(calldataHash("0x533677de")).toBe(keccak256("0x533677de"));
    expect(calldataHash("0xABCDEF")).toBe(keccak256("0xabcdef"));
    expect(calldataHash("0x")).toBe("0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  });

  test("throws for anything that isn't hex bytes", () => {
    expect(() => calldataHash("0x123")).toThrow(TypeError);
    expect(() => calldataHash("0xzz")).toThrow(TypeError);
  });
});

describe("gasShare", () => {
  const CAP = 16_777_216n; // EIP-7825

  test("ok below 80%, warning from 80% up to the cap itself, over above it", () => {
    expect(gasShare(1_000_000n, CAP).level).toBe("ok");
    expect(gasShare((CAP * 8n) / 10n - 1n, CAP).level).toBe("ok");
    expect(gasShare(8n, 10n)).toEqual({ share: 0.8, level: "warning" });
    expect(gasShare(CAP, CAP)).toEqual({ share: 1, level: "warning" });
    expect(gasShare(CAP + 1n, CAP).level).toBe("over");
    expect(gasShare(17_200_000n, 16_800_000n)).toEqual({ share: 1.0238, level: "over" });
  });

  test("share stays exact to four places for values past Number's safe range", () => {
    expect(gasShare(2n ** 80n, 2n ** 81n).share).toBe(0.5);
    expect(gasShare(0n, CAP)).toEqual({ share: 0, level: "ok" });
  });

  test("a cap of zero or a negative estimate is a programmer error", () => {
    expect(() => gasShare(1n, 0n)).toThrow(RangeError);
    expect(() => gasShare(-1n, CAP)).toThrow(RangeError);
  });
});
