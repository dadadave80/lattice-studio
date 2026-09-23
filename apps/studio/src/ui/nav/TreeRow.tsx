import type { ComponentPropsWithRef } from "react";
import { Tooltip } from "../tooltip/Tooltip";

export type TreeRowProps = ComponentPropsWithRef<"div"> & {
  /** A disabled row's reason, shown in a tooltip on hover and on focus. */
  reason?: string | undefined;
};

/**
 * One `Tree` row element. Everything it's given (a context menu trigger's handlers, a ref) lands on the row
 * itself, so a menu and a reason tooltip can both wrap it. The tooltip is always there, disabled while the row
 * has no reason, so a reason coming or going never remounts the row (focus stays put, spec L753).
 */
export function TreeRow({ reason, ...props }: TreeRowProps) {
  return (
    <Tooltip content={reason} disabled={!reason}>
      <div {...props} />
    </Tooltip>
  );
}
