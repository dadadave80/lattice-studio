/**
 * Focus when panes hide and show (spec L751-L761, WCAG 2.4.3). One place for every way a pane hides: a
 * splitter's Enter or a pane menu's Collapse, `pane.toggle` from the keyboard, Esc on a drawer, a new tier,
 * the switcher. When the pane that held focus (or the splitter that resized it) stops showing, focus goes to
 * that pane's title-bar toggle, else the sheet region, else the first region that shows; never the body.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { session } from "@/contracts";
import type { PaneVisibility } from "./panes";

type PaneId = "left" | "sheet" | "inspector" | "console";

const IDS: Readonly<Record<PaneId, string>> = {
  left: "shell-left",
  sheet: "shell-sheet",
  inspector: "shell-inspector",
  console: "shell-console",
};

/**
 * The title bar's pane toggles sit in an element with this attribute ("catalog", "structure", "inspector"),
 * so focus can go back to the toggle that opened a drawer.
 */
export const DRAWER_TOGGLE_ATTRIBUTE = "data-drawer-toggle";

const FOCUSABLE = ["[tabindex]", "button", "a[href]", "input", "select", "textarea"]
  .map((selector) => `${selector}:not([tabindex='-1'])`)
  .join(", ");

function showing(id: PaneId, seen: PaneVisibility): boolean {
  return id === "console" ? seen.console !== "hidden" : seen[id];
}

function visible(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement && el.isConnected && el.checkVisibility();
}

/** Whether `el` belongs to the pane: inside it, or a splitter that resized it (possibly gone already). */
function belongs(el: HTMLElement, id: PaneId): boolean {
  const pane = document.getElementById(IDS[id]);
  return (pane?.contains(el) ?? false) || el.getAttribute("aria-controls") === IDS[id];
}

/** Where focus goes when `id` hides. */
function target(id: PaneId): HTMLElement | null {
  const key = id === "left" ? session.get().panes.left.tab : id;
  const toggle = document.querySelector(`[${DRAWER_TOGGLE_ATTRIBUTE}="${key}"] button`);
  if (visible(toggle)) return toggle;
  for (const region of ["sheet", "inspector", "left", "console"] as const) {
    const el = document.getElementById(IDS[region]);
    if (region !== id && visible(el)) return el;
  }
  return null;
}

/** Moves focus into a drawer that was just opened from its toggle: its first Tab stop, else the region. */
export function focusDrawer(side: "left" | "inspector"): void {
  const drawer = document.getElementById(IDS[side]);
  if (!visible(drawer)) return;
  const first = [...drawer.querySelectorAll<HTMLElement>(FOCUSABLE)].find(visible);
  (first ?? drawer).focus();
}

/** Keeps focus on screen as panes hide (see the module's comment). */
export function useFocusReturn(seen: PaneVisibility): void {
  const last = useRef<HTMLElement | null>(null);
  const before = useRef(seen);

  useEffect(() => {
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) last.current = event.target;
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);

  useLayoutEffect(() => {
    const previous = before.current;
    before.current = seen;
    const el = last.current;
    // Still on screen (a collapsed pane's splitter at 1280 px and wider): focus stays put.
    if (!el || visible(el)) return;
    for (const id of Object.keys(IDS) as PaneId[]) {
      if (!showing(id, previous) || showing(id, seen) || !belongs(el, id)) continue;
      // Focus already moved somewhere that shows (the switcher's tab, a toggle): leave it there. An element
      // under a pane that just got `hidden` still reports as active until the browser's focus fixup.
      const active = document.activeElement;
      const moved = active instanceof HTMLElement && active !== document.body && active !== el && !belongs(active, id);
      if (moved) return;
      target(id)?.focus({ preventScroll: true });
      return;
    }
  }, [seen]);
}
