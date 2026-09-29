import { describe, expect, test } from "bun:test";
import { shortHash } from "./format";

describe("shortHash", () => {
  test("6 + 4 for a hash, whole for anything shorter", () => {
    expect(shortHash(`0x3f2a${"0".repeat(56)}a1c4`)).toBe("0x3f2a…a1c4");
    expect(shortHash(`0x${"ab".repeat(32)}`)).toBe("0xabab…abab");
    expect(shortHash("0x1234abcd")).toBe("0x1234abcd");
  });
});
