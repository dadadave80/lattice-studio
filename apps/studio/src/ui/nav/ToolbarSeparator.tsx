import { Toolbar as BaseToolbar } from "@base-ui/react/toolbar";
import { cx } from "../shared/cx";
import styles from "./Toolbar.module.css";

/** A hairline between groups of toolbar controls. */
export function ToolbarSeparator({ className }: { className?: string | undefined }) {
  return <BaseToolbar.Separator className={cx(styles.separator, className)} />;
}
