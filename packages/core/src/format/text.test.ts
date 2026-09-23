import { describe, expect, test } from "bun:test";
import { formatMagnitude, functionName, groupDigits, joinAnd, joinOr, lowerFirst, toSignificant, truncateHex10, truncateHex6, truncateMiddle } from "./text";

describe("joinAnd / joinOr", () => {
  test("0, 1, 2 and 3+ items", () => {
    expect(joinAnd([])).toBe("");
    expect(joinAnd(["A"])).toBe("A");
    expect(joinAnd(["A", "B"])).toBe("A and B");
    expect(joinAnd(["A", "B", "C"])).toBe("A, B and C");
    expect(joinOr(["A", "B"])).toBe("A or B");
    expect(joinOr(["A", "B", "C"])).toBe("A, B or C");
  });
});

describe("truncateMiddle / truncateHex6 / truncateHex10", () => {
  test("6 + 4 and 10 + 4", () => {
    expect(truncateHex6("0x71C7656EC7ab88b098defB751B7401B5f6d8976F")).toBe("0x71C7…976F");
    expect(truncateHex10("0xbd8a7ea8cfca7b4e5f5041d7d3e6f2c8e0f6b53f")).toBe("0xbd8a7ea8…b53f");
  });

  test("leaves short values alone", () => {
    expect(truncateMiddle("0xabcd", 6, 4)).toBe("0xabcd");
  });
});

describe("functionName", () => {
  test("strips the argument list", () => {
    expect(functionName("transfer(address,uint256)")).toBe("transfer");
    expect(functionName("facets()")).toBe("facets");
    expect(functionName("noParens")).toBe("noParens");
  });
});

describe("groupDigits", () => {
  test("0, 1, 2, huge, and negative", () => {
    expect(groupDigits(0)).toBe("0");
    expect(groupDigits(1)).toBe("1");
    expect(groupDigits(2)).toBe("2");
    expect(groupDigits(9_123_456)).toBe("9,123,456");
    expect(groupDigits(123)).toBe("123");
    expect(groupDigits(1234)).toBe("1,234");
    expect(groupDigits(-1234)).toBe("-1,234");
    expect(groupDigits(9_123_460n)).toBe("9,123,460");
    expect(groupDigits("17200000")).toBe("17,200,000");
  });
});

describe("formatMagnitude", () => {
  test("K and M abbreviations, and plain digits below 1,000", () => {
    expect(formatMagnitude(0)).toBe("0");
    expect(formatMagnitude(1)).toBe("1");
    expect(formatMagnitude(950)).toBe("950");
    expect(formatMagnitude(820_000)).toBe("820K");
    expect(formatMagnitude(2_400_000)).toBe("2.4M");
    expect(formatMagnitude(16_777_216)).toBe("16.8M");
    expect(formatMagnitude(17_200_000)).toBe("17.2M");
    expect(formatMagnitude(17_000_000)).toBe("17M");
  });
});

describe("toSignificant", () => {
  test("0, small and huge, 4 significant figures", () => {
    expect(toSignificant(0, 4)).toBe("0");
    expect(toSignificant(0.012, 4)).toBe("0.012");
    expect(toSignificant(0.0123456, 4)).toBe("0.01235");
    expect(toSignificant(1, 4)).toBe("1");
    expect(toSignificant(1234.5678, 4)).toBe("1235");
    expect(toSignificant(9999.5, 4)).toBe("10000");
    expect(toSignificant(1_234_567, 4)).toBe("1235000");
  });
});

describe("lowerFirst", () => {
  test("lowercases only when the second letter is already lowercase", () => {
    expect(lowerFirst("Voting period")).toBe("voting period");
    expect(lowerFirst("ENS name")).toBe("ENS name");
    expect(lowerFirst("Quorum")).toBe("quorum");
    expect(lowerFirst("A")).toBe("a");
  });
});
