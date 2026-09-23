import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type { ReactNode } from "react";
import { cx } from "../shared/cx";
import { ReasonTooltip } from "../tooltip/ReasonTooltip";
import styles from "./Tabs.module.css";

export type TabItem<V extends string = string> = {
  value: V;
  /** Sentence case: "Catalog", "Recipe JSON". */
  label: string;
  /** A count shown after the label, part of the tab's name ("Log 3"). */
  count?: number;
  /** Why the tab can't be opened now. It stays reachable with the arrows, says why, and never activates. */
  disabledReason?: string | null;
};

export type TabsProps<V extends string = string> = {
  /** The tab list's accessible name: "Left pane", "Console". */
  label: string;
  value: V;
  onValueChange: (value: V) => void;
  tabs: readonly TabItem<V>[];
  orientation?: "horizontal" | "vertical";
  /** "medium" is the 40 px pane header (default); "compact" is 28 px. */
  size?: "medium" | "compact";
  /** Share the list's length equally among the tabs, as the left pane's header does. */
  fill?: boolean;
  /** `TabPanel`s, one per tab value. */
  children?: ReactNode;
  className?: string | undefined;
  listClassName?: string | undefined;
};

/**
 * Tabs (APG tabs with automatic activation): the list is one Tab stop; ← → (↑ ↓ when vertical), Home and End
 * move and open. The open tab takes a 2 px accent underline.
 */
export function Tabs<V extends string = string>({
  label, value, onValueChange, tabs, orientation = "horizontal", size = "medium", fill = false, children, className,
  listClassName,
}: TabsProps<V>) {
  const change = (next: unknown, details: { cancel: () => void }) => {
    const tab = tabs.find((item) => item.value === next);
    if (!tab || tab.disabledReason) {
      details.cancel();
      return;
    }
    if (tab.value !== value) onValueChange(tab.value);
  };
  return (
    <BaseTabs.Root
      value={value}
      onValueChange={change}
      orientation={orientation}
      className={cx(styles.root, className)}
    >
      <BaseTabs.List
        aria-label={label}
        activateOnFocus
        className={cx(styles.list, size === "compact" && styles.compact, fill && styles.fill, listClassName)}
      >
        {tabs.map((tab) => (
          <ReasonTooltip key={tab.value} reason={tab.disabledReason}>
            <BaseTabs.Tab value={tab.value} className={styles.tab}>
              <span>{tab.label}</span>
              {tab.count === undefined ? null : <span className={styles.count}>{tab.count}</span>}
            </BaseTabs.Tab>
          </ReasonTooltip>
        ))}
        <BaseTabs.Indicator className={styles.indicator} />
      </BaseTabs.List>
      {children}
    </BaseTabs.Root>
  );
}
