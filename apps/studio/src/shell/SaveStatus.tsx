import { useState } from "react";
import { useSaveStatus, type SaveStatus as SaveStatusValue } from "@/contracts";
import { Button } from "@/ui/buttons/Button";
import { CommandButton } from "@/ui/buttons/CommandButton";
import { IconButton } from "@/ui/buttons/IconButton";
import type { IconName } from "@/ui/icons/icon-paths";
import { cx } from "@/ui/shared/cx";
import { LazyPart, lazyNamed } from "./LazyPart";
import styles from "./TitleBar.module.css";

type SaveStatusState = SaveStatusValue["state"];

/** The details open only on a click, so the popover loads in its own chunk after first paint. */
const Popover = lazyNamed(() => import("@/ui/overlays/Popover"), "Popover");

const ICONS: Readonly<Record<SaveStatusState, IconName>> = {
  saved: "check",
  saving: "upload",
  "not-saved": "warning",
  "read-only": "lock",
};

/**
 * The save status (IR L66): "Saved", "Saving…", "Not saved" or "Read-only"; a click shows the details. When
 * the status carries a command (Save a copy… while storage is full, spec L498), it sits beside the status
 * and in the details. `compact` (under 1024 px) shows it as an icon named by the status. Until the popover's
 * chunk arrives the status is a plain button, and a click on it opens the details as soon as it does.
 */
export function SaveStatus({ compact }: { compact: boolean }) {
  const status = useSaveStatus();
  const [open, setOpen] = useState(false);
  const trigger = (onClick?: () => void) =>
    compact ? (
      <IconButton icon={ICONS[status.state]} label={status.text} {...(onClick ? { onClick } : {})} />
    ) : (
      <Button variant="quiet" size="small" className={cx(styles.saveText)} {...(onClick ? { onClick } : {})}>
        {status.text}
      </Button>
    );
  return (
    <span className={styles.save} data-state={status.state}>
      <LazyPart fallback={trigger(() => setOpen(true))}>
        <Popover
          title={status.text}
          {...(status.detail ? { description: status.detail } : {})}
          trigger={trigger()}
          open={open}
          onOpenChange={setOpen}
        >
          {status.action ? <CommandButton command={status.action} size="small" /> : undefined}
        </Popover>
      </LazyPart>
      {status.action && !compact ? <CommandButton command={status.action} size="small" /> : null}
    </span>
  );
}
