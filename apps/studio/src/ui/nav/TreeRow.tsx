import type { ComponentPropsWithRef } from "react";
import { Tooltip } from "../tooltip/Tooltip";

export type TreeRowProps = ComponentPropsWithRef<"div"> & {
  /** A disabled row's reason, shown in a tooltip on hover and on focus. */
  reason?: string | undefined;
};

/**
 * One `Tree` row element. Everything it's given (a context menu trigger's handlers, a ref) lands on the row
 * itself, so a menu and a reason tooltip can both wrap it.
 */
export function TreeRow({ reason, ...props }: TreeRowProps) {
  const row = <div {...props} />;
  if (!reason) return row;
  return <Tooltip content={reason}>{row}</Tooltip>;
}
