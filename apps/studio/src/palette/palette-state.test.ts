import { afterEach, describe, expect, test } from "bun:test";
import { RECENT_LIMIT, recentCommands, recordRecent, resetPaletteState } from "./palette-state";

afterEach(resetPaletteState);

describe("Recent (IR L164)", () => {
  test("most recent first, each command once, at most five; palette.open never counts", () => {
    for (const id of ["layout.tidy", "history.undo", "history.redo", "layout.tidy", "palette.open"] as const) recordRecent({ id });
    expect(recentCommands()).toEqual([{ id: "layout.tidy" }, { id: "history.redo" }, { id: "history.undo" }]);
    for (let i = 0; i < 6; i += 1) recordRecent({ id: "facet.place", args: { facet: `F${i}` } });
    expect(recentCommands()).toHaveLength(RECENT_LIMIT);
    expect(recentCommands()[0]).toEqual({ id: "facet.place", args: { facet: "F5" } });
  });

  test("a facet placed with Add facet here… comes back without its old position", () => {
    recordRecent({ id: "facet.place", args: { facet: "ERC20", at: { x: 10, y: 20 } } });
    recordRecent({ id: "facet.place", args: { facet: "ERC20" } });
    expect(recentCommands()).toEqual([{ id: "facet.place", args: { facet: "ERC20" } }]);
  });
});
