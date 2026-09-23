import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { useId, useSyncExternalStore } from "react";
import { runCommand, useSession, type ConsoleTab } from "@/contracts";
import { IconButton } from "@/ui/buttons/IconButton";
import { PaneSizeMenu } from "@/ui/nav/PaneSizeMenu";
import { cx } from "@/ui/shared/cx";
import { Chevron } from "./Chevron";
import { CodeTab } from "./CodeTab";
import { CommandLine } from "./CommandLine";
import styles from "./ConsolePanel.module.css";
import { ConsoleSummary } from "./ConsoleSummary";
import { CONSOLE_SIZES, consoleMax, setConsoleOpen, setConsoleSize, showConsoleTab } from "./drawer";
import { ExportMenu } from "./ExportMenu";
import { warmHighlighter } from "./highlight";
import { LogView } from "./LogView";

const TABS: readonly { value: ConsoleTab; label: string; code: boolean }[] = [
  { value: "log", label: "Log", code: false },
  { value: "script", label: "Script", code: true },
  { value: "recipe", label: "Recipe JSON", code: true },
];

function subscribeResize(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

const windowHeight = () => window.innerHeight;

/**
 * The console drawer (spec L359, IR L128-L160): a 36 px header with Collapse/Expand, "Console", the summary and
 * its square, the tabs, the Export menu, the size menu and Maximize; then the Log, Script and Recipe JSON tabs
 * and the command line. Its key context is `console`, so single-key shortcuts stay inert inside it (spec L659).
 */
export function ConsolePanel() {
  const tab = useSession((s) => s.panes.console.tab);
  const open = useSession((s) => s.panes.console.open);
  const size = useSession((s) => s.panes.console.size);
  const maximized = useSession((s) => s.panes.console.maximized);
  const height = useSyncExternalStore(subscribeResize, windowHeight, () => 900);
  const bodyId = useId();
  const max = consoleMax(height);

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
          min={CONSOLE_SIZES.min}
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
        <BaseTabs.Panel value="log" keepMounted className={styles.panel}>
          <LogView />
        </BaseTabs.Panel>
        <BaseTabs.Panel value="script" className={cx(styles.panel, styles.codePanel)}>
          <CodeTab kind="script" />
        </BaseTabs.Panel>
        <BaseTabs.Panel value="recipe" className={cx(styles.panel, styles.codePanel)}>
          <CodeTab kind="recipe" />
        </BaseTabs.Panel>
        <CommandLine />
      </div>
    </BaseTabs.Root>
  );
}
