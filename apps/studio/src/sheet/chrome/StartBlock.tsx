import { templateList } from "@lattice-studio/core";
import { useLayoutEffect, useMemo, useRef } from "react";
import { focusSheet } from "@/a11y/focus";
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
import styles from "./StartBlock.module.css";

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

/** Focus is lost when it sits on nothing, or on an element that has left the page. */
function focusLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || !active.isConnected;
}

/**
 * A load from the block (Enter on Blank diamond, a recipe card, Browse → Load) takes the block and the button that
 * ran it away. Focus goes to the sheet then, so the next Tab continues from the sheet, not the page's top. Checked
 * again a frame later, after a closing dialog has tried to hand focus back to the vanished Browse button. Only on
 * the empty-to-placed change: a project that opens with cards never has its focus taken.
 */
function useKeepFocusOnSheet(empty: boolean): void {
  const was = useRef(empty);
  useLayoutEffect(() => {
    const cleared = was.current && !empty;
    was.current = empty;
    if (!cleared) return;
    if (focusLost()) focusSheet();
    const frame = requestAnimationFrame(() => {
      if (focusLost()) focusSheet();
    });
    return () => cancelAnimationFrame(frame);
  }, [empty]);
}

/**
 * Start a diamond (spec L378, IR L108, Flows 1-2): on an empty sheet, in the card grid's place. Blank diamond
 * (core only), v1's three recipe cards, Browse all recipes, the hint and the tour line. Every choice runs a
 * command: `recipe.load` loads in place on an empty sheet and as a new project otherwise (spec L408), so the
 * block never decides that itself. A recipe this catalog can't load isn't offered.
 *
 * The block is the empty sheet's largest paint (spec L815), so it ships in the entry and draws without waiting
 * for the catalog: until the catalog loads it offers v1's three recipes, each saying why it can't load yet.
 */
export function StartBlock() {
  const empty = useDocument((s) => s.project.recipe.facets.length === 0);
  const catalog = useCatalog();
  const platform = usePlatform();
  const recipes = useMemo((): readonly string[] => {
    if (!catalog) return START_RECIPES;
    const loadable = new Set(templateList(catalog).filter((t) => t.loadable).map((t) => t.name));
    return START_RECIPES.filter((name) => loadable.has(name));
  }, [catalog]);
  const tour = useCommandState(TOUR, "button");
  useKeepFocusOnSheet(empty);
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
