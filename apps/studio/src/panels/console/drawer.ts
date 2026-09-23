/**
 * The console drawer's session state (contracts §5.1 `panes.console`). Size, bounds and open come from S3's shell
 * (`setConsoleSize`, `consoleMax`, `PANE_SIZES`, `setPaneOpen`), imported by module so the shell's barrel, which
 * renders this panel, isn't a cycle. Maximize and the tab are the console's own.
 */
import { session, type ConsoleTab } from "@/contracts";
import { setPaneOpen } from "@/shell/sizes";

export { consoleMax, PANE_SIZES } from "@/shell/panes";
export { setConsoleSize } from "@/shell/sizes";

type ConsolePane = ReturnType<typeof session.get>["panes"]["console"];

function patch(change: (pane: ConsolePane) => Partial<ConsolePane>): void {
  session.set((s) => {
    const next = { ...s.panes.console, ...change(s.panes.console) };
    const same = (Object.keys(next) as (keyof ConsolePane)[]).every((k) => next[k] === s.panes.console[k]);
    return same ? s : { panes: { ...s.panes, console: next } };
  });
}

/** Collapses to the header, or opens the body. Collapsing also leaves Maximize. */
export function setConsoleOpen(open: boolean): void {
  if (!open) patch(() => ({ maximized: false }));
  setPaneOpen("console", open);
}

/** Sets `panes.console.maximized`; maximizing opens the body. */
export function setConsoleMaximized(maximized: boolean): void {
  patch(() => (maximized ? { maximized, open: true } : { maximized }));
}

/** Shows a tab, opening the drawer; `maximize` also maximizes it (Export → Foundry script, spec L513). */
export function showConsoleTab(tab: ConsoleTab, maximize = false): void {
  patch(() => ({ tab, open: true, ...(maximize ? { maximized: true } : {}) }));
}
