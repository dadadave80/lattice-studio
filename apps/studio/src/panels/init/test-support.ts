/**
 * Builders for S5d's browser tests: fixture recipes as projects, and a catalog with one init of every field kind
 * the fixture's real inits don't have (booleans, enums, length-limited strings, plain integers).
 */
import type { Catalog, InitSpec, Project, Recipe } from "@lattice-studio/core";
import { loadTemplate } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import { fixtureCatalog } from "../../../test/harness/catalog";

export const SAFE = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
export const TOKEN = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
export const LINKED = "0x4B20993Bc481177ec7E8f571ceCaE8A9e22C02db";
/** Runtime code for the fake chain: anything but "0x" counts as a contract. */
export const SOME_CODE = "0x6080604052";

export function templateRecipe(name: string, catalog: Catalog = fixtureCatalog()): Recipe {
  const loaded = loadTemplate(catalog, name);
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.value;
}

/** A project around `recipe`, each card at its own spot. */
export function projectFor(recipe: Recipe, extra: Partial<Project> = {}): Project {
  const layout: Project["layout"] = {};
  recipe.facets.forEach((facet, i) => {
    layout[facet] = { x: 96 + (i % 4) * 320, y: 96 + Math.floor(i / 4) * 480, pins: "right" };
  });
  return makeProject({ recipe, layout, ...extra });
}

const KITCHEN: InitSpec = {
  name: "KitchenInit",
  contract: "KitchenInit",
  fn: "init(bool,string,string,uint16,address)",
  kind: "step",
  params: [
    { name: "paused", type: "bool", doc: "Start paused." },
    { name: "tier", type: "string", doc: "Which tier the vault starts in.", rule: "enum(bronze|silver|gold)" },
    { name: "label", type: "string", doc: "A short label.", rule: "maxlen(8)" },
    { name: "slots", type: "uint16", doc: "How many slots." },
    // No nonzero rule: the zero address is allowed (spec L462's "Zero address" pick).
    { name: "treasury", type: "address", doc: "Where fees go; the zero address keeps them in the vault." },
  ],
  initializes: [],
  after: [],
  sameCall: [],
};

/** An init with a documented order the fixture's real inits don't break: it must run after ERC20's (INIT-02). */
const PAYOUT: InitSpec = {
  name: "PayoutInit",
  contract: "PayoutInit",
  fn: "init()",
  kind: "step",
  params: [],
  initializes: [{ module: "Payout" }],
  after: ["ERC20"],
  sameCall: [],
};

/**
 * The fixture catalog plus KitchenInit, whose five params cover the field kinds the real inits don't, and
 * PayoutInit, which must follow ERC20Init.
 */
export function kitchenCatalog(): Catalog {
  const catalog = fixtureCatalog();
  return { ...catalog, inits: [...catalog.inits, KITCHEN, PAYOUT] };
}

/** Three steps, the first out of order (INIT-02). */
export function stepsRecipe(catalog: Catalog): Recipe {
  return {
    ...templateRecipe("ERC20", catalog),
    init: {
      kind: "steps",
      steps: [
        { spec: "PayoutInit", args: {} },
        { spec: "ERC20Init", args: { name_: "Vault", symbol_: "VLT" } },
        { spec: "KitchenInit", args: {} },
      ],
    },
  };
}

export function kitchenRecipe(catalog: Catalog): Recipe {
  return {
    ...templateRecipe("ERC20", catalog),
    init: { kind: "steps", steps: [{ spec: "KitchenInit", args: {} }] },
  };
}
