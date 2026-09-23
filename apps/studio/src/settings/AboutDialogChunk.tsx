import { lazy, Suspense } from "react";
import type { DialogComponentProps } from "@/contracts";

const LazyAboutDialog = lazy(() => import("./AboutDialog").then((m) => ({ default: m.AboutDialog })));

/** About, loaded in its own chunk on first open (spec L822's "Settings … are their own chunks"). */
export function AboutDialogChunk(props: DialogComponentProps<"about">) {
  return (
    <Suspense fallback={null}>
      <LazyAboutDialog {...props} />
    </Suspense>
  );
}
