import { describe, expect, test } from "bun:test";
import { isOwnKind, resolveView, SEAM_OWNERS, selectionView } from "./resolve-view";

const placed = ["ERC20", "ERC4626", "VaultCore"];

describe("selectionView", () => {
  test("nothing selected shows the diamond", () => {
    expect(selectionView([], placed)).toEqual({ kind: "diamond" });
  });
  test("one card shows its facet", () => {
    expect(selectionView(["ERC20"], placed)).toEqual({ kind: "facet", facet: "ERC20" });
  });
  test("several cards show the selection", () => {
    expect(selectionView(["ERC20", "VaultCore"], placed)).toEqual({ kind: "selection" });
  });
  test("selected names that aren't placed are ignored", () => {
    expect(selectionView(["Gone"], placed)).toEqual({ kind: "diamond" });
    expect(selectionView(["Gone", "ERC20"], placed)).toEqual({ kind: "facet", facet: "ERC20" });
  });
});

describe("resolveView", () => {
  const base = { selection: [] as string[], placed, problems: ["SEL-01:0xcdfe7f5c"] };

  test("a null view follows the selection", () => {
    expect(resolveView({ ...base, view: null, selection: ["ERC4626"] })).toEqual({ kind: "facet", facet: "ERC4626" });
  });
  test("an explicit view wins over the selection", () => {
    const view = { kind: "preview", facet: "Governor" } as const;
    expect(resolveView({ ...base, view, selection: ["ERC20"] })).toBe(view);
  });
  test("a facet view whose facet was removed falls back", () => {
    expect(resolveView({ ...base, view: { kind: "facet", facet: "Gone" }, selection: ["ERC20"] })).toEqual({
      kind: "facet",
      facet: "ERC20",
    });
  });
  test("a problem view whose problem was resolved falls back", () => {
    expect(resolveView({ ...base, view: { kind: "problem", id: "DEP-01:VaultCore+ERC4626" } })).toEqual({ kind: "diamond" });
    const open = { kind: "problem", id: "SEL-01:0xcdfe7f5c" } as const;
    expect(resolveView({ ...base, view: open })).toBe(open);
  });
  test("a selection view needs two placed cards", () => {
    expect(resolveView({ ...base, view: { kind: "selection" }, selection: ["ERC20"] })).toEqual({ kind: "facet", facet: "ERC20" });
  });
  test("seam views pass through untouched", () => {
    const view = { kind: "init", focus: "bundle.p.asset" } as const;
    expect(resolveView({ ...base, view })).toBe(view);
  });

  test("the core selected shows the Diamond view, and a view that no longer applies falls back to it", () => {
    expect(resolveView({ ...base, view: null, coreSelected: true })).toEqual({ kind: "diamond" });
    expect(resolveView({ ...base, view: { kind: "facet", facet: "Gone" }, coreSelected: true })).toEqual({ kind: "diamond" });
    // A view a command routed here after the core was selected still wins: the selection only resets it once.
    const preview = { kind: "preview", facet: "Governor" } as const;
    expect(resolveView({ ...base, view: preview, coreSelected: true })).toBe(preview);
  });
});

describe("kinds", () => {
  test("S5c draws its own six and names the owner of every seam view", () => {
    expect(["diamond", "facet", "selection", "preview", "problem", "comparison"].every((k) => isOwnKind(k as "diamond"))).toBe(true);
    expect(isOwnKind("doc")).toBe(false);
    expect(SEAM_OWNERS).toEqual({ init: "S5d", doc: "S12", "confirm-addresses": "S13" });
  });
});
