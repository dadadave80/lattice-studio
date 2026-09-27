import { commandRef, runCommand, useSession } from "@/contracts";
import { InspectorPanel } from "@/panels/inspector";
import { PaneSizeMenu } from "@/ui/nav/PaneSizeMenu";
import type { LayoutTier } from "./layout-tier";
import { PANE_SIZES } from "./panes";
import { setInspectorSize } from "./sizes";
import styles from "./InspectorPane.module.css";

/**
 * The inspector pane (spec L358): a 36 px header, like the console's, whose menu has Narrower, Wider and
 * Collapse (spec L764), over S5c's `InspectorPanel`. The header has no board yet (PA L72-L84); it follows the
 * console drawer's header row. Under 768 px the pane switcher shows the pane full size, so there's nothing to
 * resize and the header goes.
 */
export function InspectorPane({ tier }: { tier: LayoutTier }) {
  const size = useSession((s) => s.panes.inspector.size);
  return (
    <div className={styles.pane}>
      {tier === "phone" ? null : (
        <div className={styles.header}>
          <span className={styles.eyebrow} aria-hidden="true">
            Inspector
          </span>
          <PaneSizeMenu
            pane="Inspector"
            value={size}
            min={PANE_SIZES.inspector.min}
            max={PANE_SIZES.inspector.max}
            onChange={setInspectorSize}
            onCollapse={() => void runCommand(commandRef("pane.toggle", { pane: "inspector" }), "menu")}
          />
        </div>
      )}
      <div className={styles.body}>
        <InspectorPanel />
      </div>
    </div>
  );
}
