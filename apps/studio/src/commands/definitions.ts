// S2's commands (contracts §5.3): ui.escape (Esc, IR L17) and shortcuts.open (?, App menu; IR L34, L186).
import { command, log, openDialog, type Command, type KeyContext } from "@/contracts";
import { runEscape } from "./escape";
import { WHEREVER_SINGLE_KEYS } from "./keys/resolve";

/**
 * Esc runs the Esc stack wherever no modal dialog, menu, list or palette has focus (those close themselves)
 * and nobody is typing (a field keeps Esc to revert).
 */
const ESCAPE_CONTEXTS: KeyContext[] = ["global", "sheet", "card-rows", "tree", "console"];

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
    title: () => "Keyboard shortcuts",
    category: "Session",
    keys: ["?"],
    keyContext: [...WHEREVER_SINGLE_KEYS],
    palette: true,
    // `?` never opens over another dialog (spec L659).
    enabled: (ctx) => (ctx.session.dialogs.length ? { ok: false, reason: DIALOG_OPEN } : { ok: true }),
    run: () => openDialog("keyboard-shortcuts"),
  }),
];
