import { closeDialog, type DialogComponentProps } from "@/contracts";
import { Dialog } from "@/ui";

/** Placeholder while a helper builds it. */
export function RemoveFacetsDialog({ top }: DialogComponentProps<"remove-facets">) {
  return <Dialog open top={top} onOpenChange={() => closeDialog("remove-facets")} title="Remove facets" />;
}
