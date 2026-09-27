import { useEffect } from "react";
import { commandRef, pushEscape } from "@/contracts";
import { clearOpenFailure, useOpenFailure } from "@/persist/current";
import { SHEET_FLOAT_ATTRIBUTE } from "@/sheet/canvas/sheet-view";
import { Button } from "@/ui/buttons/Button";
import { CommandButton } from "@/ui/buttons/CommandButton";
import { copyText } from "@/ui/copy/copy-text";
import { Icon } from "@/ui/icons/Icon";
import { COPY_DETAILS, DETAILS_LABEL, OPEN_ANOTHER_PROJECT } from "./copy";
import start from "./StartBlock.module.css";
import styles from "./chrome.module.css";

const FLOAT = { [SHEET_FLOAT_ATTRIBUTE]: "" };

/**
 * The sheet's error state (spec L696): "This project couldn't be opened: {reason}" with Open another project
 * (the Projects dialog, `project.list`) and Copy details, in the Start block's place. Shown while persist holds an
 * open failure (`showOpenFailure`); the document changing or Esc ends it. Focus isn't moved to it.
 */
export function OpenError() {
  const failure = useOpenFailure();
  const showing = failure !== null;
  useEffect(() => (showing ? pushEscape(() => clearOpenFailure()) : undefined), [showing]);
  if (!failure) return null;
  return (
    <div className={start.startLayer} data-chrome="open-error">
      <section className={start.start} aria-labelledby="sheet-open-error" {...FLOAT}>
        <p id="sheet-open-error" className={styles.openError}>
          <Icon name="error" size="small" />
          <span>{failure.text}</span>
        </p>
        <CommandButton command={commandRef("project.list")} block>
          {OPEN_ANOTHER_PROJECT}
        </CommandButton>
        <Button variant="quiet" block onClick={() => void copyText(failure.details, { label: DETAILS_LABEL })}>
          {COPY_DETAILS}
        </Button>
      </section>
    </div>
  );
}
