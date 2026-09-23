import { lazy, Suspense } from "react";
import type { DialogComponentProps } from "@/contracts";

const LazySettingsDialog = lazy(() => import("./SettingsDialog").then((m) => ({ default: m.SettingsDialog })));

/** Settings, loaded in its own chunk on first open (spec L822). */
export function SettingsDialogChunk(props: DialogComponentProps<"settings">) {
  return (
    <Suspense fallback={null}>
      <LazySettingsDialog {...props} />
    </Suspense>
  );
}
