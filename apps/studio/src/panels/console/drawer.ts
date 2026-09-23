/**
 * The console drawer's session state (contracts §5.1 `panes.console`): open, tab, size and maximized. The
 * bounds follow spec L359 (a 36 px header over a 124 px body, resizable to half the window's height). S3's
 * `@/shell` exports the same helpers (`setConsoleSize`, `consoleMax`, `PANE_SIZES`); it isn't in this work
 * package's base yet, so these stand in until it is (listed in WP-S5e's report).
 */
import { session, type ConsoleTab } from "@/contracts";

export const CONSOLE_SIZES = { initial: 124, min: 64, header: 36 } as const;

/** The body's largest size: the header plus the body fill at most half the window's height. */
export function consoleMax(windowHeight: number): number {
  return Math.max(CONSOLE_SIZES.initial, Math.floor(windowHeight / 2) - CONSOLE_SIZES.header);
}

type ConsolePane = ReturnType<typeof session.get>["panes"]["console"];

function patch(change: (pane: ConsolePane) => Partial<ConsolePane>): void {
  session.set((s) => {
    const next = { ...s.panes.console, ...change(s.panes.console) };
    const same = (Object.keys(next) as (keyof ConsolePane)[]).every((k) => next[k] === s.panes.console[k]);
    return same ? s : { panes: { ...s.panes, console: next } };
  });
}

export function setConsoleSize(size: number): void {
  patch(() => ({ size }));
}

export function setConsoleOpen(open: boolean): void {
  patch((pane) => (open ? { open } : { open, maximized: pane.maximized && open }));
}

export function setConsoleMaximized(maximized: boolean): void {
  patch(() => (maximized ? { maximized, open: true } : { maximized }));
}

/** Shows a tab, opening the drawer; `maximize` also maximizes it (Export → Foundry script, spec L513). */
export function showConsoleTab(tab: ConsoleTab, maximize = false): void {
  patch(() => ({ tab, open: true, ...(maximize ? { maximized: true } : {}) }));
}
