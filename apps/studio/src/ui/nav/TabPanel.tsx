import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";
import { cx } from "../shared/cx";
import styles from "./Tabs.module.css";

export type TabPanelProps = {
  value: string;
  children: ReactNode;
  /** Keep the panel in the DOM while another tab is open (a scroll position or a draft survives). */
  keepMounted?: boolean;
  className?: string | undefined;
};

/** The panel for one tab. Render it inside `Tabs`. */
export function TabPanel({ value, children, keepMounted = false, className }: TabPanelProps) {
  return (
    <BaseTabs.Panel value={value} keepMounted={keepMounted} className={cx(styles.panel, className)}>
      {children}
    </BaseTabs.Panel>
  );
}
