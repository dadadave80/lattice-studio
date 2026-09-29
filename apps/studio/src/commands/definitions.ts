// S2's commands (contracts §5.3): ui.escape (Esc, IR L17) and shortcuts.open (?, App menu; IR L34, L186).
import { command, log, openDialog, type Command, type KeyContext } from "@/contracts";
import { runEscape } from "./escape";
import { WHEREVER_SINGLE_KEYS } from "./keys/resolve";

/**
 * Esc runs the Esc stack everywhere but a modal dialog, the palette and a text field (which keeps Esc to
 * revert). A dialog or the palette closes itself on Esc: Base UI's `useDismiss` calls `preventDefault` before
 * the dispatcher's window listener ever sees the event, and `handleKeyDown` skips one that's already
 * defaultPrevented. "list" and "menu" popups close themselves the same way, so including them here changes
 * nothing there; it's what lets the stack still reach a list or menu region that isn't a dismissible popup
 * (IR L17: everywhere, in that order).
 */
const ESCAPE_CONTEXTS: KeyContext[] = ["global", "sheet", "card-rows", "tree", "list", "menu", "console"];

export const NOTHING_TO_CLOSE = "Nothing to close.";
export const DIALOG_OPEN = "A dialog is open. Close it to see the shortcuts.";

export const S2_COMMANDS: readonly Command[] = [
  command({
    id: "ui.escape",
    title: () => "Close, leave a mode or clear the selection",
    category: "Session",
    keys: ["Escape"],
    keyContext: ESCAPE_CONTEXTS,
    enabled: () => ({ ok: true }),
    run: () => {
      if (runEscape() === null) log({ tag: "Note", text: NOTHING_TO_CLOSE });
    },
  }),
  command({
    id: "shortcuts.open",
    title: () => "Show keyboard shortcuts",
    category: "Session",
    keys: ["?"],
    keyContext: [...WHEREVER_SINGLE_KEYS],
    palette: true,
    // `?` never opens over another dialog (spec L659).
    enabled: (ctx) => (ctx.session.dialogs.length ? { ok: false, reason: DIALOG_OPEN } : { ok: true }),
    run: () => openDialog("keyboard-shortcuts"),
  }),
];
