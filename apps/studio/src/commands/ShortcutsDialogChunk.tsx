import { lazy, Suspense } from "react";
import type { DialogComponentProps } from "@/contracts";

const LazyShortcutsDialog = lazy(() => import("./ShortcutsDialog").then((m) => ({ default: m.ShortcutsDialog })));

/**
 * The Keyboard shortcuts dialog as registered: loaded in its own chunk on first open, behind its own
 * Suspense boundary so loading never suspends the app around the dialog host.
 */
export function ShortcutsDialogChunk(props: DialogComponentProps<"keyboard-shortcuts">) {
  return (
    <Suspense fallback={null}>
      <LazyShortcutsDialog {...props} />
    </Suspense>
  );
}
