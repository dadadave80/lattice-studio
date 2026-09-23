import { describe, expect, test } from "bun:test";
import { isAddress, isHex, isHex4, isHex4AnyCase, isHexAnyCase, sameAddress, toChecksum, toLowerHex } from "./hex";
import { err, ok } from "./result";

describe("hex guards", () => {
  test("isHex is lowercase, even-length bytes", () => {
    expect(isHex("0x")).toBe(true);
    expect(isHex("0xa9059cbb")).toBe(true);
    expect(isHex("0xA9059CBB")).toBe(false);
    expect(isHex("0xabc")).toBe(false);
    expect(isHex("a9059cbb")).toBe(false);
    expect(isHex(12)).toBe(false);
    expect(isHexAnyCase("0xA9059CBB")).toBe(true);
    expect(isHexAnyCase("0xabc")).toBe(false);
  });

  test("isHex4 is exactly four bytes", () => {
    expect(isHex4("0x00000000")).toBe(true);
    expect(isHex4("0xa9059cbb")).toBe(true);
    expect(isHex4("0xA9059CBB")).toBe(false);
    expect(isHex4AnyCase("0xA9059CBB")).toBe(true);
    expect(isHex4("0xa9059cbb00")).toBe(false);
  });

  test("addresses: any single case, or mixed case with a valid checksum", () => {
    const checksummed = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
    expect(isAddress(checksummed)).toBe(true);
    expect(isAddress(checksummed.toLowerCase())).toBe(true);
    expect(isAddress("0x4e59b44847b379578588920cA78FbF26c0B4956c")).toBe(false);
    expect(isAddress("0x1234")).toBe(false);
    expect(toChecksum(checksummed.toLowerCase())).toBe(checksummed);
    expect(sameAddress(checksummed, checksummed.toLowerCase())).toBe(true);
    expect(toLowerHex("0xA9059CBB")).toBe("0xa9059cbb");
  });

  test("result constructors", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err("no")).toEqual({ ok: false, error: "no" });
  });
});
