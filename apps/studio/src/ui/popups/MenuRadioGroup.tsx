import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ReactNode } from "react";
import styles from "../overlays/Menu.module.css";

export type MenuRadioGroupProps = {
  value: string;
  onValueChange: (value: string) => void;
  /** The group's small-caps eyebrow; it labels the group. */
  label?: string;
  children: ReactNode;
};

/** One choice among `MenuRadioItem`s ("Theme: Light, Dark"). */
export function MenuRadioGroup({ value, onValueChange, label, children }: MenuRadioGroupProps) {
  return (
    <BaseMenu.RadioGroup value={value} onValueChange={(next: unknown) => onValueChange(String(next))}>
      {label === undefined ? null : <BaseMenu.GroupLabel className={styles.groupLabel}>{label}</BaseMenu.GroupLabel>}
      {children}
    </BaseMenu.RadioGroup>
  );
}
