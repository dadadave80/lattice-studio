import { describe, expect, test } from "bun:test";
import { stepDecimal, toStep } from "./decimal-step";

const UINT256_MAX = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

describe("stepDecimal", () => {
  test("steps integers up and down", () => {
    expect(stepDecimal("41", 1n)).toBe("42");
    expect(stepDecimal("42", -10n)).toBe("32");
  });

  test("keeps the fractional part and its digits", () => {
    expect(stepDecimal("1.5", 1n)).toBe("2.5");
    expect(stepDecimal("1.50", 1n)).toBe("2.50");
    expect(stepDecimal("0.000000001", 1n)).toBe("1.000000001");
  });

  test("keeps the sign right across zero", () => {
    expect(stepDecimal("-0.5", 1n, { signed: true })).toBe("0.5");
    expect(stepDecimal("0.5", -1n, { signed: true })).toBe("-0.5");
    expect(stepDecimal("1", -1n, { signed: true })).toBe("0");
    expect(stepDecimal("-1", 1n, { signed: true })).toBe("0");
  });

  test("stays exact past 2^53", () => {
    const big = (2n ** 53n + 1n).toString();
    expect(stepDecimal(big, 1n)).toBe((2n ** 53n + 2n).toString());
    expect(stepDecimal("1000000000000000000000000.25", 10n)).toBe("1000000000000000000000010.25");
    expect(stepDecimal(UINT256_MAX, -1n)).toBe((2n ** 256n - 2n).toString());
  });

  test("clamps to min and max", () => {
    expect(stepDecimal(UINT256_MAX, 1n, { max: 2n ** 256n - 1n })).toBe(UINT256_MAX);
    expect(stepDecimal("9", 10n, { max: "12" })).toBe("12");
    expect(stepDecimal("3", 1n, { max: "2.5" })).toBe("2.5");
    expect(stepDecimal("5", -10n, { min: "2" })).toBe("2");
  });

  test("unsigned fields stop at 0; signed ones go below", () => {
    expect(stepDecimal("0", -1n)).toBe("0");
    expect(stepDecimal("0.5", -1n)).toBe("0.0");
    expect(stepDecimal("0", -1n, { signed: true })).toBe("-1");
    expect(stepDecimal("0", -10n, { signed: true, min: -5n })).toBe("-5");
  });

  test("an empty field counts as 0", () => {
    expect(stepDecimal("", 1n)).toBe("1");
    expect(stepDecimal("  ", -1n, { signed: true })).toBe("-1");
  });

  test("leaves anything that isn't a plain decimal alone", () => {
    for (const text of ["abc", "1e18", "0x10", "1.", ".5", "1,000", "--1", "1 000"]) {
      expect(stepDecimal(text, 1n)).toBeNull();
    }
  });
});

describe("toStep", () => {
  test("takes bigints and safe integers, nothing else", () => {
    expect(toStep(5n)).toBe(5n);
    expect(toStep(60)).toBe(60n);
    expect(toStep(0.5)).toBeNull();
    expect(toStep(Number.MAX_SAFE_INTEGER + 2)).toBeNull();
    expect(toStep(Number.NaN)).toBeNull();
  });
});
