import { describe, expect, test } from "bun:test";
import { bestUnit, durationEcho, durationWords, fromSeconds, toSeconds } from "./duration";

describe("duration fields (spec L463)", () => {
  test("stored in seconds from a number and a unit", () => {
    expect(toSeconds("5", "minutes")).toBe("300");
    expect(toSeconds("1.5", "hours")).toBe("5400");
    expect(toSeconds("2", "days")).toBe("172800");
    expect(toSeconds(" 600 ", "seconds")).toBe("600");
    expect(toSeconds("0.5", "seconds")).toBeNull();
    expect(toSeconds("-1", "minutes")).toBeNull();
    expect(toSeconds("five", "minutes")).toBeNull();
  });

  test("keeps every digit of a uint256", () => {
    const huge = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    expect(toSeconds(huge, "seconds")).toBe(huge);
  });

  test("shows a stored value in the unit that reads best", () => {
    expect(bestUnit("300")).toEqual({ amount: "5", unit: "minutes" });
    expect(bestUnit("86400")).toEqual({ amount: "1", unit: "days" });
    expect(bestUnit("90")).toEqual({ amount: "90", unit: "seconds" });
    expect(bestUnit("0")).toEqual({ amount: "0", unit: "seconds" });
    expect(bestUnit("abc")).toEqual({ amount: "abc", unit: "seconds" });
  });

  test("converts back exactly, or not at all", () => {
    expect(fromSeconds("90", "minutes")).toBe("1.5");
    expect(fromSeconds("300", "minutes")).toBe("5");
    expect(fromSeconds("100", "minutes")).toBeNull();
    expect(fromSeconds("x", "minutes")).toBeNull();
  });

  test("echoes \"= 5 minutes\"", () => {
    expect(durationEcho("300", "seconds")).toBe("= 5 minutes");
    expect(durationEcho("300", "minutes")).toBe("= 300 s");
    expect(durationEcho("60", "seconds")).toBe("= 1 minute");
    expect(durationEcho(null, "seconds")).toBeNull();
    expect(durationWords("172800")).toBe("2 days");
  });
});
