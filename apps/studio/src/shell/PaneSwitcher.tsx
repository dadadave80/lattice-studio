import { useEffect, useRef } from "react";
import { commandRef, runCommand, useSession, type NarrowPane } from "@/contracts";
import { Tabs } from "@/ui";
import styles from "./TitleBar.module.css";

const PANES = [
  { value: "sheet", label: "Sheet" },
  { value: "structure", label: "Structure" },
  { value: "catalog", label: "Catalog" },
  { value: "inspector", label: "Inspector" },
  { value: "console", label: "Console" },
] as const satisfies readonly { value: NarrowPane; label: string }[];

/** The region each tab shows (Shell's `PANE_IDS`); Structure and Catalog share the left pane. */
const CONTROLS: Readonly<Record<NarrowPane, string>> = {
  sheet: "shell-sheet",
  structure: "shell-left",
  catalog: "shell-left",
  inspector: "shell-inspector",
  console: "shell-console",
};

/**
 * The pane switcher under 768 px (spec L370, IR L250): Sheet · Structure · Catalog · Inspector · Console, as
 * tabs, each pointing at the region it shows. Each runs `pane.show`, so the palette, "Go to …" and the switcher
 * agree.
 */
export function PaneSwitcher() {
  const shown = useSession((s) => s.panes.narrow);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The regions are the tab panels; S0's Tabs has no prop for a tab's aria-controls.
    const tabs = root.current?.querySelectorAll("[role='tab']") ?? [];
    tabs.forEach((tab, i) => {
      const pane = PANES[i]?.value;
      if (pane) tab.setAttribute("aria-controls", CONTROLS[pane]);
    });
  });
  return (
    <div ref={root} className={styles.switcher}>
      <Tabs<NarrowPane>
        label="Panes"
        size="compact"
        fill
        value={shown}
        tabs={PANES}
        onValueChange={(pane) => void runCommand(commandRef("pane.show", { pane }), "button")}
      />
    </div>
  );
}
