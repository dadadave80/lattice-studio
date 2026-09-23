import { commandRef, runCommand, useSession } from "@/contracts";
import { ToggleButton } from "@/ui/fields/ToggleButton";
import { DRAWER_TOGGLE_ATTRIBUTE, focusDrawer } from "./focus-return";
import type { LayoutTier } from "./layout-tier";
import { paneShowing } from "./panes";
import styles from "./TitleBar.module.css";

const TOGGLES = [
  { pane: "catalog", label: "Catalog" },
  { pane: "structure", label: "Structure" },
  { pane: "inspector", label: "Inspector" },
] as const;

/**
 * The pane toggles (IR L68, L249): open the catalog, Structure or the inspector as an overlay drawer, one at a
 * time, and move focus into it; Esc brings focus back here. Pressing an open one closes its drawer. Shown
 * while the side panes are drawers (768-1279 px).
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
              const side = pane === "inspector" ? "inspector" : "left";
              if (!open) {
                void runCommand(commandRef("pane.toggle", { pane: side }), "button");
                return;
              }
              void runCommand(commandRef("pane.show", { pane }), "button").then((done) => {
                if (done.ok) requestAnimationFrame(() => focusDrawer(side));
              });
            }}
          >
            {label}
          </ToggleButton>
        </span>
      ))}
    </fieldset>
  );
}
