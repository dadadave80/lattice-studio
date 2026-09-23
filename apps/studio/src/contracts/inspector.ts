/**
 * The inspector's content seam. S5c owns the inspector's frame and renders the view the session names
 * (`session.panes.inspector.view`); views other modules own register their component here, so S5c never
 * imports them: S5d the Init plan (`init`), S12 the problem docs and help (`doc`), S13 Confirm addresses…
 * (`confirm-addresses`). S5c renders `inspectorViewComponent(view.kind)` and shows its own placeholder
 * ("Not built yet · WP-<owner>") while none is registered. Register in the module's `services.ts`; wrap the
 * component in `React.lazy` to keep it in its own chunk.
 */
import type { ComponentType } from "react";
import type { InspectorView } from "./stores";

/** The views that can be routed to explicitly. */
export type InspectorViewKind = NonNullable<InspectorView>["kind"];

/** What a registered view receives: the view with its parameters. */
export type InspectorViewProps<K extends InspectorViewKind = InspectorViewKind> = {
  view: Extract<NonNullable<InspectorView>, { kind: K }>;
};

const views = new Map<InspectorViewKind, ComponentType<InspectorViewProps<never>>>();

/** Registers the component for a view kind. Throws when the kind already has one. Returns a disposer. */
export function registerInspectorView<K extends InspectorViewKind>(
  kind: K,
  component: ComponentType<InspectorViewProps<K>>,
): () => void {
  if (views.has(kind)) throw new Error(`Inspector view ${kind} already has a component.`);
  const stored = component as unknown as ComponentType<InspectorViewProps<never>>;
  views.set(kind, stored);
  return () => {
    if (views.get(kind) === stored) views.delete(kind);
  };
}

/** The component registered for `kind`, or null while its owner hasn't landed. */
export function inspectorViewComponent<K extends InspectorViewKind>(kind: K): ComponentType<InspectorViewProps<K>> | null {
  return (views.get(kind) as ComponentType<InspectorViewProps<K>> | undefined) ?? null;
}
