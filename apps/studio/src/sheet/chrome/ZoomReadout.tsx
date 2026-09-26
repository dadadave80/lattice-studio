import { Panel, useStore } from "@xyflow/react";
import { commandRef } from "@/contracts";
import { percent } from "@/sheet/canvas/viewport-math";
import { Button } from "@/ui/buttons/Button";
import { Menu } from "@/ui/overlays/Menu";
import { MenuCommandItem } from "@/ui/overlays/MenuCommandItem";
import { MenuSeparator } from "@/ui/overlays/MenuSeparator";
import { cx } from "@/ui/shared/cx";
import styles from "./chrome.module.css";

/**
 * The zoom readout (IR L111, Flow 8), bottom-left: the sheet's zoom as a percent, read from React Flow's own
 * transform so it follows every glide. It opens 50%, 100% (⇧0), 200%, Fit (⇧1) and Selection (⇧2); each runs
 * S4b's command, so a zoom the view is already at says so.
 */
export function ZoomReadout() {
  const zoom = useStore((s) => s.transform[2]);
  const text = percent(zoom);
  return (
    <Panel position="bottom-left" className={styles.zoomReadout} data-chrome="zoom-readout">
      <Menu
        label="Zoom"
        side="top"
        trigger={
          <Button size="small" variant="quiet" aria-label={`Zoom ${text}`} className={cx(styles.readout)}>
            {text}
          </Button>
        }
      >
        <MenuCommandItem command={commandRef("sheet.zoomTo", { zoom: 0.5 })} label="50%" />
        <MenuCommandItem command={commandRef("sheet.zoom100")} label="100%" />
        <MenuCommandItem command={commandRef("sheet.zoomTo", { zoom: 2 })} label="200%" />
        <MenuSeparator />
        <MenuCommandItem command={commandRef("sheet.zoomFit")} label="Fit" />
        <MenuCommandItem command={commandRef("sheet.zoomSelection")} label="Selection" />
      </Menu>
    </Panel>
  );
}
