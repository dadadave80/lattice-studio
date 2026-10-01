import { describe, expect, test } from "bun:test";
import { etherscanKeyFrom } from "./key";

describe("etherscanKeyFrom", () => {
  test("the Settings value wins over the build's", () => {
    expect(etherscanKeyFrom("mine", "builds")).toBe("mine");
  });

  test("an empty Settings value falls back to the build's", () => {
    expect(etherscanKeyFrom("", "builds")).toBe("builds");
    expect(etherscanKeyFrom("   ", "builds")).toBe("builds");
  });

  test("both are trimmed, so a trailing newline in a build variable isn't sent", () => {
    expect(etherscanKeyFrom(" mine \n", undefined)).toBe("mine");
    expect(etherscanKeyFrom("", "builds\n")).toBe("builds");
  });

  test("with neither, Etherscan verification isn't set up", () => {
    expect(etherscanKeyFrom("", undefined)).toBeUndefined();
    expect(etherscanKeyFrom("", "  ")).toBeUndefined();
  });
});
