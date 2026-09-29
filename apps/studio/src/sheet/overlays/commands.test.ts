/**
 * The title of `collision.choosePerSelector` (spec L311, batch-2 #35): one selector is SEL-01's "Choose owner…",
 * a set of them is Flow 4's "Choose per selector…". The registry is the only place these words live.
 */
import { describe, expect, test } from "bun:test";
import { getCommand } from "@/contracts";
import "./commands";

const title = (selectors: unknown): string =>
  getCommand("collision.choosePerSelector").title({ selectors } as never);

describe("collision.choosePerSelector's title", () => {
  test("one selector reads Choose owner…", () => {
    expect(title(["0xcdfe7f5c"])).toBe("Choose owner…");
  });

  test("two or more read Choose per selector…", () => {
    expect(title(["0xcdfe7f5c", "0xdc680a0f"])).toBe("Choose per selector…");
    expect(title(["0xcdfe7f5c", "0xdc680a0f", "0x06fdde03"])).toBe("Choose per selector…");
  });

  test("no selector (or a malformed argument) falls back to Choose per selector…", () => {
    expect(title([])).toBe("Choose per selector…");
    expect(title(undefined)).toBe("Choose per selector…");
  });
});
