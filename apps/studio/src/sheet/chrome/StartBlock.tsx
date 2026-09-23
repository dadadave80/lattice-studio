import { templateList } from "@lattice-studio/core";
import { useMemo } from "react";
import { commandRef, runCommand, useCatalog, useCommandState, useDocument } from "@/contracts";
import { SHEET_FLOAT_ATTRIBUTE } from "@/sheet/canvas/sheet-view";
import { BLANK_DIAMOND } from "@/state";
import { Button } from "@/ui/buttons/Button";
import { CommandButton } from "@/ui/buttons/CommandButton";
import { keyLabel } from "@/ui/keys/key-labels";
import { usePlatform } from "@/ui/shared/platform";
import {
  BLANK_DIAMOND_LABEL, BROWSE_ALL_RECIPES, RECIPE_BLURBS, START_A_DIAMOND, START_RECIPES, startHint, TOUR_LINK, TOUR_PROMPT,
} from "./copy";
import { cx } from "@/ui/shared/cx";
import styles from "./chrome.module.css";

const TOUR = commandRef("tour.start");
const FLOAT = { [SHEET_FLOAT_ATTRIBUTE]: "" };

/** A recipe card: the recipe's name and what it is, loading it through `recipe.load` (Flow 2). */
function RecipeCard({ name }: { name: string }) {
  const ref = commandRef("recipe.load", { name });
  const state = useCommandState(ref, "button");
  return (
    <Button
      className={cx(styles.recipeCard)}
      disabledReason={state.ok ? null : state.reason}
      tooltip={state.title}
      onClick={() => void runCommand(ref, "button")}
    >
      <span className={styles.recipeName}>{name}</span>
      <span className={styles.recipeBlurb}>{RECIPE_BLURBS[name]}</span>
    </Button>
  );
}

/**
 * Start a diamond (spec L378, IR L108, Flows 1-2): on an empty sheet, in the card grid's place. Blank diamond
 * (core only), v1's three recipe cards, Browse all recipes, the hint and the tour line. Every choice runs a
 * command: `recipe.load` loads in place on an empty sheet and as a new project otherwise (spec L408), so the
 * block never decides that itself. A recipe this catalog can't load isn't offered.
 */
export function StartBlock() {
  const empty = useDocument((s) => s.project.recipe.facets.length === 0);
  const catalog = useCatalog();
  const platform = usePlatform();
  const recipes = useMemo(() => {
    if (!catalog) return [];
    const loadable = new Set(templateList(catalog).filter((t) => t.loadable).map((t) => t.name));
    return START_RECIPES.filter((name) => loadable.has(name));
  }, [catalog]);
  const tour = useCommandState(TOUR, "button");
  if (!empty) return null;
  return (
    <div className={styles.startLayer} data-chrome="start">
      <section className={styles.start} aria-labelledby="sheet-start-title" {...FLOAT}>
        <h2 id="sheet-start-title" className={styles.startTitle}>
          {START_A_DIAMOND}
        </h2>
        <CommandButton command={commandRef("recipe.load", { name: BLANK_DIAMOND })} block>
          {BLANK_DIAMOND_LABEL}
        </CommandButton>
        {recipes.length ? (
          <div className={styles.recipeCards}>
            {recipes.map((name) => (
              <RecipeCard key={name} name={name} />
            ))}
          </div>
        ) : null}
        <CommandButton command={commandRef("recipe.browse")} variant="quiet" block>
          {BROWSE_ALL_RECIPES}
        </CommandButton>
        <p className={styles.startHint}>{startHint(keyLabel("Mod+k", platform))}</p>
        <p className={styles.startHint}>
          {TOUR_PROMPT}{" "}
          <Button
            variant="quiet"
            size="small"
            className={cx(styles.tourLink)}
            disabledReason={tour.ok ? null : tour.reason}
            onClick={() => void runCommand(TOUR, "button")}
          >
            {TOUR_LINK}
          </Button>
        </p>
      </section>
    </div>
  );
}
