import { describe, expect, test } from "bun:test";
import type { Catalog, LayoutMetrics, Project, Recipe } from "@lattice-studio/core";
import { analyze, loadTemplate, planMechanismChange } from "@lattice-studio/core";
import { loadFixtureCatalog, makeProject } from "@lattice-studio/core/testing";
import { layoutSizes } from "@lattice-studio/tokens";
import { applyMechanismOp, confirmAddressOp, remapLabels, remapProvenance, setAddressOp } from "./ops";

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

  test("an address marked both confirmed and From link keeps the least trusted mark when it changes hands", () => {
    // admin = safe = one address; only the admin was confirmed. Safe → Safe with delay drops SafeDiamondCutInit.
    const recipe: Recipe = {
      ...template("SafeDiamondCut"),
      init: { kind: "steps", steps: [{ spec: "SafeDiamondCutInit", args: { admin: SAFE, safe: SAFE, minThreshold: "2" } }] },
    };
    const project = projectWith(recipe, { "steps[0].admin": "confirmed", "steps[0].safe": "link" });
    const change = planMechanismChange(recipe, catalog, "safe-delay", { safe: SAFE, minThreshold: "2", delay: "86400" });
    if (!change.ok) throw new Error(change.error);
    const next = applyMechanismOp(change.value.next, catalog, metrics, "Use GovernedSafeDiamondCut")(project).project;
    const steps = next.recipe.init.kind === "steps" ? next.recipe.init.steps : [];
    const at = steps.findIndex((s) => s.spec === "GovernedSafeDiamondCutInit");
    expect(next.provenance[`steps[${at}].admin`]).toBe("link");
    expect(next.provenance[`steps[${at}].safe`]).toBe("link");
    expect(Object.values(next.provenance)).not.toContain("confirmed");
    // LINK-01 still blocks, as S1 builds the context from provenance.
    const unconfirmed = Object.entries(next.provenance).filter(([, s]) => s !== "confirmed").map(([path]) => path);
    const problems = analyze(next.recipe, catalog, { known: [], unconfirmed, unconfirmedFrom: Object.fromEntries(unconfirmed.map((p) => [p, "link" as const])) }).problems;
    expect(problems.some((p) => p.code === "LINK-01" && p.severity === "blocker")).toBe(true);
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

describe("an address and its ENS label (spec L462)", () => {
  const safeCut = (args: Record<string, string>, labels?: Record<string, string>): Project => {
    const recipe: Recipe = {
      ...template("SafeDiamondCut"),
      init: { kind: "steps", steps: [{ spec: "SafeDiamondCutInit", args: { admin: LINKED, minThreshold: "2", ...args } }] },
    };
    return { ...projectWith(recipe), ...(labels ? { labels } : {}) };
  };
  const safeOf = (project: Project) => (project.recipe.init.kind === "steps" ? project.recipe.init.steps[0]?.args.safe : undefined);

  test("a resolved name lands with its address in one edit", () => {
    const result = setAddressOp(catalog, "steps[0].safe", SAFE, "safe.eth", "Safe")(safeCut({}));
    expect(result.changed).toBe(true);
    expect(result.summary).toBe("Set Safe to safe.eth");
    expect(safeOf(result.project)).toBe(SAFE);
    expect(result.project.labels).toEqual({ "steps[0].safe": "safe.eth" });
  });

  test("a plain address drops the label; other fields keep theirs; no labels leaves no key", () => {
    const project = safeCut({ safe: SAFE }, { "steps[0].safe": "safe.eth", "steps[0].admin": "ops.eth" });
    const result = setAddressOp(catalog, "steps[0].safe", LINKED, null, "Safe")(project);
    expect(result.changed).toBe(true);
    expect(result.summary).toBe("Set SafeDiamondCutInit.safe to 0x4B20…02db");
    expect(result.project.labels).toEqual({ "steps[0].admin": "ops.eth" });
    const last = setAddressOp(catalog, "steps[0].admin", SAFE, null, "Admin")(result.project);
    expect(last.changed).toBe(true);
    expect("labels" in last.project).toBe(false);
  });

  test("a name for the address already stored adds only the label; the same name again is a no-op that says why", () => {
    const project = safeCut({ safe: SAFE });
    const labeled = setAddressOp(catalog, "steps[0].safe", SAFE, "safe.eth", "Safe")(project);
    expect(labeled).toMatchObject({ changed: true, summary: "Set Safe to safe.eth" });
    expect(labeled.project.recipe).toBe(project.recipe);
    expect(labeled.project.labels).toEqual({ "steps[0].safe": "safe.eth" });
    const again = setAddressOp(catalog, "steps[0].safe", SAFE, "safe.eth", "Safe")(labeled.project);
    expect(again.changed).toBe(false);
    expect(again.summary).toBe("SafeDiamondCutInit.safe is already 0x71C7…976F.");
  });

  test("a path core refuses stores no label either", () => {
    const project = safeCut({});
    const result = setAddressOp(catalog, "steps[4].safe", SAFE, "safe.eth", "Safe")(project);
    expect(result.changed).toBe(false);
    expect(result.project).toBe(project);
  });

  test("Flow 17 carries a label with its address and drops one whose address is gone", () => {
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
          { spec: "AccessControlInit", args: { admin: LINKED } },
          { spec: "ERC20Init", args: { name_: "Vault", symbol_: "V" } },
        ],
      },
    };
    const labels = { "steps[1].admin": "ops.eth", "steps[1].safe": "safe.eth", "steps[0].name_": "not-an-address.eth" };
    expect(remapLabels(labels, before, after)).toEqual({ "steps[0].admin": "ops.eth" });
  });

  test("applying Flow 17 keeps the admin's label on the step that now holds it", () => {
    const recipe: Recipe = {
      ...template("SafeDiamondCut"),
      init: { kind: "steps", steps: [{ spec: "SafeDiamondCutInit", args: { admin: LINKED, safe: SAFE, minThreshold: "2" } }] },
    };
    const project: Project = { ...projectWith(recipe), labels: { "steps[0].admin": "ops.eth", "steps[0].safe": "safe.eth" } };
    const change = planMechanismChange(recipe, catalog, "admin", {});
    if (!change.ok) throw new Error(change.error);
    const next = applyMechanismOp(change.value.next, catalog, metrics, "Use AccessControlDiamondCut")(project).project;
    const steps = next.recipe.init.kind === "steps" ? next.recipe.init.steps : [];
    const at = steps.findIndex((s) => s.spec === "AccessControlInit");
    expect(next.labels).toEqual({ [`steps[${at}].admin`]: "ops.eth" });
  });
});
