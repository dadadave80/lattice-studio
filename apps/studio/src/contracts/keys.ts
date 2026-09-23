import type { CommandId, Json, Platform } from "@lattice-studio/core";

/**
 * Where a shortcut is live (contracts §5.3). Elements declare theirs with `data-keyctx`; the nearest
 * ancestor with the attribute decides.
 */
export const KEY_CONTEXTS = [
  "global", "sheet", "card-rows", "tree", "list", "menu", "console", "palette", "dialog", "text",
] as const;

export type KeyContext = (typeof KEY_CONTEXTS)[number];

/** The attribute that declares a key context. */
export const KEY_CONTEXT_ATTRIBUTE = "data-keyctx";

/**
 * A shortcut. Grammar: modifiers joined with `+`, then one key.
 * - Modifiers: `Mod` (⌘ on macOS, Ctrl elsewhere), `Ctrl`, `Alt`, `Shift`, `Meta`.
 * - Key: the character it types (`k`, `?`, `=`, `/`), a named key (`Enter`, `Escape`, `Delete`, `Backspace`,
 *   `Home`, `End`, `Space`, `ArrowUp`, `F6`), or a physical code in brackets (`[Digit0]`) matched on
 *   `event.code` first (IR L1-L38: ⇧0, ⇧1, ⇧2).
 *
 * Examples: `"Mod+k"`, `"Mod+Shift+z"`, `"Shift+[Digit1]"`, `"F6"`, `"t"`. The object form limits a
 * shortcut to one platform: `{ keys: "Ctrl+y", platform: "other" }` is Redo on Windows and Linux.
 */
export type KeySpec = string | { keys: string; platform: Platform };

/**
 * A shortcut that runs its command with arguments: ← runs `sheet.nudge {dir: "left", step: "small"}`,
 * ⇧← the same with `step: "large"` (IR L23); ⌘← runs `sheet.focusDirection {dir: "left"}` (IR L19);
 * "Go to inspector" runs `region.focus {region: "inspector"}` (IR L16).
 */
export type KeyBinding = {
  /** Unique within the command; the binding's id is `<command id>#<name>` (see `bindingId`). */
  name: string;
  /** Default keys; remappable. */
  keys: KeySpec[];
  args?: Record<string, Json>;
  /** Shown in Settings → Keyboard and the shortcuts dialog when it differs from the command's title. */
  label?: string;
};

/**
 * What a remap targets (settings `keymap` keys). A command's plain `keys` are the binding `<command id>`;
 * each of its `bindings` is `<command id>#<name>`.
 */
export type BindingId = CommandId | `${CommandId}#${string}`;

export function bindingId(command: CommandId, name?: string): BindingId {
  return name === undefined ? command : `${command}#${name}`;
}
