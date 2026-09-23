import { describe, expect, test } from "bun:test";
import type { Catalog, LayoutMetrics, Project, Recipe } from "@lattice-studio/core";
import { loadTemplate, planMechanismChange } from "@lattice-studio/core";
import { loadFixtureCatalog, makeProject } from "@lattice-studio/core/testing";
import { layoutSizes } from "@lattice-studio/tokens";
import { applyMechanismOp, confirmAddressOp, remapProvenance } from "./ops";

const loaded = loadFixtureCatalog();
if (!loaded.ok) throw new Error(loaded.error);
const catalog: Catalog = loaded.value;
const metrics: LayoutMetrics = layoutSizes;
const SAFE = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
const LINKED = "0x4B20993Bc481177ec7E8f571ceCaE8A9e22C02db";

function template(name: string): Recipe {
  const recipe = loadTemplate(catalog, name);
  if (!recipe.ok) throw new Error(recipe.error);
  return recipe.value;
}

function projectWith(recipe: Recipe, provenance: Project["provenance"] = {}): Project {
  const layout: Project["layout"] = {};
  recipe.facets.forEach((facet, i) => {
    layout[facet] = { x: 96 + (i % 4) * 320, y: 96 + Math.floor(i / 4) * 400, pins: "right" };
  });
  return makeProject({ recipe, layout, provenance });
}

describe("Confirm address… (LINK-01)", () => {
  test("marks a From link address confirmed, and says what it did or why not", () => {
    const project = projectWith(template("SafeDiamondCut"), { "steps[0].safe": "link" });
    const done = confirmAddressOp("steps[0].safe", "Safe")(project);
    expect(done.changed).toBe(true);
    expect(done.summary).toBe("Confirmed Safe");
    expect(done.project.provenance["steps[0].safe"]).toBe("confirmed");
    const again = confirmAddressOp("steps[0].safe", "Safe")(done.project);
    expect(again).toMatchObject({ changed: false, summary: "Safe is already confirmed." });
    expect(confirmAddressOp("steps[0].admin", "Admin")(project)).toMatchObject({ changed: false, summary: "Admin didn't come from a link or a file." });
  });
});

describe("applying Flow 17", () => {
  test("SafeDiamondCut → Admin role: cards follow the facets, and a linked admin keeps its mark in its new step", () => {
    const recipe = template("SafeDiamondCut");
    const withAdmin: Recipe = {
      ...recipe,
      init: { kind: "steps", steps: [{ spec: "SafeDiamondCutInit", args: { admin: LINKED, safe: SAFE, minThreshold: "2" } }] },
    };
    const project = projectWith(withAdmin, { "steps[0].admin": "link" });
    const change = planMechanismChange(withAdmin, catalog, "admin", {});
    if (!change.ok) throw new Error(change.error);
    const result = applyMechanismOp(change.value.next, catalog, metrics, "Use AccessControlDiamondCut")(project);
    const next = result.project;
    expect(result.summary).toBe("Use AccessControlDiamondCut");
    expect(next.recipe.facets).toContain("AccessControlDiamondCut");
    expect(next.recipe.facets).not.toContain("SafeDiamondCut");
    expect(Object.keys(next.layout).sort()).toEqual([...next.recipe.facets].sort());
    // The newcomer took the old member's place, or the nearest free slot to it.
    const old = project.layout.SafeDiamondCut;
    const placed = next.layout.AccessControlDiamondCut;
    expect(placed).toBeDefined();
    expect(old).toBeDefined();
    if (!placed || !old) return;
    expect(Math.abs(placed.y - old.y) + Math.abs(placed.x - old.x)).toBeLessThan(800);
    const steps = next.recipe.init.kind === "steps" ? next.recipe.init.steps : [];
    const at = steps.findIndex((s) => s.spec === "AccessControlInit");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(steps[at]?.args.admin).toBe(LINKED);
    expect(next.provenance[`steps[${at}].admin`]).toBe("link");
  });

  test("a step that survives keeps its marks where it moved; a value the dialog rewrote loses them", () => {
    const before: Recipe = {
      ...template("SafeDiamondCut"),
      init: {
        kind: "steps",
        steps: [
          { spec: "ERC20Init", args: { name_: "Vault", symbol_: "V" } },
          { spec: "SafeDiamondCutInit", args: { admin: LINKED, safe: SAFE, minThreshold: "2" } },
        ],
      },
    };
    const after: Recipe = {
      ...before,
      init: {
        kind: "steps",
        steps: [
          { spec: "SafeDiamondCutInit", args: { admin: LINKED, safe: "0x0000000000000000000000000000000000000001", minThreshold: "2" } },
          { spec: "ERC20Init", args: { name_: "Vault", symbol_: "V" } },
        ],
      },
    };
    const moved = remapProvenance({ "steps[0].name_": "file", "steps[1].admin": "link", "steps[1].safe": "link", other: "link" }, before, after);
    expect(moved).toEqual({ "steps[1].name_": "file", "steps[0].admin": "link", other: "link" });
  });

  test("placing into an empty sheet lands every new card, none stacked", () => {
    const recipe = template("ERC20");
    const project = makeProject({ recipe, layout: {} });
    const change = planMechanismChange(recipe, catalog, "safe", { safe: SAFE, minThreshold: "2" });
    if (!change.ok) throw new Error(change.error);
    const next = applyMechanismOp(change.value.next, catalog, metrics, "Use SafeDiamondCut")(project).project;
    const spots = Object.values(next.layout).map((p) => `${p.x},${p.y}`);
    expect(new Set(spots).size).toBe(spots.length);
    expect(Object.keys(next.layout).sort()).toEqual([...next.recipe.facets].sort());
  });
});
