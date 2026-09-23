/** Recipes over the fixture catalog for this module's and the AUTH and LINK checks' tests (not exported from the barrel). */
import type { AnalysisContext } from "../model/analysis";
import type { Catalog } from "../model/catalog";
import type { Address } from "../model/hex";
import type { Recipe } from "../model/recipe";
import { loadFixtureCatalog, makeRecipe } from "../testing";

const loaded = loadFixtureCatalog();

/** The fixture catalog, or null while it can't load (tests skip). */
export const fixture: Catalog | null = loaded.ok ? loaded.value : null;

/** A Safe address (spec L651's 0x71C7…976F). */
export const SAFE: Address = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
/** The deploying account in tests. */
export const DEPLOYER: Address = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";
/** This diamond's predicted address for the current salt. */
export const PREDICTED: Address = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
/** Where this diamond would have been before the salt changed. */
export const OLD_PREDICTION: Address = "0x4B20993Bc481177ec7E8f571ceCaE8A9e22C02db";

/** Spec L990: Blank diamond is DiamondLoupeFacet, ERC165Facet, Receive, AccessControl and AccessControlDiamondCut, admin "Deploying account". */
export function blankDiamond(catalog: Catalog): Recipe {
  return makeRecipe(
    {
      facets: ["AccessControlDiamondCut", "AccessControl", "Receive", "DiamondLoupeFacet", "ERC165Facet"],
      init: { kind: "steps", steps: [{ spec: "AccessControlInit", args: { admin: { $ref: "deployer" } } }] },
    },
    catalog,
  );
}

/** A fixture template's recipe, as it loads. */
export function template(catalog: Catalog, name: string): Recipe {
  const found = catalog.recipes.find((r) => r.name === name);
  if (!found) throw new Error(`No ${name} template in the fixture catalog`);
  return structuredClone(found.recipe);
}

/** An empty context: no chain, nothing known, nothing unconfirmed. */
export function context(extra: Partial<AnalysisContext> = {}): AnalysisContext {
  return { known: [], unconfirmed: [], ...extra };
}
