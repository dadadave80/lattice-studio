/**
 * S2: the keymap, the shortcut dispatcher, the Esc stack, the console router and the Keyboard shortcuts
 * dialog, on top of the frozen registry in `@/contracts` (`defineCommands`, `listBindings`, `runCommand`).
 * `pushEscape` is reached through `@/contracts`; the rest is imported from here. The dialog itself isn't
 * exported: it opens through `shortcuts.open` (or `openDialog("keyboard-shortcuts")`) and loads in its own chunk.
 */

// Keys: the grammar, matching and key contexts.
export {
  chordOf, isSingleKey, matchSpec, parseKeys, sameKeys, specFromEvent, specKeys,
} from "./keys/key-spec";
export type { Chord, KeyInput, MatchTier } from "./keys/key-spec";
export { isTypingTarget, keyContextOf } from "./keys/key-context";
export {
  contextsOf, DEFAULT_KEY_CONTEXT, EVERYWHERE, reservedByBrowser, reservedReason, resolveKey, SINGLE_KEY_INERT, specLive,
  WHEREVER_SINGLE_KEYS,
} from "./keys/resolve";
export type { KeyDecision, KeyEnvironment } from "./keys/resolve";
export { handleKeyDown, installShortcuts } from "./keys/dispatcher";
export type { KeyOutcome } from "./keys/dispatcher";

// Remapping (Settings → Keyboard).
export {
  bindingTitle, checkRemap, findConflicts, hasSingleKey, isRemapped, remapBinding, resetBinding, resetKeymap,
} from "./keys/keymap";
export type { KeyConflict, RemapResult } from "./keys/keymap";

// Esc.
export { runEscape } from "./escape";
export type { EscapeOutcome } from "./escape";

// The console router.
export { formsOf, helpLines, listVerbs, route, runConsoleLine, tokenize } from "./console/router";
export type { ConsoleForm, ConsoleVerb, HelpLine, Routed } from "./console/router";

// The shortcuts dialog's rows.
export { CATEGORY_ORDER, groupRows, rowMatches, shortcutRows } from "./shortcut-rows";
export type { ShortcutGroup, ShortcutRow } from "./shortcut-rows";
