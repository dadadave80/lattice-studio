/**
 * The inspector follows the selection (contracts §5.1 `InspectorView`: null follows it). A view a command
 * routed here (a catalog preview, a problem, a doc page) gives way when the selection changes on its own, so
 * clicking a card after previewing shows that card. Views that are a task in progress (the Init plan, Confirm
 * addresses…) stay. A command that routes the view and changes the selection in the same task (one update or
 * two, in either order: F8 selects the card and shows its problem) keeps its view.
 * Registration only: discovered eagerly (contracts/discover.ts).
 */
import { session, type InspectorView } from "@/contracts";

const STAYS: ReadonlySet<NonNullable<InspectorView>["kind"]> = new Set(["init", "confirm-addresses"]);

/** Set while the view was routed during the current task; cleared once the task's updates are done. */
let routedThisTask = false;

session.subscribe((state, previous) => {
  const view = state.panes.inspector.view;
  if (view !== previous.panes.inspector.view) {
    if (view !== null && !routedThisTask) {
      routedThisTask = true;
      queueMicrotask(() => {
        routedThisTask = false;
      });
    }
    return;
  }
  if (view === null || STAYS.has(view.kind) || routedThisTask) return;
  // Identity, not members: clicking the card that's already selected still brings its facet view back.
  if (state.selection === previous.selection) return;
  session.set((s) => ({ panes: { ...s.panes, inspector: { ...s.panes.inspector, view: null } } }));
});
