import type { CSSProperties } from "react";
import { commandRef, useRegion, useSession, type RegionId, type RegionProps } from "@/contracts";
import { ConsolePanel } from "@/panels/console";
import { InspectorPanel } from "@/panels/inspector";
import { Sheet } from "@/sheet/canvas";
import { CommandButton, cx, Splitter } from "@/ui";
import { useNeedsFillIn } from "./fill-in";
import { isDrawerTier, useLayoutTier, useWindowHeight } from "./layout-tier";
import { LeftPane } from "./LeftPane";
import { PaneSwitcher } from "./PaneSwitcher";
import { consoleMax, PANE_SIZES, paneVisibility } from "./panes";
import { setConsoleSize, setInspectorSize, setLeftSize, setPaneOpen } from "./sizes";
import { TitleBar } from "./TitleBar";
import { closeDrawer, onDrawerKeyDown, useDrawerEscape } from "./use-drawer-escape";
import { usePaneFollow } from "./use-pane-follow";
import styles from "./Shell.module.css";

/** Ids the splitters point at (`aria-controls`) and drawers are found by. */
export const PANE_IDS = {
  left: "shell-left",
  sheet: "shell-sheet",
  inspector: "shell-inspector",
  console: "shell-console",
} as const;

function regionProps(region: RegionProps, className: string | undefined): RegionProps {
  return { ...region, className: cx(region.className, className) };
}

function useRegions(): Record<Exclude<RegionId, "toasts">, RegionProps> {
  return {
    titlebar: useRegion("titlebar"),
    left: useRegion("left"),
    sheet: useRegion("sheet"),
    inspector: useRegion("inspector"),
    console: useRegion("console"),
  };
}

/**
 * The frame around the sheet at every width from 320 px (spec L347-L370): the title bar, the left pane, the
 * sheet, the inspector and the console drawer, each a labelled region (S9's F6 stops).
 *
 * Every region stays mounted at every width, in the same place in the tree; a tier or a pane change only
 * hides or moves them, so no pane change ever remounts the sheet or resets its viewport (PA L14, bug 6).
 * Hidden regions carry `hidden`, which also takes them out of F6.
 */
export function Shell() {
  const tier = useLayoutTier();
  const panes = useSession((s) => s.panes);
  const height = useWindowHeight();
  const fillIn = useNeedsFillIn();
  const regions = useRegions();
  usePaneFollow();
  useDrawerEscape(isDrawerTier(tier) ? panes.drawer : null);

  const seen = paneVisibility(panes, tier);
  const phone = tier === "phone";
  const drawers = seen.drawers;
  const maxConsole = consoleMax(height);
  const style = {
    "--shell-left": `${panes.left.size}px`,
    "--shell-inspector": `${panes.inspector.size}px`,
    "--shell-console": `${Math.min(panes.console.size, maxConsole)}px`,
  } as CSSProperties;

  const leftSplitter = !phone && (drawers ? seen.left : seen.sheet);
  const inspectorSplitter = !phone && (drawers ? seen.inspector : seen.sheet);
  const consoleSplitter = !phone && (seen.console === "body" || seen.console === "header");

  return (
    <div
      className={styles.shell}
      data-layout={tier}
      data-console={seen.console}
      data-drawers={drawers ? "" : undefined}
      style={style}
    >
      <header {...regionProps(regions.titlebar, styles.titlebar)}>
        <TitleBar />
        {phone ? <PaneSwitcher /> : null}
      </header>
      <div className={styles.body} hidden={!seen.left && !seen.sheet && !seen.inspector}>
        <aside
          {...regionProps(regions.left, styles.left)}
          id={PANE_IDS.left}
          hidden={!seen.left}
          onKeyDown={drawers ? onDrawerKeyDown : undefined}
        >
          <LeftPane tier={tier} />
        </aside>
        {leftSplitter ? (
          <Splitter
            label="Resize left pane"
            controls={PANE_IDS.left}
            orientation="vertical"
            paneSide="before"
            value={panes.left.size}
            min={PANE_SIZES.left.min}
            max={PANE_SIZES.left.max}
            collapsed={!drawers && !panes.left.open}
            onChange={setLeftSize}
            onCollapsedChange={(collapsed) => (drawers ? collapsed && closeDrawer() : setPaneOpen("left", !collapsed))}
            className={styles.leftSplitter}
          />
        ) : null}
        <main {...regionProps(regions.sheet, styles.sheet)} id={PANE_IDS.sheet} hidden={!seen.sheet}>
          <Sheet />
        </main>
        {inspectorSplitter ? (
          <Splitter
            label="Resize inspector"
            controls={PANE_IDS.inspector}
            orientation="vertical"
            paneSide="after"
            value={panes.inspector.size}
            min={PANE_SIZES.inspector.min}
            max={PANE_SIZES.inspector.max}
            collapsed={!drawers && !panes.inspector.open}
            onChange={setInspectorSize}
            onCollapsedChange={(collapsed) =>
              drawers ? collapsed && closeDrawer() : setPaneOpen("inspector", !collapsed)
            }
            className={styles.inspectorSplitter}
          />
        ) : null}
        <aside
          {...regionProps(regions.inspector, styles.inspector)}
          id={PANE_IDS.inspector}
          hidden={!seen.inspector}
          onKeyDown={drawers ? onDrawerKeyDown : undefined}
        >
          {phone && fillIn ? (
            <div className={styles.fillIn}>
              <CommandButton command={commandRef("init.open")} block>
                Fill in
              </CommandButton>
            </div>
          ) : null}
          <InspectorPanel />
        </aside>
      </div>
      {consoleSplitter ? (
        <Splitter
          label="Resize console"
          controls={PANE_IDS.console}
          orientation="horizontal"
          paneSide="after"
          value={Math.min(panes.console.size, maxConsole)}
          min={PANE_SIZES.console.min}
          max={maxConsole}
          collapsed={seen.console === "header"}
          onChange={setConsoleSize}
          onCollapsedChange={(collapsed) => setPaneOpen("console", !collapsed)}
          className={styles.consoleSplitter}
        />
      ) : null}
      <section {...regionProps(regions.console, styles.console)} id={PANE_IDS.console} hidden={seen.console === "hidden"}>
        <ConsolePanel />
      </section>
    </div>
  );
}
