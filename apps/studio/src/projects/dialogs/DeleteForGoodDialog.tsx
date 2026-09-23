import { lazy, Suspense } from "react";
import type { DialogComponentProps } from "@/contracts";

const Panel = lazy(() => import("./DeleteForGoodDialogPanel").then((m) => ({ default: m.DeleteForGoodDialogPanel })));

/** Delete for good (Recently deleted, spec L502): confirms and counts the deployment records it would lose. */
export function DeleteForGoodDialog(props: DialogComponentProps<"delete-for-good">) {
  return (
    <Suspense fallback={null}>
      <Panel {...props} />
    </Suspense>
  );
}
