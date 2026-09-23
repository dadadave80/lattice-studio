import { describe, expect, test } from "bun:test";
import { findPinnedRunners, isLockfilePinned } from "./workflow-lockfile-check.ts";

describe("findPinnedRunners", () => {
  test("finds no pin in an unversioned bun x call", () => {
    expect(findPinnedRunners("bun x lhci autorun --config=x.json")).toEqual([]);
  });

  test("finds a scoped package pin after 'bun x'", () => {
    expect(findPinnedRunners("bun x @lhci/cli@0.13.0 autorun")).toEqual([{ pkg: "@lhci/cli", version: "0.13.0" }]);
  });

  test("finds an unscoped package pin after 'bunx'", () => {
    expect(findPinnedRunners("bunx playwright@1.63.0 install")).toEqual([{ pkg: "playwright", version: "1.63.0" }]);
  });

  test("finds a pin after 'npx'", () => {
    expect(findPinnedRunners("npx some-tool@2.0.0")).toEqual([{ pkg: "some-tool", version: "2.0.0" }]);
  });

  test("a multi-line command is scanned in full", () => {
    const command = "git fetch origin dev\nbun x @lhci/cli@0.13.0 autorun\necho done";
    expect(findPinnedRunners(command)).toEqual([{ pkg: "@lhci/cli", version: "0.13.0" }]);
  });

  test("an unrelated 'x' word never matches", () => {
    expect(findPinnedRunners("echo box@1.0.0")).toEqual([]);
  });
});

describe("isLockfilePinned", () => {
  const bunLock = `{
    "packages": {
      "@lhci/cli": ["@lhci/cli@0.15.1", "", {}, "sha512-..."],
    }
  }`;

  test("a version bun.lock resolved is pinned", () => {
    expect(isLockfilePinned({ pkg: "@lhci/cli", version: "0.15.1" }, bunLock)).toBe(true);
  });

  test("a different version is not pinned", () => {
    expect(isLockfilePinned({ pkg: "@lhci/cli", version: "0.13.0" }, bunLock)).toBe(false);
  });

  test("a package not in the lockfile is not pinned", () => {
    expect(isLockfilePinned({ pkg: "left-pad", version: "1.0.0" }, bunLock)).toBe(false);
  });
});
