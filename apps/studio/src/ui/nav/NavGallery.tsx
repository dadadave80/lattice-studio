import { useState } from "react";
import { GallerySection, Specimen } from "../gallery/GallerySection";
import { PaneSizeMenu } from "./PaneSizeMenu";
import { Splitter } from "./Splitter";
import { TabPanel, Tabs } from "./Tabs";
import { Toolbar, ToolbarGroup, ToolbarSeparator } from "./Toolbar";
import { ToolbarButton } from "./ToolbarButton";
import { Tree } from "./Tree";
import type { TreeNode } from "./tree-model";
import styles from "./NavGallery.module.css";

const SELECTORS: Record<string, [signature: string, hex: string][]> = {
  GovernedVault: [
    ["transfer(address,uint256)", "0xa9059cbb"],
    ["transferFrom(address,address,uint256)", "0x23b872dd"],
    ["clock()", "0x91ddadf4"],
    ["CLOCK_MODE()", "0x4bf5d7e9"],
  ],
  ERC20: [
    ["totalSupply()", "0x18160ddd"],
    ["balanceOf(address)", "0x70a08231"],
    ["approve(address,uint256)", "0x095ea7b3"],
    ["allowance(address,address)", "0xdd62ed3e"],
  ],
  ERC4626: [
    ["asset()", "0x38d52e0f"],
    ["convertToAssets(uint256)", "0x07a2d13a"],
    ["convertToShares(uint256)", "0xc6e6f592"],
    ["deposit(uint256,address)", "0x6e553f65"],
    ["maxDeposit(address)", "0x402d267d"],
  ],
};

const HEX = new Map<string, string>();

const FACETS: TreeNode[] = Object.entries(SELECTORS).map(([facet, list]) => ({
  id: facet,
  label: facet,
  children: list.map(([signature, hex]) => {
    const id = `${facet}.${hex}`;
    HEX.set(id, hex);
    return {
      id,
      label: signature,
      ...(facet === "ERC20" && hex === "0x18160ddd" ? { disabledReason: "Served by GovernedVault" } : {}),
    };
  }),
}));

const LARGE: TreeNode[] = Array.from({ length: 40 }, (_, f) => {
  const facet = `Facet${String(f + 1).padStart(2, "0")}`;
  return {
    id: facet,
    label: facet,
    children: Array.from({ length: 24 }, (_, s) => ({ id: `${facet}.${s}`, label: `${facet.toLowerCase()}Call${s + 1}(uint256)` })),
  };
});
const LARGE_EXPANDED = LARGE.map((node) => node.id);

function SelectorItem({ node }: { node: TreeNode }) {
  const hex = HEX.get(node.id);
  if (!hex) {
    const count = node.children?.length ?? 0;
    return (
      <>
        <span>{node.label}</span>
        <span className={styles.muted}>{count === 1 ? "1 selector" : `${count} selectors`}</span>
      </>
    );
  }
  return (
    <>
      <span className={styles.code}>{node.label}</span>
      <span className={styles.hex}>{hex}</span>
    </>
  );
}

function TabsSpecimens() {
  const [pane, setPane] = useState<"catalog" | "structure">("catalog");
  const [output, setOutput] = useState<"log" | "script" | "json">("log");
  const [narrow, setNarrow] = useState("sheet");
  return (
    <GallerySection title="Tabs">
      <Specimen label="Default">
        <div className={styles.pane}>
          <Tabs
            label="Left pane"
            value={pane}
            onValueChange={setPane}
            fill
            tabs={[{ value: "catalog", label: "Catalog" }, { value: "structure", label: "Structure" }]}
          >
            <TabPanel value="catalog" className={styles.panel}>Search, area folders and facets.</TabPanel>
            <TabPanel value="structure" className={styles.panel}>The diamond as a tree.</TabPanel>
          </Tabs>
        </div>
      </Specimen>
      <Specimen label="With a count, and disabled with a reason">
        <div className={styles.wide}>
          <Tabs
            label="Console"
            value={output}
            onValueChange={setOutput}
            size="compact"
            tabs={[
              { value: "log", label: "Log", count: 3 },
              { value: "script", label: "Script", disabledReason: "Place facets first" },
              { value: "json", label: "Recipe JSON" },
            ]}
          >
            <TabPanel value="log" className={styles.panel}>Loaded recipe GovernedVault.</TabPanel>
            <TabPanel value="script" className={styles.panel}>No script yet.</TabPanel>
            <TabPanel value="json" className={styles.panel}>The recipe as JSON.</TabPanel>
          </Tabs>
        </div>
      </Specimen>
      <Specimen label="Compact">
        <Tabs
          label="Panes"
          value={narrow}
          onValueChange={setNarrow}
          size="compact"
          tabs={["Sheet", "Structure", "Catalog", "Inspector", "Console"].map((name) => ({
            value: name.toLowerCase(), label: name,
          }))}
        />
      </Specimen>
    </GallerySection>
  );
}

function ToolbarSpecimens() {
  const [tool, setTool] = useState<"select" | "hand">("select");
  const [initOrder, setInitOrder] = useState(false);
  return (
    <GallerySection title="Toolbar">
      <Specimen label="Vertical, with a pressed tool and a disabled button">
        <Toolbar label="Sheet tools" orientation="vertical">
          <ToolbarGroup>
            <ToolbarButton icon="select" label="Select" pressed={tool === "select"} onClick={() => setTool("select")} />
            <ToolbarButton icon="hand" label="Hand" pressed={tool === "hand"} onClick={() => setTool("hand")} />
          </ToolbarGroup>
          <ToolbarSeparator />
          <ToolbarGroup>
            <ToolbarButton icon="zoom-out" label="Zoom out" shortcut="-" />
            <ToolbarButton icon="zoom-in" label="Zoom in" shortcut="=" />
            <ToolbarButton icon="fit" label="Fit" shortcut="Shift+[Digit1]" />
          </ToolbarGroup>
          <ToolbarSeparator />
          <ToolbarGroup>
            <ToolbarButton
              icon="init-order"
              label="Init order"
              shortcut="i"
              pressed={initOrder}
              onClick={() => setInitOrder(!initOrder)}
            />
            <ToolbarButton icon="tidy" label="Tidy" shortcut="t" disabledReason="Place facets first" />
          </ToolbarGroup>
        </Toolbar>
      </Specimen>
      <Specimen label="Horizontal">
        <Toolbar label="Edit">
          <ToolbarButton icon="undo" label="Undo" shortcut="Mod+z" />
          <ToolbarButton icon="redo" label="Redo" shortcut="Mod+Shift+z" disabledReason="Nothing to redo" />
          <ToolbarSeparator />
          <ToolbarButton icon="minimap" label="Minimap" pressed={false} />
        </Toolbar>
      </Specimen>
    </GallerySection>
  );
}

function TreeSpecimens() {
  const [expanded, setExpanded] = useState<string[]>(["GovernedVault"]);
  const [selected, setSelected] = useState<string[]>(["GovernedVault.0xa9059cbb"]);
  const [multiExpanded, setMultiExpanded] = useState<string[]>(["ERC20", "ERC4626"]);
  const [multiSelected, setMultiSelected] = useState<string[]>(["ERC4626.0x38d52e0f", "ERC4626.0x6e553f65"]);
  const [largeExpanded, setLargeExpanded] = useState<string[]>(LARGE_EXPANDED);
  const [largeSelected, setLargeSelected] = useState<string[]>([]);
  return (
    <GallerySection title="Tree">
      <Specimen label="One expanded, one selected">
        <Tree
          label="Structure"
          className={styles.tree}
          nodes={FACETS}
          expanded={expanded}
          onExpandedChange={setExpanded}
          selected={selected}
          onSelectedChange={setSelected}
          renderItem={(node) => <SelectorItem node={node} />}
        />
      </Specimen>
      <Specimen label="Multi-select, with a disabled selector">
        <Tree
          label="Structure, multi-select"
          className={styles.tree}
          nodes={FACETS}
          expanded={multiExpanded}
          onExpandedChange={setMultiExpanded}
          selected={multiSelected}
          onSelectedChange={setMultiSelected}
          multiSelect
          renderItem={(node) => <SelectorItem node={node} />}
        />
      </Specimen>
      <Specimen label="1000 rows, virtualized">
        <Tree
          label="Large tree"
          className={styles.largeTree}
          nodes={LARGE}
          expanded={largeExpanded}
          onExpandedChange={setLargeExpanded}
          selected={largeSelected}
          onSelectedChange={setLargeSelected}
        />
      </Specimen>
    </GallerySection>
  );
}

function SplitterSpecimens() {
  const [left, setLeft] = useState(240);
  const [inspector, setInspector] = useState(316);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  const [drawer, setDrawer] = useState(124);
  return (
    <GallerySection title="Splitter">
      <Specimen label="Vertical, and one collapsed">
        <div className={styles.frame}>
          <div id="gallery-left-pane" className={styles.side} style={{ inlineSize: left }}>
            Left pane · {left} px
          </div>
          <Splitter
            label="Resize left pane"
            controls="gallery-left-pane"
            orientation="vertical"
            paneSide="before"
            value={left}
            min={200}
            max={360}
            onChange={setLeft}
          />
          <div className={styles.fill}>Sheet</div>
          <Splitter
            label="Resize inspector"
            controls="gallery-inspector"
            orientation="vertical"
            paneSide="after"
            value={inspector}
            min={280}
            max={420}
            onChange={setInspector}
            collapsed={inspectorCollapsed}
            onCollapsedChange={setInspectorCollapsed}
          />
          <div
            id="gallery-inspector"
            className={styles.side}
            style={{ inlineSize: inspectorCollapsed ? 0 : inspector }}
            hidden={inspectorCollapsed}
          >
            Inspector · {inspector} px
          </div>
        </div>
      </Specimen>
      <Specimen label="Pane header menu: Narrower, Wider, Collapse">
        <PaneSizeMenu
          pane="Inspector"
          value={inspector}
          min={280}
          max={420}
          onChange={setInspector}
          onCollapse={() => setInspectorCollapsed(true)}
        />
      </Specimen>
      <Specimen label="Horizontal">
        <div className={styles.column}>
          <div className={styles.fill}>Sheet</div>
          <Splitter
            label="Resize console"
            controls="gallery-console"
            orientation="horizontal"
            paneSide="after"
            value={drawer}
            min={36}
            max={240}
            onChange={setDrawer}
          />
          <div id="gallery-console" className={styles.bottom} style={{ blockSize: drawer }}>
            Console · {drawer} px
          </div>
        </div>
      </Specimen>
    </GallerySection>
  );
}

/** The navigation primitives in the `#/__ui` gallery: tabs, toolbars, trees and splitters. */
export function NavGallery() {
  return (
    <>
      <TabsSpecimens />
      <ToolbarSpecimens />
      <TreeSpecimens />
      <SplitterSpecimens />
    </>
  );
}
