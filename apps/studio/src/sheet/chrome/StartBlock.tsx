import { isCoreOnly, templateList } from "@lattice-studio/core";
import { type RefObject, useLayoutEffect, useMemo, useRef } from "react";
import { focusSheet } from "@/a11y/focus";
import { commandRef, doc, runCommand, useCatalog, useCommandState, useDocument } from "@/contracts";
import { useOpenFailure } from "@/persist/current";
import { SHEET_FLOAT_ATTRIBUTE } from "@/sheet/canvas/sheet-view";
import { BLANK_DIAMOND } from "@/state";
import { Button } from "@/ui/buttons/Button";
import { CommandButton } from "@/ui/buttons/CommandButton";
import { keyLabel } from "@/ui/keys/key-labels";
import { usePlatform } from "@/ui/shared/platform";
import {
  BLANK_DIAMOND_ADDS, BLANK_DIAMOND_LABEL, BROWSE_ALL_RECIPES, RECIPE_BLURBS, START_A_DIAMOND, START_RECIPES, startHint, TOUR_LINK, TOUR_PROMPT,
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

/** The label of the Start block control that had focus when the loading sheet's block left the page. */
let handedOver: string | null = null;

/**
 * The loading sheet, as the canvas takes over (`Sheet.tsx`): notes which of its Start block's controls has focus,
 * by its label, so the canvas's block can give focus back to the same control once it mounts.
 */
export function handOverStartFocus(within: HTMLElement): void {
  const active = document.activeElement;
  handedOver = active instanceof HTMLElement && within.contains(active) ? active.textContent : null;
}

/**
 * Reads and clears the note in one call. Kept out of the hook: the React Compiler would read the module variable
 * after clearing it there, so the canvas's block would never see the label.
 */
function takeHandedOver(): string | null {
  const label = handedOver;
  handedOver = null;
  return label;
}

/**
 * The canvas's block, as it mounts: the loading sheet's block, and the control that had focus in it, have just
 * left the page, so focus goes to the same control here and the next Tab continues from it, not the page's top.
 */
function useTakeStartFocus(layer: RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const label = takeHandedOver();
    if (label === null || !focusLost()) return;
    const controls = layer.current?.querySelectorAll<HTMLElement>("button") ?? [];
    Array.from(controls).find((control) => control.textContent === label)?.focus();
  }, [layer]);
}

/**
 * A load from the block (Enter on Blank diamond, a recipe card, Browse → Load) takes the block and the button that
 * ran it away. Focus goes to the sheet then, so the next Tab continues from the sheet, not the page's top. Checked
 * again a frame later, after a closing dialog has tried to hand focus back to the vanished Browse button. Only on
 * the empty-to-placed change an edit makes: a project that opens with cards (the last one, reopened while the
 * block shows during startup) never has its focus taken.
 */
function useKeepFocusOnSheet(empty: boolean): void {
  const was = useRef(empty);
  useLayoutEffect(() => {
    const cleared = was.current && !empty && doc.state().lastChange?.kind !== "load";
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
 * (the core, Receive, AccessControl and its cut), v1's three recipe cards, Browse all recipes, the hint and the tour
 * line. Every choice runs a
 * command: `recipe.load` loads in place on an empty sheet and as a new project otherwise (spec L408), so the
 * block never decides that itself. A recipe this catalog can't load isn't offered.
 *
 * The block is the empty sheet's largest paint (spec L815), so it ships in the entry and draws without waiting
 * for the catalog: until the catalog loads it offers v1's three recipes, each saying why it can't load yet.
 */
export function StartBlock() {
  const empty = useDocument((s) => isCoreOnly(s.project.recipe));
  const catalog = useCatalog();
  const platform = usePlatform();
  const recipes = useMemo((): readonly string[] => {
    if (!catalog) return START_RECIPES;
    const loadable = new Set(templateList(catalog).filter((t) => t.loadable).map((t) => t.name));
    return START_RECIPES.filter((name) => loadable.has(name));
  }, [catalog]);
  const tour = useCommandState(TOUR, "button");
  // The sheet's open error (`OpenError.tsx`) takes the block's place while it shows (spec L696).
  const failed = useOpenFailure() !== null;
  const layer = useRef<HTMLDivElement>(null);
  useKeepFocusOnSheet(empty);
  useTakeStartFocus(layer);
  if (!empty || failed) return null;
  return (
    <div ref={layer} className={styles.startLayer} data-chrome="start">
      <section className={styles.start} aria-labelledby="sheet-start-title" {...FLOAT}>
        <h2 id="sheet-start-title" className={styles.startTitle}>
          {START_A_DIAMOND}
        </h2>
        <CommandButton command={commandRef("recipe.load", { name: BLANK_DIAMOND })} block>
          {BLANK_DIAMOND_LABEL}
        </CommandButton>
        <p className={styles.startHint}>{BLANK_DIAMOND_ADDS}</p>
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
        <p className={cx(styles.startHint, styles.keysHint)}>{startHint(keyLabel("Mod+k", platform))}</p>
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
