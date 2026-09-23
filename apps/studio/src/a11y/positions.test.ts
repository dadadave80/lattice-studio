import { describe, expect, test } from "bun:test";
import type { Layout } from "@lattice-studio/core";
import { matchesKey, type KeyInput } from "./keys";
import { describeMove, nextAfterDelete, positionInWords, readingOrder, restoredCard } from "./positions";

function at(x: number, y: number): Layout[string] {
  return { x, y, pins: "right" };
}

const GRID: Layout = {
  // Row 1 (tops within a header's height of each other), then row 2.
  Vault: at(640, 8),
  ERC20: at(0, 0),
  ERC4626: at(320, 24),
  Pausable: at(0, 400),
  Ownable: at(320, 400),
};

describe("readingOrder", () => {
  test("rows top to bottom, each left to right, with drifted tops in one row", () => {
    expect(readingOrder(GRID)).toEqual(["ERC20", "ERC4626", "Vault", "Pausable", "Ownable"]);
  });

  test("ties break by name, and an empty sheet has no order", () => {
    expect(readingOrder({ B: at(0, 0), A: at(0, 0) })).toEqual(["A", "B"]);
    expect(readingOrder({})).toEqual([]);
  });
});

describe("nextAfterDelete", () => {
  const order = readingOrder(GRID);

  test("the next card in reading order", () => {
    expect(nextAfterDelete(["ERC4626"], order)).toBe("Vault");
    expect(nextAfterDelete(["ERC4626", "Vault"], order)).toBe("Pausable");
  });

  test("else the previous one", () => {
    expect(nextAfterDelete(["Ownable"], order)).toBe("Pausable");
    expect(nextAfterDelete(["Pausable", "Ownable"], order)).toBe("Vault");
  });

  test("else nothing: focus goes to the sheet", () => {
    expect(nextAfterDelete(order, order)).toBeNull();
    expect(nextAfterDelete(["Missing"], order)).toBeNull();
  });
});

describe("restoredCard", () => {
  test("a card that came back, else one that moved, else none", () => {
    const { ERC4626: _gone, ...without } = GRID;
    expect(restoredCard(without, GRID)).toBe("ERC4626");
    expect(restoredCard(GRID, { ...GRID, Ownable: at(360, 400) })).toBe("Ownable");
    expect(restoredCard(GRID, { ...GRID, ERC20: { ...at(0, 0), pins: "left" } })).toBe("ERC20");
    expect(restoredCard(GRID, GRID)).toBeNull();
    expect(restoredCard(GRID, without)).toBeNull();
  });
});

describe("positions in words", () => {
  test("beside, above and below the nearest card", () => {
    expect(positionInWords("ERC20", GRID)).toBe("beside ERC4626");
    expect(positionInWords("Pausable", { ...GRID, Pausable: at(0, 100) })).toBe("below ERC20");
    expect(positionInWords("ERC20", { ERC20: at(0, 0), Vault: at(0, 300) })).toBe("above Vault");
    expect(positionInWords("ERC20", { ERC20: at(0, 0) })).toBeNull();
    expect(positionInWords("Missing", GRID)).toBeNull();
  });

  test("a nudge reads as a direction and a place, never pixels", () => {
    const layout: Layout = { ERC20: at(248, 0), ERC4626: at(320, 0), Vault: at(0, 600) };
    expect(describeMove(["ERC20"], "right", layout)).toBe("Moved ERC20 right, beside ERC4626");
    expect(describeMove(["ERC20"], "up", { ERC20: at(0, 0) })).toBe("Moved ERC20 up");
    expect(describeMove(["ERC20", "ERC4626"], "down", layout)).toBe("Moved 2 cards down, above Vault");
  });
});

describe("matchesKey", () => {
  const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({
    key: k, code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods,
  });

  test("F6, ⇧F6, and Ctrl+F6 only on Windows and Linux", () => {
    expect(matchesKey("F6", key("F6"), "mac")).toBe(true);
    expect(matchesKey("F6", key("F6", { shiftKey: true }), "mac")).toBe(false);
    expect(matchesKey("Shift+F6", key("F6", { shiftKey: true }), "mac")).toBe(true);
    const ctrl = { keys: "Ctrl+F6", platform: "other" } as const;
    expect(matchesKey(ctrl, key("F6", { ctrlKey: true }), "other")).toBe(true);
    expect(matchesKey(ctrl, key("F6", { ctrlKey: true }), "mac")).toBe(false);
    expect(matchesKey("F6", key("F6", { ctrlKey: true }), "other")).toBe(false);
  });

  test("Mod, typed characters and physical codes", () => {
    expect(matchesKey("Mod+k", key("K", { metaKey: true }), "mac")).toBe(true);
    expect(matchesKey("Mod+k", key("k", { ctrlKey: true }), "other")).toBe(true);
    expect(matchesKey("?", key("?", { shiftKey: true }), "mac")).toBe(true);
    expect(matchesKey("Shift+[Digit0]", { ...key("="), code: "Digit0", shiftKey: true }, "other")).toBe(true);
    expect(matchesKey("Mod++", key("+", { metaKey: true }), "mac")).toBe(true);
    expect(matchesKey("Hyper+x", key("x"), "mac")).toBe(false);
  });
});
