import { formatKeys } from "@lattice-studio/core";
import { useRef } from "react";
import { announce, closeDialog, doc, getCatalog, log, useCatalog, type DialogComponentProps } from "@/contracts";
import { Button } from "@/ui/buttons/Button";
import { copyText } from "@/ui/copy/copy-text";
import { Dialog } from "@/ui/overlays/Dialog";
import { usePlatform } from "@/ui/shared/platform";
import { linkCopied } from "./copy";
import { sharedRecipe } from "./share-link";
import styles from "./flows.module.css";

/**
 * Saves the recipe the link would carry (named after the project) as `recipe.json`, through the console's export
 * path: the download and "Exported recipe.json · recipe 0x3f2a…a1c4" (spec L729). Loaded on use.
 */
async function saveRecipeFile(): Promise<void> {
  const catalog = getCatalog();
  const { recipeFile, saveExport } = await import("@/panels/console/actions");
  const project = doc.get();
  const file = catalog ? await recipeFile({ project: { ...project, recipe: sharedRecipe(project) }, catalog }) : null;
  if (file?.ok) {
    saveExport(file.value);
    return;
  }
  const reason = file ? file.error : "The catalog hasn't loaded yet · Wait for it to finish";
  log({ tag: "Error", text: `Couldn't save the recipe file. ${reason}` });
  announce(`Couldn't save the recipe file. ${reason}`);
}

/**
 * Share, over 2,000 characters (spec L503, IR L179): Discord cuts a message there, so Studio offers a recipe file
 * instead, which carries the same recipe (the link carries nothing else). Focus starts on Save a file instead.
 * No board yet (PA L72-L84): built from the dialog primitive.
 */
export function ShareDialog({ entry, top }: DialogComponentProps<"share">) {
  const { link } = entry.props;
  const saveRef = useRef<HTMLButtonElement>(null);
  const catalog = useCatalog();
  const close = () => closeDialog("share");
  const length = link.length.toLocaleString("en-US");
  const openKeys = formatKeys("Mod+O", usePlatform());

  const copyAnyway = async () => {
    const copied = await copyText(link, { message: linkCopied(link.length) });
    // A blocked clipboard shows the link selected inside this dialog: it stays open until that's done.
    if (copied.ok) close();
  };
  const saveFile = () => {
    close();
    void saveRecipeFile();
  };

  return (
    <Dialog
      open
      top={top}
      lossless
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="Share"
      description={`This link is ${length} characters, over the 2,000 a Discord message holds.`}
      initialFocus={saveRef}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button onClick={() => void copyAnyway()}>Copy anyway</Button>
          <Button ref={saveRef} disabledReason={catalog ? null : "The catalog hasn't loaded yet · Wait for it to finish"} onClick={saveFile}>
            Save a file instead
          </Button>
        </>
      }
    >
      <p className={styles.note}>{`A recipe file carries the same recipe. Whoever gets it opens it with ${openKeys}, or drops it on the window.`}</p>
    </Dialog>
  );
}
