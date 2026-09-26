import { describe, expect, test } from "bun:test";
import type { Catalog, Hex4, Trace } from "@lattice-studio/core";
import { loadFixtureCatalog, makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { edgesOf, pathOf } from "./edge-data";
import { routeAll } from "./owners";

const loaded = loadFixtureCatalog();
if (!loaded.ok) throw new Error(loaded.error);
const catalog: Catalog = loaded.value;

const SEND: Hex4 = "0xcdfe7f5c";
const ATTRIBUTE: Hex4 = "0xdc680a0f";

function project() {
  const facets = ["AxelarGatewayAdapter", "HyperlaneGatewayAdapter"];
  return makeProject({ recipe: makeRecipe({ facets }, catalog) });
}

describe("routeAll: a whole set as one edit (spec L435, L439)", () => {
  test("routes every selector and names the count", () => {
    const result = routeAll(project(), catalog, [
      { selector: SEND, facet: "HyperlaneGatewayAdapter" },
      { selector: ATTRIBUTE, facet: "HyperlaneGatewayAdapter" },
    ]);
    expect(result.changed).toBe(true);
    expect(result.summary).toBe("Routed 2 selectors to HyperlaneGatewayAdapter");
    expect(result.project.recipe.owners).toEqual({ [SEND]: "HyperlaneGatewayAdapter", [ATTRIBUTE]: "HyperlaneGatewayAdapter" });
  });

  test("owners split between facets say so", () => {
    const result = routeAll(project(), catalog, [
      { selector: SEND, facet: "HyperlaneGatewayAdapter" },
      { selector: ATTRIBUTE, facet: "AxelarGatewayAdapter" },
    ]);
    expect(result.summary).toBe("Chose owners for 2 selectors");
  });

  test("one selector reads as the route itself", () => {
    const result = routeAll(project(), catalog, [{ selector: SEND, facet: "AxelarGatewayAdapter" }]);
    expect(result.summary).toBe("Routed `sendMessage · 0xcdfe7f5c` to AxelarGatewayAdapter");
  });

  test("nothing to change is a no-op that says why", () => {
    const routed = routeAll(project(), catalog, [{ selector: SEND, facet: "AxelarGatewayAdapter" }]).project;
    const again = routeAll(routed, catalog, [{ selector: SEND, facet: "AxelarGatewayAdapter" }]);
    expect(again.changed).toBe(false);
    expect(again.summary).toContain("already routes to AxelarGatewayAdapter");
  });
});

describe("edges from C9's traces", () => {
  const layout = {
    VaultCore: { x: 0, y: 0, pins: "left" as const },
    ERC4626: { x: 400, y: 0, pins: "left" as const },
  };
  const sizes = { VaultCore: { width: 232, height: 200 }, ERC4626: { width: 232, height: 300 } };

  test("a dependency joins the header handles on the sides its points touch", () => {
    const trace: Trace = {
      id: "needs:VaultCore:ERC4626", kind: "dependency", from: "VaultCore", to: "ERC4626",
      points: [{ x: 232, y: 20 }, { x: 400, y: 20 }], mid: { x: 316, y: 20 }, label: "needs ERC4626",
    };
    const [edge] = edgesOf([trace], layout, sizes);
    expect(edge).toMatchObject({
      id: trace.id, type: "dependency", source: "VaultCore", target: "ERC4626",
      sourceHandle: "dependency-right", targetHandle: "dependency-left", selectable: false, focusable: false,
    });
    expect(edge?.data?.label).toBe("needs ERC4626");
  });

  test("a tie joins the contested pin rows", () => {
    const trace: Trace = {
      id: `tie:${SEND}:A+B`, kind: "tie", from: "VaultCore", to: "ERC4626", selector: SEND,
      points: [{ x: 0, y: 50 }, { x: -16, y: 50 }, { x: -16, y: 60 }, { x: 400, y: 60 }], mid: { x: 200, y: 60 },
    };
    const [edge] = edgesOf([trace], layout, sizes);
    expect(edge).toMatchObject({ type: "tie", sourceHandle: SEND, targetHandle: SEND });
  });

  test("paths are straight runs through the points", () => {
    expect(pathOf([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }])).toBe("M0 0 L10 0 L10 5");
  });
});
