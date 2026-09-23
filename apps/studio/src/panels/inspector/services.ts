/**
 * The inspector follows the selection (contracts §5.1 `InspectorView`: null follows it). A view a command
 * routed here (a catalog preview, a problem, a doc page) gives way when the selection changes on its own, so
 * clicking a card after previewing shows that card. Views that are a task in progress (the Init plan, Confirm
 * addresses…) stay. A command that sets the selection and the view in one update keeps its view.
 * Registration only: discovered eagerly (contracts/discover.ts).
 */
import { session, type InspectorView } from "@/contracts";

const STAYS: ReadonlySet<NonNullable<InspectorView>["kind"]> = new Set(["init", "confirm-addresses"]);

session.subscribe((state, previous) => {
  const view = state.panes.inspector.view;
  if (view === null || STAYS.has(view.kind)) return;
  if (view !== previous.panes.inspector.view) return;
  // Identity, not members: clicking the card that's already selected still brings its facet view back.
  if (state.selection === previous.selection) return;
  session.set((s) => ({ panes: { ...s.panes, inspector: { ...s.panes.inspector, view: null } } }));
});
