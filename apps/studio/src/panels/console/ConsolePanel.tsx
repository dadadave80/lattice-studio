import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { lazy, useEffect, useId, useSyncExternalStore } from "react";
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
import { consoleBodyLoaded, loadConsoleBody, subscribeConsoleBody } from "./load-body";

/** The Log, the code tabs and the command line: their own chunk, loaded when the drawer first opens (spec L822). */
const ConsoleBody = lazy(() => loadConsoleBody().then((m) => ({ default: m.ConsoleBody })));

/** Pointer or focus on a code tab warms Shiki (spec L822), through the body's chunk that draws the code. */
function warmCode(): void {
  // A body that can't load fails again where it renders; the PWA reports the chunk there (spec L831).
  loadConsoleBody().then((m) => m.warmHighlighter(), () => undefined);
}

const TABS: readonly { value: ConsoleTab; label: string; code: boolean }[] = [
  { value: "log", label: "Log", code: false },
  { value: "script", label: "Script", code: true },
  { value: "recipe", label: "Recipe JSON", code: true },
];

/**
 * The console drawer (spec L359, IR L128-L160): a 36 px header with Collapse/Expand, "Console", the summary and
 * its square, the tabs, the Export menu, the size menu and Maximize; then the Log, Script and Recipe JSON tabs
 * and the command line. Its key context is `console`, so single-key shortcuts stay inert inside it (spec L659),
 * and it's the tour's console coach mark target (spec L400).
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
  // The body renders once its chunk is in. An open drawer requests it after the first paint has committed (so
  // the chunk never competes with the shell's); a command, or a pointer on a code tab or Export, may bring it
  // sooner.
  const loaded = useSyncExternalStore(subscribeConsoleBody, consoleBodyLoaded);
  useEffect(() => {
    // A chunk that fails is the PWA watcher's to report (spec L831); the next open tries again.
    if (open) loadConsoleBody().catch(() => undefined);
  }, [open]);

  return (
    <BaseTabs.Root
      className={styles.console}
      value={tab}
      onValueChange={(next: ConsoleTab) => showConsoleTab(next)}
      data-keyctx="console"
      data-tour="console"
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
              {...(t.code ? { onPointerEnter: warmCode, onFocus: warmCode } : {})}
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
        {loaded ? (
          <LazyPart>
            <ConsoleBody />
          </LazyPart>
        ) : null}
      </div>
    </BaseTabs.Root>
  );
}
