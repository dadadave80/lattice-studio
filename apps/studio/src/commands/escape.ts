/**
 * The Esc stack (contracts §5.2 "escape stack", IR L17): Esc closes the top overlay; else leaves a mode
 * (Move to…, init order, a card's rows); else clears the selection. Overlays that aren't Base UI dialogs,
 * menus or popovers (those close themselves) push a handler while they show; the modes, the rows and the
 * selection live in the session, so they're left in that order when no handler takes Esc.
 */
import { log, session, type EscapeHandler } from "@/contracts";

const stack: EscapeHandler[] = [];

/** Pushes an Esc handler; the last pushed runs first. Returns a disposer. A handler returns `false` to pass Esc on. */
export function pushEscapeHandler(handler: EscapeHandler): () => void {
  stack.push(handler);
  return () => {
    const at = stack.lastIndexOf(handler);
    if (at >= 0) stack.splice(at, 1);
  };
}

/** What Esc did: an overlay's handler, a mode left, the selection cleared, or nothing. */
export type EscapeOutcome = "handler" | "moveTo" | "initOrder" | "rows" | "selection" | null;

function runHandler(handler: EscapeHandler): boolean {
  try {
    return handler() !== false;
  } catch (error) {
    log({ tag: "Error", text: `Esc: ${error instanceof Error ? error.message : String(error)}` });
    console.error(error);
    return false;
  }
}

/** Runs one Esc: the top handler that takes it, else the session's modes, rows and selection, in that order. */
export function runEscape(): EscapeOutcome {
  // A handler may dispose itself or push another while it runs: walk a copy, top first.
  for (const handler of [...stack].reverse()) {
    if (runHandler(handler)) return "handler";
  }
  const s = session.get();
  if (s.modes.moveTo) {
    session.set((x) => ({ modes: { ...x.modes, moveTo: false } }));
    return "moveTo";
  }
  if (s.modes.initOrder) {
    session.set((x) => ({ modes: { ...x.modes, initOrder: false } }));
    return "initOrder";
  }
  if (s.modes.rows !== null) {
    session.set((x) => ({ modes: { ...x.modes, rows: null } }));
    return "rows";
  }
  if (s.selection.length) {
    session.set({ selection: [] });
    return "selection";
  }
  return null;
}

/** @internal How many handlers are pushed, for tests. */
export function escapeDepth(): number {
  return stack.length;
}
