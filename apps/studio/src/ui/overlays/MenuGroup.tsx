import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ReactNode } from "react";
import styles from "./Menu.module.css";

export type MenuGroupProps = {
  /** The group's small-caps eyebrow ("Build", "Session"); it labels the group. */
  label?: string;
  children: ReactNode;
};

/** A labelled run of menu items. */
export function MenuGroup({ label, children }: MenuGroupProps) {
  return (
    <BaseMenu.Group>
      {label === undefined ? null : <BaseMenu.GroupLabel className={styles.groupLabel}>{label}</BaseMenu.GroupLabel>}
      {children}
    </BaseMenu.Group>
  );
}
