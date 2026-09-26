import type { TemplateItem } from "@lattice-studio/core";
import { plural, templateList } from "@lattice-studio/core";
import { useMemo } from "react";
import { closeDialog, commandRef, runCommand, useCatalog, useCommandState, type DialogComponentProps } from "@/contracts";
import { Button } from "@/ui/buttons/Button";
import { Dialog } from "@/ui/overlays/Dialog";
import { ARRIVES_V11, BROWSE_ALL_RECIPES, CATALOG_LOADING } from "./copy";
import start from "./StartBlock.module.css";
import styles from "./chrome.module.css";

const CLOSE = () => closeDialog("browse-recipes");

/** One recipe: its name, script and size, and Load, or the note that says when it arrives and what it needs. */
function RecipeRow({ item }: { item: TemplateItem }) {
  const ref = commandRef("recipe.load", { name: item.name });
  const state = useCommandState(ref, "button");
  const reason = item.loadable ? (state.ok ? null : state.reason) : (item.note ?? ARRIVES_V11);
  return (
    <li className={styles.browseRow} data-recipe={item.name}>
      <div className={styles.browseText}>
        <span className={start.recipeName}>{item.name}</span>
        <span className={styles.browseScript}>{item.script}</span>
        <span className={start.recipeBlurb}>
          {plural(item.facets, "facet")}
          {item.note ? ` · ${item.note}` : ""}
        </span>
      </div>
      <Button
        size="small"
        disabledReason={reason}
        onClick={() => {
          CLOSE();
          void runCommand(ref, "button");
        }}
      >
        {`Load ${item.name}`}
      </Button>
    </li>
  );
}

/**
 * Browse all recipes (Flow 2 step 1, spec L405-L407): every Lattice recipe in catalog order. v1's recipes load
 * (in place on an empty sheet, as a new project otherwise, `recipe.load`); the rest show "Arrives in v1.1", and
 * the account recipes add that they need their own factory (R20). Closing loses nothing.
 */
export function BrowseRecipesDialog({ top }: DialogComponentProps<"browse-recipes">) {
  const catalog = useCatalog();
  const items = useMemo(() => (catalog ? templateList(catalog) : []), [catalog]);
  return (
    <Dialog
      open
      top={top}
      lossless
      title={BROWSE_ALL_RECIPES}
      onOpenChange={(open) => {
        if (!open) CLOSE();
      }}
      footer={<Button onClick={CLOSE}>Close</Button>}
    >
      {catalog ? (
        <ul className={styles.browseList} aria-label="Recipes">
          {items.map((item) => (
            <RecipeRow key={item.name} item={item} />
          ))}
        </ul>
      ) : (
        <p>{CATALOG_LOADING}</p>
      )}
    </Dialog>
  );
}
