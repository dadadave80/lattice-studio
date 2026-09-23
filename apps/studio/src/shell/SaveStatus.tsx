import { useSaveStatus } from "@/contracts";
import { Button, CommandButton, cx, Popover } from "@/ui";
import styles from "./TitleBar.module.css";

/**
 * The save status (IR L66): "Saved", "Saving…", "Not saved" or "Read-only"; a click shows the details. When
 * the status carries a command (Save a copy… while storage is full, spec L498), it sits beside the status
 * and in the details.
 */
export function SaveStatus() {
  const status = useSaveStatus();
  return (
    <span className={styles.save} data-state={status.state}>
      <Popover
        title={status.text}
        {...(status.detail ? { description: status.detail } : {})}
        trigger={
          <Button variant="quiet" size="small" className={cx(styles.saveText)}>
            {status.text}
          </Button>
        }
      >
        {status.action ? <CommandButton command={status.action} size="small" /> : undefined}
      </Popover>
      {status.action ? <CommandButton command={status.action} size="small" /> : null}
    </span>
  );
}
