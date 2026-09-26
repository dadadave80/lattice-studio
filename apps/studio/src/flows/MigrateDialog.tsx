import type { Result } from "@lattice-studio/core";
import { useEffect, useRef, useState } from "react";
import { closeDialog, doc, useDocument, useSession, type DialogComponentProps } from "@/contracts";
import { Button } from "@/ui/buttons/Button";
import { Dialog } from "@/ui/overlays/Dialog";
import { catalogVersion, UNBUNDLED } from "./copy";
import { applyMigration, loadMigrationSides, type MigrationSides } from "./migrate";
import { reviewMigration } from "./migrate-diff";
import { MigrateReview } from "./MigrateReview";
import styles from "./flows.module.css";

type Loaded = { status: "loading" } | { status: "error"; reason: string } | { status: "ready"; sides: MigrationSides };

const LOADING = "Loading the catalogs…";

/**
 * Migrate (IR L178, spec L290): the review of what moving to the build's catalog changes, then Migrate to 0.4.1,
 * or Keep read-only. No board yet (PA L72-L84): built from the dialog primitive and the Choose an upgrade
 * mechanism dialog's change list.
 */
export function MigrateDialog({ entry, top }: DialogComponentProps<"migrate">) {
  const project = useDocument((s) => s.project);
  const readOnly = useSession((s) => s.readOnly);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const target = entry.props.target;
  const projectId = project.id;
  const pin = project.recipe.catalog.hash;
  // What was loaded, for which project, pin and target: anything else is still loading.
  const key = `${projectId}|${pin}|${target ?? ""}`;
  const [result, setResult] = useState<{ key: string; loaded: Loaded } | null>(null);
  const loaded: Loaded = result?.key === key ? result.loaded : { status: "loading" };

  useEffect(() => {
    let live = true;
    void loadMigrationSides(doc.get(), target).then((sides: Result<MigrationSides, string>) => {
      if (!live) return;
      setResult({ key, loaded: sides.ok ? { status: "ready", sides: sides.value } : { status: "error", reason: sides.error } });
    });
    return () => {
      live = false;
    };
  }, [key, target]);

  const review = loaded.status === "ready" ? reviewMigration(project.recipe, loaded.sides.from, loaded.sides.to) : null;
  const ready = review !== null;
  useEffect(() => {
    if (ready) summaryRef.current?.focus();
  }, [ready]);

  const close = () => closeDialog("migrate");
  // Migrating edits the document: only the tab lock stops it (the catalog's read-only reason is what it clears).
  const blocked = readOnly !== null && readOnly !== UNBUNDLED ? readOnly : null;
  const reason = blocked ?? (loaded.status === "error" ? loaded.reason : null) ?? (review ? null : LOADING);

  const migrate = () => {
    if (!review || reason !== null) return;
    applyMigration(doc.get(), review);
    close();
  };

  return (
    <Dialog
      open
      top={top}
      size="wide"
      lossless
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="Migrate"
      initialFocus={() => summaryRef.current}
      footer={
        <>
          <Button onClick={close}>{readOnly === UNBUNDLED ? "Keep read-only" : "Cancel"}</Button>
          <Button variant="primary" disabledReason={reason} onClick={migrate}>
            {review ? `Migrate to ${catalogVersion(review.toTag)}` : "Migrate"}
          </Button>
        </>
      }
    >
      {loaded.status === "loading" ? <output>{LOADING}</output> : null}
      {loaded.status === "error" ? <p className={styles.note}>{loaded.reason}</p> : null}
      {review ? <MigrateReview review={review} summaryRef={summaryRef} /> : null}
    </Dialog>
  );
}
