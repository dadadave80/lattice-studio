import type { CommandRef } from "@lattice-studio/core";
import { useEffect } from "react";
import { commandRef } from "@/contracts";
import { Button } from "@/ui/buttons/Button";
import { Menu } from "@/ui/overlays/Menu";
import { MenuCommandItem } from "@/ui/overlays/MenuCommandItem";
import { MenuItem } from "@/ui/overlays/MenuItem";
import { MenuSeparator } from "@/ui/overlays/MenuSeparator";
import { cx } from "@/ui/shared/cx";
import { VisuallyHidden } from "@/ui/shared/VisuallyHidden";
import { retainAppMenu, setAppMenuOpen, useAppMenuOpen } from "./app-menu-state";
import styles from "./TitleBar.module.css";

/** The App menu's items, in the spec's order (spec L355, IR L64), each running its command. */
const ITEMS: readonly (readonly [label: string, ref: CommandRef])[] = [
  ["Projects", commandRef("project.list")],
  ["New project", commandRef("project.new")],
  // Without an id, `project.open` picks a file (⌘O, spec L499).
  ["Open…", commandRef("project.open")],
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
        <Button variant="quiet" icon="menu" size={compact ? "small" : "medium"} className={cx(styles.brand)}>
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
