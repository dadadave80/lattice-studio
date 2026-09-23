import { describe, expect, test } from "bun:test";
import type { Layout } from "@lattice-studio/core";
import { cardDescriptionId, cardNameId, FACET_NODE_TYPE } from "@/sheet/card/node";
import { nodeBuilder, tabStopOf } from "./nodes";

const layout: Layout = {
  B: { x: 300, y: 24, pins: "left" },
  A: { x: 24, y: 24, pins: "left" },
  C: { x: 24, y: 400, pins: "right" },
};

describe("tabStopOf", () => {
  test("the focus anchor's card, else the first selected, else the first in reading order", () => {
    expect(tabStopOf(layout, { kind: "facet", facet: "C" }, ["B"])).toBe("C");
    expect(tabStopOf(layout, { kind: "selector", selector: "0x12345678", facet: "B" }, [])).toBe("B");
    expect(tabStopOf(layout, { kind: "facet", facet: "Gone" }, ["B"])).toBe("B");
    expect(tabStopOf(layout, null, ["Gone", "C"])).toBe("C");
    expect(tabStopOf(layout, null, [])).toBe("A");
    expect(tabStopOf({}, null, [])).toBeNull();
  });
});

describe("nodeBuilder", () => {
  test("builds facet nodes with the card's a11y and one roving Tab stop", () => {
    const build = nodeBuilder();
    const nodes = build({ layout, selection: ["B"], tabStop: "A", measured: new Map() });
    expect(nodes.map((n) => n.id)).toEqual(["B", "A", "C"]);
    const a = nodes.find((n) => n.id === "A");
    expect(a?.type).toBe(FACET_NODE_TYPE);
    expect(a?.position).toEqual({ x: 24, y: 24 });
    expect(a?.ariaRole).toBe("group");
    expect(a?.domAttributes).toMatchObject({
      tabIndex: 0,
      "aria-roledescription": "facet card",
      "aria-labelledby": cardNameId("A"),
      "aria-describedby": cardDescriptionId("A"),
    });
    expect(nodes.find((n) => n.id === "B")?.domAttributes?.tabIndex).toBe(-1);
    expect(nodes.find((n) => n.id === "B")?.selected).toBe(true);
    expect(a?.measured).toBeUndefined();
  });

  test("keeps a node's identity until what it carries changes", () => {
    const build = nodeBuilder();
    const first = build({ layout, selection: [], tabStop: "A", measured: new Map() });
    const moved = { ...layout, B: { x: 320, y: 24, pins: "left" as const } };
    const second = build({ layout: moved, selection: [], tabStop: "A", measured: new Map([["C", { width: 232, height: 180 }]]) });
    const byId = (list: typeof first, id: string) => list.find((n) => n.id === id);
    expect(byId(second, "A")).toBe(byId(first, "A"));
    expect(byId(second, "B")).not.toBe(byId(first, "B"));
    expect(byId(second, "C")?.measured).toEqual({ width: 232, height: 180 });
    const third = build({ layout: moved, selection: ["A"], tabStop: "A", measured: new Map([["C", { width: 232, height: 180 }]]) });
    expect(byId(third, "C")).toBe(byId(second, "C"));
    expect(byId(third, "A")).not.toBe(byId(second, "A"));
  });
});
