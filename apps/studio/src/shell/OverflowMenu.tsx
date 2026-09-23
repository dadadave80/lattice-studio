import type { CommandRef } from "@lattice-studio/core";
import { commandRef } from "@/contracts";
import { IconButton, Menu, MenuCommandItem, MenuItem, MenuSeparator, Submenu } from "@/ui";
import { useNeedsFillIn } from "./fill-in";
import { TitledMenuItem } from "./TitledMenuItem";

type Item = readonly [label: string, ref: CommandRef];

/** The console's Export menu (IR L132), by the names it gives them. */
const EXPORTS: readonly Item[] = [
  ["Foundry script", commandRef("export.foundry")],
  ["Agent brief", commandRef("export.brief")],
  ["Recipe JSON", commandRef("export.recipeJson")],
  ["Project file", commandRef("project.exportFile")],
  ["Safe batch…", commandRef("export.safe")],
];

/** The sheet's tool strip (spec L357), as menu items. */
const TOOLS: readonly Item[] = [
  ["Select tool", commandRef("tool.select")],
  ["Hand tool", commandRef("tool.hand")],
  ["Zoom in", commandRef("sheet.zoomIn")],
  ["Zoom out", commandRef("sheet.zoomOut")],
  ["Fit", commandRef("sheet.zoomFit")],
  ["Tidy", commandRef("layout.tidy")],
  ["Init order", commandRef("initOrder.toggle")],
];

/**
 * The overflow menu under 768 px (spec L370, IR L74): Undo, Redo, Share, Export, the theme, the palette, the
 * tool strip and, while arguments are missing, Fill in.
 */
export function OverflowMenu() {
  const fillIn = useNeedsFillIn();
  return (
    <Menu label="More" align="end" trigger={<IconButton icon="more" label="More" />}>
      <TitledMenuItem command={commandRef("history.undo")} label="Undo" />
      <TitledMenuItem command={commandRef("history.redo")} label="Redo" />
      <MenuSeparator />
      <MenuCommandItem command={commandRef("share.copyLink")} label="Share" />
      <Submenu label="Export">
        {EXPORTS.map(([label, ref]) => (
          <MenuCommandItem key={label} command={ref} label={label} />
        ))}
        <MenuItem label="Image" disabledReason="Arrives in v1.1" onSelect={() => undefined} />
      </Submenu>
      <Submenu label="Theme">
        <MenuCommandItem command={commandRef("theme.set", { theme: "shop" })} label="Shop" />
        <MenuCommandItem command={commandRef("theme.set", { theme: "draft" })} label="Draft" />
      </Submenu>
      <TitledMenuItem command={commandRef("palette.open")} label="Command palette" />
      <Submenu label="Tools">
        {TOOLS.map(([label, ref]) => (
          <TitledMenuItem key={label} command={ref} label={label} />
        ))}
      </Submenu>
      {fillIn ? <MenuCommandItem command={commandRef("init.open")} label="Fill in" /> : null}
    </Menu>
  );
}
