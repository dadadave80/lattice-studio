import type { CommandRef } from "@lattice-studio/core";
import { commandRef, useSaveStatus } from "@/contracts";
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
 * The overflow menu (⋯). Under 768 px (spec L370, IR L74): Undo, Redo, Share, Export, the theme, the palette,
 * the tool strip and, while arguments are missing, Fill in. At 768-1023 px (`partial`), where the title bar
 * also holds the pane toggles and Deploy…, only Share, the theme and the palette move here. `saveStatus` puts
 * the save status first, when a crowded title bar has no room for it.
 */
export function OverflowMenu({ saveStatus, partial = false }: { saveStatus: boolean; partial?: boolean }) {
  const fillIn = useNeedsFillIn();
  const status = useSaveStatus();
  return (
    <Menu label="More" align="end" trigger={<IconButton icon="more" label="More" />}>
      {saveStatus ? (
        <>
          {/* The save status, when the crowded bar gave it up: its words, and why, as an item that can't run. */}
          <MenuItem label={status.text} disabledReason={status.detail ?? status.text} onSelect={() => undefined} />
          {status.action ? <MenuCommandItem command={status.action} /> : null}
          <MenuSeparator />
        </>
      ) : null}
      {partial ? null : (
        <>
          <TitledMenuItem command={commandRef("history.undo")} label="Undo" />
          <TitledMenuItem command={commandRef("history.redo")} label="Redo" />
          <MenuSeparator />
        </>
      )}
      <MenuCommandItem command={commandRef("share.copyLink")} label="Share" />
      {partial ? null : (
        <Submenu label="Export">
          {EXPORTS.map(([label, ref]) => (
            <MenuCommandItem key={label} command={ref} label={label} />
          ))}
          <MenuItem label="Image" disabledReason="Arrives in v1.1" onSelect={() => undefined} />
        </Submenu>
      )}
      <Submenu label="Theme">
        <MenuCommandItem command={commandRef("theme.set", { theme: "shop" })} label="Shop" />
        <MenuCommandItem command={commandRef("theme.set", { theme: "draft" })} label="Draft" />
      </Submenu>
      <TitledMenuItem command={commandRef("palette.open")} label="Command palette" />
      {partial ? null : (
        <Submenu label="Tools">
          {TOOLS.map(([label, ref]) => (
            <TitledMenuItem key={label} command={ref} label={label} />
          ))}
        </Submenu>
      )}
      {fillIn && !partial ? <MenuCommandItem command={commandRef("init.open")} label="Fill in" /> : null}
    </Menu>
  );
}
