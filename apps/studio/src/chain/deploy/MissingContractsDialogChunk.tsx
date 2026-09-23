import { lazy, Suspense } from "react";
import type { DialogComponentProps } from "@/contracts";

const LazyMissingContractsDialog = lazy(() => import("./MissingContractsDialog").then((m) => ({ default: m.MissingContractsDialog })));

/**
 * The missing-contracts sub-step as registered: loaded with the deploy chunk on first open, behind its own Suspense
 * boundary so loading never suspends the review below it.
 */
export function MissingContractsDialogChunk(props: DialogComponentProps<"missing-contracts">) {
  return (
    <Suspense fallback={null}>
      <LazyMissingContractsDialog {...props} />
    </Suspense>
  );
}
