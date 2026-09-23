/**
 * Keeps keyboard focus in the inspector when an action inside it replaces the view: Remove in the Facet or
 * Selection view, a fix that resolves the Problem view's problem, Place on sheet in a catalog preview. The
 * control that had focus unmounts with its view; without this, focus falls to `<body>`. When the view changes
 * while focus was inside the body and nothing else claimed it (no pending request, focus not moved elsewhere),
 * the new view's heading takes it.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { pendingInspectorFocus, requestInspectorFocus } from "./focus-request";

function lost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body;
}

export function useFocusRecovery(body: RefObject<HTMLElement | null>, viewKey: string): void {
  /** Whether focus was last inside the body. An element removed while focused leaves it true. */
  const inside = useRef(false);

  useEffect(() => {
    const element = body.current;
    if (!element) return undefined;
    const onIn = (): void => {
      inside.current = true;
    };
    const onOut = (event: FocusEvent): void => {
      const target = event.target;
      const next = event.relatedTarget;
      if (next instanceof Node && element.contains(next)) return;
      // Removal fires focusout too: decide once the removal is done. A removed target keeps "inside".
      queueMicrotask(() => {
        if (target instanceof Node && !target.isConnected) return;
        inside.current = element.contains(document.activeElement);
      });
    };
    element.addEventListener("focusin", onIn);
    element.addEventListener("focusout", onOut);
    return () => {
      element.removeEventListener("focusin", onIn);
      element.removeEventListener("focusout", onOut);
    };
  }, [body]);

  const previous = useRef(viewKey);
  useLayoutEffect(() => {
    if (previous.current === viewKey) return;
    previous.current = viewKey;
    if (!inside.current || pendingInspectorFocus() !== null) return;
    // After the browser settles focus for the removal (and any other module's own focus move).
    queueMicrotask(() => {
      if (lost() && pendingInspectorFocus() === null) requestInspectorFocus({ kind: "heading" });
    });
  }, [viewKey]);
}
