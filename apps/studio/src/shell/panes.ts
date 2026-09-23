/**
 * What shows at each tier, and how `pane.show` and `pane.toggle` change it (spec L353-L370, IR L245-L252).
 * Pure: every function takes the session's `panes` and the tier and returns the next `panes` (the same object
 * when nothing changes), so commands, the frame and tests share one definition.
 *
 * - wide: the left pane and the inspector show while `open`; the console's body shows while `open`.
 * - mid and narrow: `drawer` names the one side pane open as an overlay.
 * - phone: `narrow` names the one pane the switcher shows, full size.
 *
 * The console header shows at every tier but phone, where the console is a switcher pane of its own.
 * `maximized` gives the console everything under the title bar; the other panes stay mounted, only hidden.
 */
import type { LeftTab, NarrowPane, SessionState } from "@/contracts";
import type { LayoutTier } from "./layout-tier";

export type Panes = SessionState["panes"];

/** The side panes and the console: what `pane.toggle` takes. */
export type ToggledPane = "left" | "inspector" | "console";

/** Pane sizes in CSS px (spec L356-L359). The console's size is its body, under a 36 px header. */
export const PANE_SIZES = {
  left: { initial: 240, min: 200, max: 360 },
  inspector: { initial: 316, min: 280, max: 420 },
  console: { initial: 124, min: 64, header: 36 },
} as const;

/** The console body's largest size: the header plus the body fill at most half the window's height. */
export function consoleMax(windowHeight: number): number {
  return Math.max(PANE_SIZES.console.initial, Math.floor(windowHeight / 2) - PANE_SIZES.console.header);
}

/** How each region shows now. */
export type PaneVisibility = {
  left: boolean;
  sheet: boolean;
  inspector: boolean;
  /** `body` shows the header and body, `header` only the 36 px header, `full` everything below the title bar. */
  console: "hidden" | "header" | "body" | "full";
  /** The side panes float over the sheet. */
  drawers: boolean;
};

export function paneVisibility(panes: Panes, tier: LayoutTier): PaneVisibility {
  if (tier === "phone") {
    const shown = panes.narrow;
    return {
      left: shown === "catalog" || shown === "structure",
      sheet: shown === "sheet",
      inspector: shown === "inspector",
      console: shown === "console" ? "full" : "hidden",
      drawers: false,
    };
  }
  const console = panes.console.maximized ? "full" : panes.console.open ? "body" : "header";
  const covered = console === "full";
  if (tier === "wide") {
    return { left: !covered && panes.left.open, sheet: !covered, inspector: !covered && panes.inspector.open, console, drawers: false };
  }
  return {
    left: !covered && panes.drawer === "left",
    sheet: !covered,
    inspector: !covered && panes.drawer === "inspector",
    console,
    drawers: true,
  };
}

/** What `pane.show` names. */
export type ShownPane = NarrowPane;

/** Whether a pane shows now (the left pane's tabs count only while that tab is the open one). */
export function paneShowing(panes: Panes, tier: LayoutTier, pane: ShownPane): boolean {
  const seen = paneVisibility(panes, tier);
  switch (pane) {
    case "catalog":
    case "structure":
      return seen.left && panes.left.tab === pane;
    case "sheet":
      return seen.sheet;
    case "inspector":
      return seen.inspector;
    case "console":
      return tier === "phone" ? seen.console === "full" : seen.console === "body" || seen.console === "full";
  }
}

function withLeftTab(panes: Panes, tab: LeftTab): Panes["left"] {
  return panes.left.tab === tab ? panes.left : { ...panes.left, tab };
}

/** Un-maximizes the console so the panes under it show again. */
function uncovered(panes: Panes): Panes {
  return panes.console.maximized ? { ...panes, console: { ...panes.console, maximized: false } } : panes;
}

/** Shows a pane (`pane.show`): opens it, its drawer or its switcher tab. Returns `panes` when it already shows. */
export function showPane(panes: Panes, tier: LayoutTier, pane: ShownPane): Panes {
  if (paneShowing(panes, tier, pane)) return panes;
  if (tier === "phone") {
    const next: Panes = { ...panes, narrow: pane };
    if (pane === "catalog" || pane === "structure") next.left = withLeftTab(panes, pane);
    return next;
  }
  if (pane === "console") return { ...panes, console: { ...panes.console, open: true } };
  const base = uncovered(panes);
  switch (pane) {
    case "sheet":
      return base;
    case "catalog":
    case "structure": {
      const left = withLeftTab(base, pane);
      if (tier === "wide") return { ...base, left: left.open ? left : { ...left, open: true } };
      return { ...base, left, drawer: "left" };
    }
    case "inspector":
      if (tier === "wide") return { ...base, inspector: { ...base.inspector, open: true } };
      return { ...base, drawer: "inspector" };
  }
}

/** Whether a toggled pane shows now. */
export function toggledShowing(panes: Panes, tier: LayoutTier, pane: ToggledPane): boolean {
  if (pane === "left") return paneShowing(panes, tier, panes.left.tab);
  return paneShowing(panes, tier, pane);
}

/** Hides a pane: closes it, its drawer, or (phone) goes back to the sheet. Returns `panes` when it's hidden. */
export function hidePane(panes: Panes, tier: LayoutTier, pane: ToggledPane): Panes {
  if (!toggledShowing(panes, tier, pane)) return panes;
  if (tier === "phone") return { ...panes, narrow: "sheet" };
  if (pane === "console") return { ...panes, console: { ...panes.console, open: false, maximized: false } };
  if (tier !== "wide") return { ...panes, drawer: null };
  return pane === "left"
    ? { ...panes, left: { ...panes.left, open: false } }
    : { ...panes, inspector: { ...panes.inspector, open: false } };
}

/** `pane.toggle`: hides a showing pane, else shows it (the left pane on its current tab). */
export function togglePane(panes: Panes, tier: LayoutTier, pane: ToggledPane): Panes {
  if (toggledShowing(panes, tier, pane)) return hidePane(panes, tier, pane);
  return showPane(panes, tier, pane === "left" ? panes.left.tab : pane);
}

/** How the UI names each pane in messages: "the catalog", "Structure". */
export const PANE_NAMES: Readonly<Record<ShownPane | ToggledPane, string>> = {
  sheet: "the sheet",
  catalog: "the catalog",
  structure: "Structure",
  inspector: "the inspector",
  console: "the console",
  left: "the left pane",
};

/** The pane's name at the start of a sentence. */
export function paneSubject(pane: ShownPane | ToggledPane): string {
  const name = PANE_NAMES[pane];
  return name.charAt(0).toUpperCase() + name.slice(1);
}
