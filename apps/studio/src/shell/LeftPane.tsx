import { commandRef, runCommand, useSession, type LeftTab } from "@/contracts";
import { CatalogPanel } from "@/panels/catalog";
import { StructurePanel } from "@/panels/structure";
import { PaneSizeMenu } from "@/ui/nav/PaneSizeMenu";
import { TabPanel } from "@/ui/nav/TabPanel";
import { Tabs } from "@/ui/nav/Tabs";
import type { LayoutTier } from "./layout-tier";
import { PANE_SIZES } from "./panes";
import { setLeftSize } from "./sizes";
import styles from "./LeftPane.module.css";

const TABS = [
  { value: "catalog", label: "Catalog" },
  { value: "structure", label: "Structure" },
] as const;

/**
 * The left pane (spec L356): tabs Catalog and Structure over `CatalogPanel` and `StructurePanel`, both kept
 * mounted so a tree keeps its place. The header's menu has Narrower, Wider and Collapse (spec L764). Under
 * 768 px the pane switcher picks the tab, so the pane shows only its content.
 */
export function LeftPane({ tier }: { tier: LayoutTier }) {
  const tab = useSession((s) => s.panes.left.tab);
  const size = useSession((s) => s.panes.left.size);
  const phone = tier === "phone";
  return (
    <div className={styles.pane} data-layout={tier}>
      <Tabs<LeftTab>
        label="Left pane"
        value={tab}
        tabs={TABS}
        fill
        onValueChange={(pane) => void runCommand(commandRef("pane.show", { pane }), "button")}
        className={styles.tabs}
        listClassName={styles.list}
      >
        <TabPanel value="catalog" keepMounted className={styles.panel}>
          <CatalogPanel />
        </TabPanel>
        <TabPanel value="structure" keepMounted className={styles.panel}>
          <StructurePanel />
        </TabPanel>
      </Tabs>
      {phone ? null : (
        <div className={styles.menu}>
          <PaneSizeMenu
            pane="Left pane"
            value={size}
            min={PANE_SIZES.left.min}
            max={PANE_SIZES.left.max}
            onChange={setLeftSize}
            onCollapse={() => void runCommand(commandRef("pane.toggle", { pane: "left" }), "menu")}
          />
        </div>
      )}
    </div>
  );
}
