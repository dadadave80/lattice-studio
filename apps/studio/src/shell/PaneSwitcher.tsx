import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { commandRef, runCommand, useDocument, useSession, type NarrowPane } from "@/contracts";
import { Tabs } from "@/ui/nav/Tabs";
import { useTitleNameHidden } from "./title-name";
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

/** Which ends of the tab row are cut off: where it shows a fade, so the row reads as one that scrolls. */
type Cut = { start: boolean; end: boolean };

/**
 * The pane switcher under 768 px (spec L370, IR L250): Sheet · Structure · Catalog · Inspector · Console, as
 * tabs, each pointing at the region it shows. Each runs `pane.show`, so the palette, "Go to …" and the switcher
 * agree. When the row is wider than the bar it scrolls, fades at the cut edge, and brings the open tab into view;
 * when the title bar has given up the project name, the Sheet tab carries it.
 */
export function PaneSwitcher() {
  const shown = useSession((s) => s.panes.narrow);
  const name = useDocument((s) => s.project.name);
  const nameHidden = useTitleNameHidden();
  const root = useRef<HTMLDivElement>(null);
  const [cut, setCut] = useState<Cut>({ start: false, end: false });
  useEffect(() => {
    // The regions are the tab panels; S0's Tabs has no prop for a tab's aria-controls.
    const tabs = root.current?.querySelectorAll("[role='tab']") ?? [];
    tabs.forEach((tab, i) => {
      const pane = PANES[i]?.value;
      if (pane) tab.setAttribute("aria-controls", CONTROLS[pane]);
    });
  });
  useLayoutEffect(() => {
    const list = root.current?.querySelector<HTMLElement>("[role='tablist']");
    if (!list) return;
    const measure = () => {
      const start = list.scrollLeft > 0.5;
      const end = list.scrollLeft + list.clientWidth < list.scrollWidth - 0.5;
      setCut((now) => (now.start === start && now.end === end ? now : { start, end }));
    };
    measure();
    list.addEventListener("scroll", measure, { passive: true });
    const sizes = new ResizeObserver(measure);
    sizes.observe(list);
    return () => {
      list.removeEventListener("scroll", measure);
      sizes.disconnect();
    };
  }, [nameHidden, name]);
  useEffect(() => {
    root.current?.querySelector("[role='tab'][aria-selected='true']")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [shown, nameHidden]);
  const tabs = PANES.map((tab) => (tab.value === "sheet" && nameHidden ? { ...tab, label: `Sheet · ${name}` } : tab));
  return (
    <div
      ref={root}
      className={styles.switcher}
      data-cut-start={cut.start ? "" : undefined}
      data-cut-end={cut.end ? "" : undefined}
    >
      <Tabs<NarrowPane>
        label="Panes"
        size="compact"
        fill
        value={shown}
        tabs={tabs}
        listClassName={styles.switcherList}
        onValueChange={(pane) => void runCommand(commandRef("pane.show", { pane }), "button")}
      />
    </div>
  );
}
