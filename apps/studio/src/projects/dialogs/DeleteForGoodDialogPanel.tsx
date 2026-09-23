import { plural } from "@lattice-studio/core";
import { useEffect, useRef, useState } from "react";
import { closeDialog, type DialogComponentProps } from "@/contracts";
import { persistence, type RecordCounts } from "@/persist";
import { Button, Dialog } from "@/ui";

/** "This deletes the only record of 2 deployed addresses." (spec L502); nothing deployed: no such record to lose. */
function countsLine(counts: RecordCounts | null): string {
  if (counts === null || counts.deployed === 0) return "This can't be undone.";
  return `This deletes the only record of ${plural(counts.deployed, "deployed address", "deployed addresses")}.`;
}

export function DeleteForGoodDialogPanel({ entry, top }: DialogComponentProps<"delete-for-good">) {
  const { projectId } = entry.props;
  const [counts, setCounts] = useState<RecordCounts | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const store = await persistence();
      const [trashCounts, rows] = await Promise.all([store.trashCounts(projectId), store.listTrash()]);
      if (cancelled) return;
      setCounts(trashCounts);
      setName(rows.find((r) => r.id === projectId)?.name ?? null);
    })().catch(() => {
      // The dialog closed (or storage closed) before the counts came back: nothing to show any more.
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const close = () => closeDialog("delete-for-good");

  const exportFirst = async () => {
    const { exportStoredProject } = await import("../actions");
    await exportStoredProject(projectId);
  };

  const deleteForGood = async () => {
    setBusy(true);
    const { deleteProjectForGood } = await import("../actions");
    const result = await deleteProjectForGood(projectId);
    setBusy(false);
    if (result.ok) close();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={name ? `Delete ${name} for good` : "Delete for good"}
      description={countsLine(counts)}
      top={top}
      initialFocus={cancelRef}
      footer={
        <>
          <Button onClick={() => void exportFirst()}>Export first</Button>
          <Button ref={cancelRef} onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void deleteForGood()} disabledReason={busy ? "Deleting…" : null}>
            Delete for good
          </Button>
        </>
      }
    />
  );
}
