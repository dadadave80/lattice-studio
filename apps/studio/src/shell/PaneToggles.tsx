import { commandRef, runCommand, useSession } from "@/contracts";
import { ToggleButton } from "@/ui";
import type { LayoutTier } from "./layout-tier";
import { paneShowing } from "./panes";
import { DRAWER_TOGGLE_ATTRIBUTE } from "./use-drawer-escape";
import styles from "./TitleBar.module.css";

const TOGGLES = [
  { pane: "catalog", label: "Catalog" },
  { pane: "structure", label: "Structure" },
  { pane: "inspector", label: "Inspector" },
] as const;

/**
 * The pane toggles (IR L68, L249): open the catalog, Structure or the inspector as an overlay drawer, one at a
 * time. Pressing an open one closes its drawer. Shown while the side panes are drawers (768-1279 px).
 */
export function PaneToggles({ tier }: { tier: LayoutTier }) {
  const panes = useSession((s) => s.panes);
  return (
    <fieldset aria-label="Panes" className={styles.toggles}>
      {TOGGLES.map(({ pane, label }) => (
        <span key={pane} {...{ [DRAWER_TOGGLE_ATTRIBUTE]: pane }}>
          <ToggleButton
            size="small"
            pressed={paneShowing(panes, tier, pane)}
            onPressedChange={(open) => {
              const ref = open
                ? commandRef("pane.show", { pane })
                : commandRef("pane.toggle", { pane: pane === "inspector" ? "inspector" : "left" });
              void runCommand(ref, "button");
            }}
          >
            {label}
          </ToggleButton>
        </span>
      ))}
    </fieldset>
  );
}
