import { describe, expect, test } from "bun:test";
import {
  allSelectable, expandableSiblings, flattenVisible, navigate, parentIds, rangeIds, scrollToReveal, tabbableIndex,
  toggleId, typeAheadIndex, windowRange, type TreeNode,
} from "./tree-model";

const nodes: TreeNode[] = [
  {
    id: "vault", label: "GovernedVault", children: [
      { id: "vault.transfer", label: "transfer(address,uint256)" },
      { id: "vault.approve", label: "approve(address,uint256)" },
    ],
  },
  {
    id: "erc20", label: "ERC20", children: [
      { id: "erc20.totalSupply", label: "totalSupply()", disabledReason: "Served by GovernedVault" },
      { id: "erc20.balanceOf", label: "balanceOf(address)" },
    ],
  },
  { id: "erc4626", label: "ERC4626", children: [{ id: "erc4626.asset", label: "asset()" }] },
  { id: "pause", label: "Pausable" },
];

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

describe("flattenVisible", () => {
  test("shows roots and the children of expanded parents, with level, set size and position", () => {
    const rows = flattenVisible(nodes, new Set(["erc20"]));
    expect(ids(rows)).toEqual(["vault", "erc20", "erc20.totalSupply", "erc20.balanceOf", "erc4626", "pause"]);
    const child = rows[3];
    expect(child).toMatchObject({ level: 2, parentId: "erc20", setSize: 2, posInSet: 2, hasChildren: false });
    expect(rows[1]).toMatchObject({ level: 1, setSize: 4, posInSet: 2, hasChildren: true, expanded: true });
    expect(rows[0]).toMatchObject({ expanded: false });
  });

  test("lists every parent", () => {
    expect(parentIds(nodes)).toEqual(["vault", "erc20", "erc4626"]);
  });
});

describe("navigate", () => {
  const rows = flattenVisible(nodes, new Set(["vault"]));
  test("↓ ↑ Home End move among visible rows and stop at the ends", () => {
    expect(navigate(rows, 0, "ArrowDown")).toEqual({ kind: "focus", index: 1 });
    expect(navigate(rows, 0, "ArrowUp")).toEqual({ kind: "none" });
    expect(navigate(rows, rows.length - 1, "ArrowDown")).toEqual({ kind: "none" });
    expect(navigate(rows, 2, "Home")).toEqual({ kind: "focus", index: 0 });
    expect(navigate(rows, 0, "End")).toEqual({ kind: "focus", index: rows.length - 1 });
  });

  test("→ opens a closed parent, enters an open one and does nothing on a leaf", () => {
    expect(navigate(rows, 3, "ArrowRight")).toEqual({ kind: "expand", id: "erc20" });
    expect(navigate(rows, 0, "ArrowRight")).toEqual({ kind: "focus", index: 1 });
    expect(navigate(rows, 1, "ArrowRight")).toEqual({ kind: "none" });
  });

  test("← closes an open parent, else goes to the parent, else does nothing", () => {
    expect(navigate(rows, 0, "ArrowLeft")).toEqual({ kind: "collapse", id: "vault" });
    expect(navigate(rows, 2, "ArrowLeft")).toEqual({ kind: "focus", index: 0 });
    expect(navigate(rows, 3, "ArrowLeft")).toEqual({ kind: "none" });
  });

  test("other keys aren't navigation", () => {
    expect(navigate(rows, 0, "a")).toBeNull();
  });
});

describe("tabbableIndex", () => {
  const rows = flattenVisible(nodes, new Set(["vault"]));
  test("prefers the focused row, then the first selected, then the first", () => {
    expect(tabbableIndex(rows, "vault.approve", ["erc20"])).toBe(2);
    expect(tabbableIndex(rows, "erc20.balanceOf", ["erc4626", "erc20"])).toBe(3);
    expect(tabbableIndex(rows, null, [])).toBe(0);
    expect(tabbableIndex([], null, [])).toBe(-1);
  });
});

describe("expandableSiblings", () => {
  test("names the parents at the focused row's level under the same parent", () => {
    const rows = flattenVisible(nodes, new Set());
    expect(expandableSiblings(rows, 3)).toEqual(["vault", "erc20", "erc4626"]);
  });
});

describe("typeAheadIndex", () => {
  const rows = flattenVisible(nodes, new Set());
  // vault(GovernedVault) erc20(ERC20) erc4626(ERC4626) pause(Pausable)
  test("finds the next label starting with the typed text, wrapping", () => {
    expect(typeAheadIndex(rows, 0, "p")).toBe(3);
    expect(typeAheadIndex(rows, 3, "g")).toBe(0);
    expect(typeAheadIndex(rows, 0, "x")).toBe(-1);
  });

  test("a longer buffer narrows and keeps the current row when it still matches", () => {
    expect(typeAheadIndex(rows, 0, "e")).toBe(1);
    expect(typeAheadIndex(rows, 1, "erc4")).toBe(2);
    expect(typeAheadIndex(rows, 1, "erc2")).toBe(1);
  });

  test("one character typed again cycles", () => {
    expect(typeAheadIndex(rows, 1, "ee")).toBe(2);
    expect(typeAheadIndex(rows, 2, "eee")).toBe(1);
  });
});

describe("selection helpers", () => {
  const rows = flattenVisible(nodes, new Set(["erc20"]));
  test("a range skips disabled rows and works in either direction", () => {
    expect(rangeIds(rows, 3, 1)).toEqual(["erc20", "erc20.balanceOf"]);
    expect(allSelectable(rows)).not.toContain("erc20.totalSupply");
  });

  test("toggleId adds and removes", () => {
    expect(toggleId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleId(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("windowRange and scrollToReveal", () => {
  test("renders the rows in view plus overscan, clamped", () => {
    expect(windowRange(0, 280, 28, 1000, 5)).toEqual({ start: 0, end: 15 });
    expect(windowRange(28 * 500, 280, 28, 1000, 5)).toEqual({ start: 495, end: 515 });
    expect(windowRange(28 * 995, 280, 28, 1000, 5)).toEqual({ start: 990, end: 1000 });
    expect(windowRange(0, 0, 28, 1000, 0)).toEqual({ start: 0, end: 20 });
    expect(windowRange(0, 280, 28, 0)).toEqual({ start: 0, end: 0 });
  });

  test("scrolls the least that reveals a row", () => {
    expect(scrollToReveal(0, 280, 28, 5)).toBe(0);
    expect(scrollToReveal(0, 280, 28, 999)).toBe(28 * 1000 - 280);
    expect(scrollToReveal(28 * 500, 280, 28, 10)).toBe(280);
  });
});
