/**
 * Regions and F6 (spec L743, IR L16): the title bar, left pane, sheet, inspector and console, and the toasts
 * while any show. `useRegion` registers each container; F6 and ⇧F6 (and Ctrl+F6, Ctrl+⇧F6 on Windows and
 * Linux) cycle them from a capture-phase listener on `window` that stops the event there, because Base UI's
 * toast viewport listens for F6 with any modifier on `window`.
 *
 * The keys are the `region.next` and `region.prev` bindings with the keymap applied, so a remap moves them;
 * this listener is their one handler. Entering a region focuses what last had focus inside it, else the
 * region's container (`tabIndex -1`).
 */
import type { CommandRef } from "@lattice-studio/core";
import {
  commandState, doc, listBindings, REGION_IDS, REGION_LABELS, runCommand, session, type RegionId, type ResolvedBinding,
} from "@/contracts";
import { ensureLiveRegions } from "./announcer";
import { followDocument } from "./focus";
import { currentPlatform, matchesKey } from "./keys";

const elements = new Map<RegionId, HTMLElement>();
/** What last had focus inside each region. */
const lastFocus = new Map<RegionId, HTMLElement>();

/** The registered container of a region, if mounted. */
export function regionElement(id: RegionId): HTMLElement | null {
  const el = elements.get(id);
  return el?.isConnected ? el : null;
}

const refs = new Map<RegionId, (el: HTMLElement | null) => void>();

/** A stable ref callback per region that keeps the registry current. */
export function regionRef(id: RegionId): (el: HTMLElement | null) => void {
  let ref = refs.get(id);
  if (!ref) {
    let mine: HTMLElement | null = null;
    ref = (el) => {
      if (el) {
        mine = el;
        elements.set(id, el);
      } else if (mine && elements.get(id) === mine) {
        elements.delete(id);
        mine = null;
      }
    };
    refs.set(id, ref);
  }
  return ref;
}

function visible(el: Element): boolean {
  if (!el.isConnected || el.closest("[hidden], [inert]")) return false;
  if (typeof el.checkVisibility === "function") return el.checkVisibility({ visibilityProperty: true });
  return el.getClientRects().length > 0;
}

/**
 * Whether toasts show: the toasts region counts while it has at least one visible element inside it (S10's
 * viewport stays mounted and holds one element per toast).
 */
export function toastsShowing(): boolean {
  const el = regionElement("toasts");
  if (!el || !visible(el)) return false;
  return [...el.children].some((child) => visible(child));
}

/** Whether a region can take focus now: mounted and showing; the toasts region only while toasts show. */
export function regionAvailable(id: RegionId): boolean {
  if (id === "toasts") return toastsShowing();
  const el = regionElement(id);
  return !!el && visible(el);
}

/** The F6 stops available now, in order. */
export function availableRegions(): RegionId[] {
  return REGION_IDS.filter(regionAvailable);
}

/** The region holding focus, if any. */
export function currentRegion(active: Element | null = document.activeElement): RegionId | null {
  for (let el = active; el; el = el.parentElement) {
    for (const id of REGION_IDS) if (elements.get(id) === el) return id;
  }
  return null;
}

function focusable(el: HTMLElement): boolean {
  return visible(el) && !el.closest("[aria-hidden='true']") && (el.tabIndex >= 0 || el.hasAttribute("tabindex") || el.isContentEditable);
}

/** Focuses a region: what last had focus in it when that's still there, else its container. False when it isn't showing. */
export function focusRegion(id: RegionId): boolean {
  const el = regionElement(id);
  if (!el || !regionAvailable(id)) return false;
  const last = lastFocus.get(id);
  const target = last && last !== el && el.contains(last) && focusable(last) ? last : el;
  target.focus();
  return document.activeElement === target || target.contains(document.activeElement);
}

/** The region F6 (`step` 1) or ⇧F6 (`step` -1) goes to from where focus is now; null when none shows. */
export function adjacentRegion(step: 1 | -1, from: RegionId | null = currentRegion()): RegionId | null {
  const stops = availableRegions();
  if (!stops.length) return null;
  const at = from === null ? -1 : REGION_IDS.indexOf(from);
  // Walk the full order so a region that just hid still has neighbors.
  for (let i = 1; i <= REGION_IDS.length; i++) {
    const index = at < 0 ? (step === 1 ? i - 1 : REGION_IDS.length - i) : (at + step * i + REGION_IDS.length * 2) % REGION_IDS.length;
    const id = REGION_IDS[index];
    if (id && stops.includes(id)) return id;
  }
  return null;
}

/** Moves to the next or previous region; false when none shows. */
export function cycleRegion(step: 1 | -1): boolean {
  const next = adjacentRegion(step);
  return next !== null && focusRegion(next);
}

/** "the inspector", "the title bar": a region named inside a sentence. */
export function regionPhrase(id: RegionId): string {
  return `the ${REGION_LABELS[id].toLowerCase()}`;
}

// ---------------------------------------------------------------------------------------------------------
// The capture-phase listener

const REGION_COMMANDS = new Set(["region.next", "region.prev"]);

function regionBindings(): ResolvedBinding[] {
  return listBindings().filter((b) => REGION_COMMANDS.has(b.ref.id));
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) return;
  const platform = currentPlatform();
  const binding = regionBindings().find((b) => b.keys.some((k) => matchesKey(k, event, platform)));
  if (!binding) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  const ref: CommandRef = binding.ref;
  void runCommand(ref, "keys");
}

function onFocusIn(event: FocusEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const id = currentRegion(target);
  if (id) lastFocus.set(id, target);
}

let users = 0;
let stopDocument: (() => void) | null = null;

/**
 * Installs the F6 listener, focus tracking, the live regions and focus after delete, undo and redo. Called by
 * each mounted region; the last one to unmount takes them down. Returns the release.
 */
export function retainA11y(): () => void {
  users += 1;
  if (users === 1) {
    ensureLiveRegions();
    window.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("focusin", onFocusIn, { capture: true });
    stopDocument = doc.subscribe(followDocument);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users -= 1;
    if (users === 0) {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      document.removeEventListener("focusin", onFocusIn, { capture: true });
      stopDocument?.();
      stopDocument = null;
      lastFocus.clear();
    }
  };
}

// ---------------------------------------------------------------------------------------------------------
// What the commands do

/** A modal dialog is open: regions are behind it. */
export function dialogReason(): string | null {
  return session.get().dialogs.length ? "A dialog is open. Close it to move between regions." : null;
}

/** The pane that shows a region when it's hidden (drawers, the pane switcher). */
function paneFor(id: RegionId): CommandRef | null {
  switch (id) {
    case "left": return { id: "pane.show", args: { pane: session.get().panes.left.tab } };
    case "sheet": case "inspector": case "console": return { id: "pane.show", args: { pane: id } };
    default: return null;
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * "Go to inspector": focuses the region, first showing its pane when a drawer or the pane switcher hides it.
 * Returns what happened, in the words the console and the status region use.
 */
export async function goToRegion(id: RegionId): Promise<{ ok: boolean; text: string }> {
  if (!regionAvailable(id)) {
    const pane = paneFor(id);
    if (pane && commandState(pane).ok) {
      await runCommand(pane, "api");
      for (let i = 0; i < 10 && !regionAvailable(id); i++) await nextFrame();
    }
  }
  if (focusRegion(id)) return { ok: true, text: "" };
  const phrase = regionPhrase(id);
  return { ok: false, text: `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)} isn't showing.` };
}
