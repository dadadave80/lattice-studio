import { formatTime, plural } from "@lattice-studio/core";
import { openDialog } from "@/contracts";
import type { TrashSummary } from "@/persist";
import { Button, Tooltip } from "@/ui";
import styles from "./TrashRow.module.css";

export type TrashRowProps = { summary: TrashSummary };

/** One row of Recently deleted: Restore, or Delete for good (which confirms in its own dialog, spec L502). */
export function TrashRow({ summary }: TrashRowProps) {
  const { id, name, deletedAt, deployments } = summary;
  const now = new Date().toISOString();
  const deleted = formatTime(new Date(deletedAt).toISOString(), now);
  const deployed = deployments.filter((d) => d.status !== "failed").length;

  return (
    <li className={styles.row}>
      <span className={styles.name}>{name}</span>
      <Tooltip content={deleted.title}>
        <span className={styles.deleted}>deleted {deleted.text}</span>
      </Tooltip>
      {deployed > 0 ? (
        <span className={styles.counts}>{plural(deployed, "deployed address", "deployed addresses")}</span>
      ) : null}
      <span className={styles.actions}>
        <Button
          size="small"
          icon="restore"
          onClick={async () => {
            const { restoreProject } = await import("../actions");
            await restoreProject(id);
          }}
        >
          Restore
        </Button>
        <Button size="small" icon="trash" onClick={() => openDialog("delete-for-good", { projectId: id })}>
          Delete for good
        </Button>
      </span>
    </li>
  );
}
