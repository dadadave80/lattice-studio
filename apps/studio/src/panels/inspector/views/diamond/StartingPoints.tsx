import { templateList } from "@lattice-studio/core";
import { useMemo } from "react";
import { commandRef, useCatalog } from "@/contracts";
import { BLANK_DIAMOND } from "@/state";
import { CommandButton } from "@/ui";
import sheet from "../../shared/sheet.module.css";
import styles from "./diamond.module.css";

/** The three recipe cards of Start a diamond, as the Start block shows them (spec L378). */
export const STARTING_RECIPES = ["GovernedVault", "ERC20", "SafeDiamondCut"] as const;

/**
 * The empty sheet's starting points (spec L378): Blank diamond (core only), the three recipes and Browse all
 * recipes. A recipe this catalog can't load isn't offered.
 */
export function StartingPoints() {
  const catalog = useCatalog();
  const recipes = useMemo(() => {
    if (!catalog) return [];
    const loadable = new Set(templateList(catalog).filter((template) => template.loadable).map((template) => template.name));
    return STARTING_RECIPES.filter((name) => loadable.has(name));
  }, [catalog]);
  return (
    <section className={sheet.section} aria-label="Start a diamond">
      <p className={sheet.text}>No facets yet</p>
      <div className={styles.starts}>
        <CommandButton command={commandRef("recipe.load", { name: BLANK_DIAMOND })} block>
          Blank diamond (core only)
        </CommandButton>
        {recipes.map((name) => (
          <CommandButton key={name} command={commandRef("recipe.load", { name })} block>
            {name}
          </CommandButton>
        ))}
        <CommandButton command={commandRef("recipe.browse")} variant="quiet" block>
          Browse all recipes
        </CommandButton>
      </div>
    </section>
  );
}
