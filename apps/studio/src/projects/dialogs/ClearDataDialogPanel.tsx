import { plural, type Project } from "@lattice-studio/core";
import { useEffect, useRef, useState } from "react";
import { closeDialog, doc, type DialogComponentProps } from "@/contracts";
import { persistence, type ClearDataCounts } from "@/persist";
import { Button, Dialog, Icon } from "@/ui";
import errorStyles from "./confirm-error.module.css";

/** "This deletes 3 projects, including the only record of 2 deployed addresses." (spec L502, L637). */
function countsLine(counts: ClearDataCounts | null): string {
  if (counts === null) return "";
  const total = counts.projects + counts.trashed;
  if (total === 0) return "There's nothing stored to delete.";
  const projectsPart = `This deletes ${plural(total, "project")}`;
  if (counts.deployed === 0) return `${projectsPart}. This can't be undone.`;
  return `${projectsPart}, including the only record of ${plural(counts.deployed, "deployed address", "deployed addresses")}.`;
}

export function ClearDataDialogPanel({ top }: DialogComponentProps<"clear-data">) {
  const [counts, setCounts] = useState<ClearDataCounts | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportedFrom, setExportedFrom] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const exportFirstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const store = await persistence();
      const next = await store.clearDataCounts();
      if (!cancelled) setCounts(next);
    })().catch(() => {
      // Closed before the counts came back: nothing to show any more.
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const close = () => closeDialog("clear-data");

  const exportFirst = async () => {
    setBusy(true);
    setError(null);
    try {
      const { exportAllData } = await import("../actions");
      const result = await exportAllData();
      if (result.ok) setExportedFrom(result.source);
      else if ("error" in result) setError(result.error);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    const expected = exportedFrom ?? doc.get();
    setBusy(true);
    setError(null);
    try {
      const { clearAllData } = await import("../actions");
      const result = await clearAllData(expected);
      if (result.ok) close();
      else setError(result.error);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const counting = counts === null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="Clear data"
      description={countsLine(counts)}
      top={top}
      initialFocus={exportFirstRef}
      footer={
        <>
          <Button ref={exportFirstRef} onClick={() => void exportFirst()} disabledReason={busy ? "Working…" : null}>
            Export first
          </Button>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => void clear()}
            disabledReason={busy ? "Working…" : counting ? "Counting records…" : null}
          >
            Delete everything
          </Button>
        </>
      }
    >
      {error ? (
        <p className={errorStyles.error} role="alert">
          <Icon name="error" className={errorStyles.errorIcon} />
          <span>{error}</span>
        </p>
      ) : null}
    </Dialog>
  );
}
