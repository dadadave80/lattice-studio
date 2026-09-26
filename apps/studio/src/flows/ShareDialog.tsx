import { formatKeys } from "@lattice-studio/core";
import { useRef } from "react";
import { closeDialog, commandRef, runCommand, useCommandState, type DialogComponentProps } from "@/contracts";
import { Button } from "@/ui/buttons/Button";
import { copyText } from "@/ui/copy/copy-text";
import { Dialog } from "@/ui/overlays/Dialog";
import { usePlatform } from "@/ui/shared/platform";
import { linkCopied } from "./copy";
import styles from "./flows.module.css";

const SAVE_FILE = commandRef("export.recipeJson");

/**
 * Share, over 2,000 characters (spec L503, IR L179): Discord cuts a message there, so Studio offers a recipe file
 * instead, which carries the same recipe (the link carries nothing else). Focus starts on Save a file instead.
 * No board yet (PA L72-L84): built from the dialog primitive.
 */
export function ShareDialog({ entry, top }: DialogComponentProps<"share">) {
  const { link } = entry.props;
  const saveRef = useRef<HTMLButtonElement>(null);
  const save = useCommandState(SAVE_FILE, "button");
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
    void runCommand(SAVE_FILE, "button");
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
          <Button ref={saveRef} disabledReason={save.ok ? null : save.reason} onClick={saveFile}>
            Save a file instead
          </Button>
        </>
      }
    >
      <p className={styles.note}>{`A recipe file carries the same recipe. Whoever gets it opens it with ${openKeys}, or drops it on the window.`}</p>
    </Dialog>
  );
}
