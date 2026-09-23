import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { lazy, useEffect, useId, useState } from "react";
import { runCommand, useSession, type ConsoleTab } from "@/contracts";
import { LazyPart } from "@/shell/LazyPart";
import { useWindowHeight } from "@/shell/layout-tier";
import { IconButton } from "@/ui/buttons/IconButton";
import { PaneSizeMenu } from "@/ui/nav/PaneSizeMenu";
import { Chevron } from "./Chevron";
import styles from "./ConsolePanel.module.css";
import { ConsoleSummary } from "./ConsoleSummary";
import { consoleMax, PANE_SIZES, setConsoleOpen, setConsoleSize, showConsoleTab } from "./drawer";
import { ExportMenu } from "./ExportMenu";
import { warmHighlighter } from "./highlight";
import { consoleBodyLoaded, loadConsoleBody } from "./load-body";

/** The Log, the code tabs and the command line: their own chunk, loaded when the drawer first opens (spec L822). */
const ConsoleBody = lazy(() => loadConsoleBody().then((m) => ({ default: m.ConsoleBody })));

const TABS: readonly { value: ConsoleTab; label: string; code: boolean }[] = [
  { value: "log", label: "Log", code: false },
  { value: "script", label: "Script", code: true },
  { value: "recipe", label: "Recipe JSON", code: true },
];

/**
 * The console drawer (spec L359, IR L128-L160): a 36 px header with Collapse/Expand, "Console", the summary and
 * its square, the tabs, the Export menu, the size menu and Maximize; then the Log, Script and Recipe JSON tabs
 * and the command line. Its key context is `console`, so single-key shortcuts stay inert inside it (spec L659).
 *
 * The header is the frame and paints with the app; the body (`ConsoleBody`) is its own chunk, requested after the
 * first paint when the drawer starts open, else when it first opens, and kept mounted from then on.
 */
export function ConsolePanel() {
  const tab = useSession((s) => s.panes.console.tab);
  const open = useSession((s) => s.panes.console.open);
  const size = useSession((s) => s.panes.console.size);
  const maximized = useSession((s) => s.panes.console.maximized);
  const height = useWindowHeight();
  const bodyId = useId();
  const max = consoleMax(height);
  // Once loaded (another mount of the drawer, a console command) the body renders at once; otherwise it waits for
  // an open drawer and a committed first paint, so its chunk never competes with the shell's.
  const [wanted, setWanted] = useState(() => open && consoleBodyLoaded());
  useEffect(() => {
    if (open) setWanted(true);
  }, [open]);

  return (
    <BaseTabs.Root
      className={styles.console}
      value={tab}
      onValueChange={(next: ConsoleTab) => showConsoleTab(next)}
      data-keyctx="console"
      data-open={open ? "" : undefined}
      data-maximized={maximized ? "" : undefined}
    >
      <header className={styles.header}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? "Collapse console" : "Expand console"}
          onClick={() => void runCommand({ id: "console.toggle" }, "button")}
        >
          <Chevron open={open} />
        </button>
        <h2 className={styles.title}>Console</h2>
        <ConsoleSummary />
        <BaseTabs.List className={styles.tabs} aria-label="Console" activateOnFocus>
          {TABS.map((t) => (
            <BaseTabs.Tab
              key={t.value}
              value={t.value}
              className={styles.tab}
              {...(t.code ? { onPointerEnter: warmHighlighter, onFocus: warmHighlighter } : {})}
            >
              {t.label}
            </BaseTabs.Tab>
          ))}
          <BaseTabs.Indicator className={styles.indicator} />
        </BaseTabs.List>
        <span className={styles.spacer} />
        <ExportMenu />
        <PaneSizeMenu
          pane="Console"
          dimension="height"
          value={Math.min(size, max)}
          min={PANE_SIZES.console.min}
          max={max}
          onChange={setConsoleSize}
          onCollapse={() => setConsoleOpen(false)}
        />
        <IconButton
          icon={maximized ? "restore" : "maximize"}
          label={maximized ? "Restore console" : "Maximize console"}
          size="small"
          onClick={() => void runCommand({ id: "console.maximize" }, "button")}
        />
      </header>
      <div className={styles.body} id={bodyId} hidden={!open}>
        {wanted ? (
          <LazyPart>
            <ConsoleBody />
          </LazyPart>
        ) : null}
      </div>
    </BaseTabs.Root>
  );
}
