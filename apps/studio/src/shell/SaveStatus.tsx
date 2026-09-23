import { useSaveStatus } from "@/contracts";
import { Button, CommandButton, cx, IconButton, Popover } from "@/ui";
import styles from "./TitleBar.module.css";

/**
 * The save status (IR L66): "Saved", "Saving…", "Not saved" or "Read-only"; a click shows the details. When
 * the status carries a command (Save a copy… while storage is full, spec L498), it sits beside the status
 * and in the details. `compact` (under 1024 px) shows it as an icon named by the status.
 */
export function SaveStatus({ compact }: { compact: boolean }) {
  const status = useSaveStatus();
  const trigger = compact ? (
    <IconButton icon={status.state === "read-only" ? "lock" : "warning"} label={status.text} />
  ) : (
    <Button variant="quiet" size="small" className={cx(styles.saveText)}>
      {status.text}
    </Button>
  );
  return (
    <span className={styles.save} data-state={status.state}>
      <Popover title={status.text} {...(status.detail ? { description: status.detail } : {})} trigger={trigger}>
        {status.action ? <CommandButton command={status.action} size="small" /> : undefined}
      </Popover>
      {status.action && !compact ? <CommandButton command={status.action} size="small" /> : null}
    </span>
  );
}
