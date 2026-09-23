/**
 * Pane sizes and open states set from splitters and pane menus. They live in the session (contracts §5.1),
 * never in undo, and a pane change never touches the sheet's viewport (PA L14, bug 6).
 */
import { session } from "@/contracts";

export function setLeftSize(size: number): void {
  session.set((s) => (s.panes.left.size === size ? s : { panes: { ...s.panes, left: { ...s.panes.left, size } } }));
}

export function setInspectorSize(size: number): void {
  session.set((s) =>
    s.panes.inspector.size === size ? s : { panes: { ...s.panes, inspector: { ...s.panes.inspector, size } } },
  );
}

export function setConsoleSize(size: number): void {
  session.set((s) =>
    s.panes.console.size === size ? s : { panes: { ...s.panes, console: { ...s.panes.console, size } } },
  );
}

/** Collapses (open false) or restores a pane from its splitter (Enter, or a drag out of the collapsed state). */
export function setPaneOpen(pane: "left" | "inspector" | "console", open: boolean): void {
  session.set((s) => {
    if (s.panes[pane].open === open) return s;
    switch (pane) {
      case "left":
        return { panes: { ...s.panes, left: { ...s.panes.left, open } } };
      case "inspector":
        return { panes: { ...s.panes, inspector: { ...s.panes.inspector, open } } };
      case "console":
        return { panes: { ...s.panes, console: { ...s.panes.console, open } } };
    }
  });
}
