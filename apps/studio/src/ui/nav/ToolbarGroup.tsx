import { Toolbar as BaseToolbar } from "@base-ui/react/toolbar";
import type { ReactNode } from "react";
import { cx } from "../shared/cx";
import styles from "./Toolbar.module.css";

export type ToolbarGroupProps = {
  /** Name a group when its purpose isn't plain from its buttons ("Zoom"). */
  label?: string;
  children: ReactNode;
  className?: string | undefined;
};

/** Related toolbar controls, kept together. */
export function ToolbarGroup({ label, children, className }: ToolbarGroupProps) {
  return (
    <BaseToolbar.Group {...(label ? { "aria-label": label } : {})} className={cx(styles.group, className)}>
      {children}
    </BaseToolbar.Group>
  );
}
