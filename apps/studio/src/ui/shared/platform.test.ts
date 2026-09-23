import { describe, expect, test } from "bun:test";
import { detectPlatform } from "./platform";

describe("detectPlatform", () => {
  test("macOS and iOS keyboards carry ⌘", () => {
    expect(detectPlatform({ platform: "MacIntel" })).toBe("mac");
    expect(detectPlatform({ userAgentData: { platform: "macOS" } })).toBe("mac");
    expect(detectPlatform({ platform: "iPad" })).toBe("mac");
  });

  test("Windows, Linux and unknown read Ctrl", () => {
    expect(detectPlatform({ platform: "Win32" })).toBe("other");
    expect(detectPlatform({ userAgentData: { platform: "Linux" } })).toBe("other");
    expect(detectPlatform({})).toBe("other");
    expect(detectPlatform(undefined)).toBe("other");
  });
});
