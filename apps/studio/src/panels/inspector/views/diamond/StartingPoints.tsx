import { templateList } from "@lattice-studio/core";
import { useMemo } from "react";
import { commandRef, useCatalog } from "@/contracts";
import { BLANK_DIAMOND } from "@/state";
import { CommandButton } from "@/ui";
import sheet from "../../shared/sheet.module.css";
import styles from "./diamond.module.css";

/** The empty sheet's starting points (spec L384): Blank diamond, three recipes and Browse all recipes. */
export function StartingPoints() {
  const catalog = useCatalog();
  const recipes = useMemo(
    () => (catalog ? templateList(catalog).filter((template) => template.loadable).slice(0, 3) : []),
    [catalog],
  );
  return (
    <section className={sheet.section} aria-label="Start a diamond">
      <p className={sheet.text}>No facets yet</p>
      <div className={styles.starts}>
        <CommandButton command={commandRef("recipe.load", { name: BLANK_DIAMOND })} block>
          Blank diamond (core only)
        </CommandButton>
        {recipes.map((template) => (
          <CommandButton key={template.name} command={commandRef("recipe.load", { name: template.name })} block>
            {template.name}
          </CommandButton>
        ))}
        <CommandButton command={commandRef("recipe.browse")} variant="quiet" block>
          Browse all recipes
        </CommandButton>
      </div>
    </section>
  );
}
