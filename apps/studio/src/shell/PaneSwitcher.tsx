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

/**
 * The pane switcher under 768 px (spec L370, IR L250): Sheet · Structure · Catalog · Inspector · Console, as
 * tabs. Each runs `pane.show`, so the palette, "Go to …" and the switcher agree.
 */
export function PaneSwitcher() {
  const shown = useSession((s) => s.panes.narrow);
  return (
    <Tabs<NarrowPane>
      label="Panes"
      size="compact"
      fill
      value={shown}
      tabs={PANES}
      onValueChange={(pane) => void runCommand(commandRef("pane.show", { pane }), "button")}
      className={styles.switcher}
    />
  );
}
