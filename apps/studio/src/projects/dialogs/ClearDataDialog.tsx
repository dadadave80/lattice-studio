import { lazy, Suspense } from "react";
import type { DialogComponentProps } from "@/contracts";

const Panel = lazy(() => import("./ClearDataDialogPanel").then((m) => ({ default: m.ClearDataDialogPanel })));

/** Clear data (Settings → Data, Flow 16, spec L637): confirms and counts everything it would delete. */
export function ClearDataDialog(props: DialogComponentProps<"clear-data">) {
  return (
    <Suspense fallback={null}>
      <Panel {...props} />
    </Suspense>
  );
}
