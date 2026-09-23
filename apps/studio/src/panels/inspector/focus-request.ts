/**
 * Where keyboard focus lands after a command routes the inspector (inspector.show, inspector.focusSelectors,
 * deployments.show, …). The command records a request; the element it names takes focus when it mounts (views
 * load lazily) or, if it's already showing, right away. A request expires after `FOCUS_TTL_MS`, so a view that
 * never mounts (the pane is hidden) can't steal focus later, when someone selects a card.
 */
import { useEffect, type RefObject } from "react";
import { now } from "@/contracts";

export type FocusTarget =
  /** The view's heading. */
  | { kind: "heading" }
  /** The facet view's Selectors list (inspector.focusSelectors, double-clicking a card). */
  | { kind: "selectors"; facet: string }
  /** A section of the Diamond view (deployments.show). */
  | { kind: "section"; section: "deployments" | "authority" | "readiness" };

export const FOCUS_TTL_MS = 3000;

let pending: { target: FocusTarget; at: number } | null = null;
const listeners = new Set<() => void>();

/** Asks the inspector to move focus to `target` once it shows. */
export function requestInspectorFocus(target: FocusTarget): void {
  pending = { target, at: now() };
  for (const listener of Array.from(listeners)) listener();
}

/** The live request, if any (tests). */
export function pendingInspectorFocus(): FocusTarget | null {
  if (pending && now() - pending.at > FOCUS_TTL_MS) pending = null;
  return pending?.target ?? null;
}

/** Forgets any request (tests, and after one is served). */
export function clearInspectorFocus(): void {
  pending = null;
}

function same(a: FocusTarget, b: FocusTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "selectors" && b.kind === "selectors") return a.facet === b.facet;
  if (a.kind === "section" && b.kind === "section") return a.section === b.section;
  return true;
}

/**
 * Focuses `ref` when a request for `target` is pending, now or later. Pass `null` while the element can't take
 * focus yet (its data is still loading).
 */
export function useInspectorFocus(target: FocusTarget | null, ref: RefObject<HTMLElement | null>): void {
  // A string, so a fresh target object each render doesn't re-run the effect.
  const key = target ? JSON.stringify(target) : null;
  useEffect(() => {
    if (key === null) return undefined;
    const mine = JSON.parse(key) as FocusTarget;
    const serve = (): void => {
      const wanted = pendingInspectorFocus();
      const element = ref.current;
      if (!wanted || !element || !same(wanted, mine)) return;
      pending = null;
      element.focus({ preventScroll: true });
      element.scrollIntoView?.({ block: "nearest" });
    };
    // On mount, now. On a later request, after the frame: the command's store update may be about to replace
    // this very view, and focus must land on the one that replaces it, not on this one on its way out.
    let frame = 0;
    const later = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (ref.current?.isConnected) serve();
      });
    };
    serve();
    listeners.add(later);
    return () => {
      cancelAnimationFrame(frame);
      listeners.delete(later);
    };
  }, [key, ref]);
}
