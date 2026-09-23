/**
 * S2's services (contracts §5.2): the Esc stack, the Keyboard shortcuts dialog (in its own chunk), and the
 * shortcut dispatcher for the app. Browser tests install the dispatcher themselves (`installShortcuts`), so a
 * key pressed in another module's test runs only what that test set up.
 */
import { provideServices, registerDialog } from "@/contracts";
import { pushEscapeHandler } from "./escape";
import { installShortcuts } from "./keys/dispatcher";
import { ShortcutsDialogChunk } from "./ShortcutsDialogChunk";

provideServices({ pushEscape: pushEscapeHandler });

registerDialog("keyboard-shortcuts", ShortcutsDialogChunk);

if (import.meta.env.MODE !== "test") installShortcuts();
