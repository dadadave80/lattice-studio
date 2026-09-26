import type { CommandRef } from "@lattice-studio/core";
import { Panel } from "@xyflow/react";
import { commandRef, listBindings, runCommand, useCommandState, useSession, useSettings } from "@/contracts";
import { useLayoutTier } from "@/shell/layout-tier";
import type { IconName } from "@/ui/icons/icon-paths";
import { Toolbar } from "@/ui/nav/Toolbar";
import { ToolbarButton } from "@/ui/nav/ToolbarButton";
import { ToolbarGroup } from "@/ui/nav/ToolbarGroup";
import { ToolbarSeparator } from "@/ui/nav/ToolbarSeparator";
import { ARRIVES_V11 } from "./copy";
import styles from "./chrome.module.css";

type ToolProps = { command: CommandRef; icon: IconName; label: string; pressed?: boolean };

/** One button of the strip, bound to its command: its keys, its reason while it can't run, and a click runs it. */
function Tool({ command, icon, label, pressed }: ToolProps) {
  const state = useCommandState(command, "button");
  const keymap = useSettings((s) => s.keymap);
  const keys = listBindings(keymap).find((b) => b.ref.id === command.id && b.ref.args === undefined)?.keys;
  return (
    <ToolbarButton
      icon={icon}
      label={label}
      disabledReason={state.ok ? null : state.reason}
      onClick={() => void runCommand(command, "button")}
      {...(keys?.length ? { shortcut: keys } : {})}
      {...(pressed === undefined ? {} : { pressed })}
    />
  );
}

/**
 * The tool strip (IR L110, spec L357): an APG toolbar, one Tab stop, top-left on the sheet. Select and Hand ·
 * Zoom out, Zoom in and Fit · Init order, Tidy and Auto-layout (v1.1, disabled with its reason) · Minimap. A
 * tool in use, init order mode and the minimap show pressed. Under 768 px it moves into the title bar's
 * overflow menu (spec L370), so the sheet shows none.
 */
export function ToolStrip() {
  const tool = useSession((s) => s.tool);
  const initOrder = useSession((s) => s.modes.initOrder);
  const minimap = useSettings((s) => s.minimap);
  const tier = useLayoutTier();
  if (tier === "phone") return null;
  return (
    <Panel position="top-left" className={styles.toolStrip} data-chrome="tool-strip">
      <Toolbar label="Sheet tools" orientation="vertical">
        <ToolbarGroup>
          <Tool command={commandRef("tool.select")} icon="select" label="Select" pressed={tool === "select"} />
          <Tool command={commandRef("tool.hand")} icon="hand" label="Hand" pressed={tool === "hand"} />
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToolbarGroup>
          <Tool command={commandRef("sheet.zoomOut")} icon="zoom-out" label="Zoom out" />
          <Tool command={commandRef("sheet.zoomIn")} icon="zoom-in" label="Zoom in" />
          <Tool command={commandRef("sheet.zoomFit")} icon="fit" label="Fit" />
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToolbarGroup>
          <Tool command={commandRef("initOrder.toggle")} icon="init-order" label="Init order" pressed={initOrder} />
          <Tool command={commandRef("layout.tidy")} icon="tidy" label="Tidy" />
          <ToolbarButton icon="auto-layout" label="Auto-layout" disabledReason={ARRIVES_V11} />
        </ToolbarGroup>
        <ToolbarSeparator />
        <Tool command={commandRef("sheet.minimapToggle")} icon="minimap" label="Minimap" pressed={minimap} />
      </Toolbar>
    </Panel>
  );
}
