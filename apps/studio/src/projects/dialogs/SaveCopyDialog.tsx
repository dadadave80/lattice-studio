import { lazy, Suspense } from "react";
import type { DialogComponentProps } from "@/contracts";

const Panel = lazy(() => import("./SaveCopyDialogPanel").then((m) => ({ default: m.SaveCopyDialogPanel })));

/** Save a copy… (⌘S with no linked file, spec L497-L499). The panel loads on first open (size gate). */
export function SaveCopyDialog(props: DialogComponentProps<"save-copy">) {
  return (
    <Suspense fallback={null}>
      <Panel {...props} />
    </Suspense>
  );
}
