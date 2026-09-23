/**
 * What the panes do on their own as the window and the session change (spec L367-L370):
 *
 * - 1024-1279 px: the inspector opens on selection.
 * - Below 1280 px: a view routed to the inspector (a problem, a doc page, the init plan) opens its drawer or,
 *   under 768 px, its switcher tab, so the thing asked for shows.
 * - 768-1023 px: the console collapses to its summary line on arrival, and comes back as it was once the
 *   window is 1024 px or wider again.
 */
import { useEffect } from "react";
import { session, type SessionState } from "@/contracts";
import { currentTier, subscribeWindowSize, type LayoutTier } from "./layout-tier";
import { showPane } from "./panes";

function sameSelection(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

/** Whether the inspector was asked for: a view routed to it, or it was opened. */
function inspectorAsked(next: SessionState, previous: SessionState): boolean {
  const now = next.panes.inspector;
  const before = previous.panes.inspector;
  return (now.view !== before.view && now.view !== null) || (now.open && !before.open);
}

export function usePaneFollow(): void {
  useEffect(() => {
    let tier: LayoutTier = currentTier();
    /** The console's open state before 768-1023 px collapsed it; null while nothing is held. */
    let consoleBefore: boolean | null = null;

    const setConsoleOpen = (open: boolean) =>
      session.set((s) =>
        s.panes.console.open === open ? s : { panes: { ...s.panes, console: { ...s.panes.console, open } } },
      );

    const arrive = (next: LayoutTier, previous: LayoutTier | null) => {
      if (next === "narrow" && previous !== "narrow") {
        if (consoleBefore === null) consoleBefore = session.get().panes.console.open;
        setConsoleOpen(false);
      } else if ((next === "wide" || next === "mid") && consoleBefore !== null) {
        setConsoleOpen(consoleBefore);
        consoleBefore = null;
      }
    };
    arrive(tier, null);

    const stopSize = subscribeWindowSize(() => {
      const next = currentTier();
      if (next === tier) return;
      const previous = tier;
      tier = next;
      arrive(next, previous);
    });

    const stopSession = session.subscribe((next, previous) => {
      if (tier === "wide") return;
      const selected =
        tier === "mid" && next.selection.length > 0 && !sameSelection(next.selection, previous.selection);
      if (!selected && !inspectorAsked(next, previous)) return;
      const panes = showPane(next.panes, tier, "inspector");
      if (panes !== next.panes) session.set({ panes });
    });

    return () => {
      stopSize();
      stopSession();
    };
  }, []);
}
