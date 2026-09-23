import type { CommandRef } from "@lattice-studio/core";
import { useEffect } from "react";
import { commandRef } from "@/contracts";
import { Button, cx, Menu, MenuCommandItem, MenuItem, MenuSeparator, VisuallyHidden } from "@/ui";
import { retainAppMenu, setAppMenuOpen, useAppMenuOpen } from "./app-menu-state";
import styles from "./TitleBar.module.css";

/**
 * "Open…" opens a project file (⌘O, spec L499). `project.open` takes a stored project's id; S7b decides how
 * it opens a file without one (see the report's CCR).
 */
const OPEN_FILE: CommandRef = { id: "project.open" };

/** The App menu's items, in the spec's order (spec L355, IR L64), each running its command. */
const ITEMS: readonly (readonly [label: string, ref: CommandRef])[] = [
  ["Projects", commandRef("project.list")],
  ["New project", commandRef("project.new")],
  ["Open…", OPEN_FILE],
  ["Save a copy…", commandRef("project.saveCopy")],
];

const HELP_ITEMS: readonly (readonly [label: string, ref: CommandRef])[] = [
  ["Settings", commandRef("settings.open")],
  ["Keyboard shortcuts", commandRef("shortcuts.open")],
  ["Help", commandRef("help.open")],
  ["Take the tour", commandRef("tour.start")],
  ["About", commandRef("about.open")],
];

/** The App menu: the product name opens it; `app.menu` opens it too. */
export function AppMenu({ compact }: { compact: boolean }) {
  const open = useAppMenuOpen();
  useEffect(() => retainAppMenu(), []);
  return (
    <Menu
      label="App menu"
      open={open}
      onOpenChange={setAppMenuOpen}
      trigger={
        <Button variant="quiet" icon="menu" className={cx(styles.brand)}>
          {compact ? <VisuallyHidden>Lattice Studio</VisuallyHidden> : "Lattice Studio"}
        </Button>
      }
    >
      {ITEMS.map(([label, ref]) => (
        <MenuCommandItem key={label} command={ref} label={label} />
      ))}
      <MenuItem label="Open diamond…" disabledReason="Arrives in v2" onSelect={() => undefined} />
      <MenuSeparator />
      {HELP_ITEMS.map(([label, ref]) => (
        <MenuCommandItem key={label} command={ref} label={label} />
      ))}
    </Menu>
  );
}
