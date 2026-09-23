import { KEY_CONTEXT_ATTRIBUTE, KEY_CONTEXTS, type KeyContext } from "@/contracts";

/** Input types that take no typing: their keys stay shortcuts. */
const NOT_TYPED = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);

/** Whether typing goes into `element`: a text input, a textarea, a select or editable content. */
export function isTypingTarget(element: Element): boolean {
  if (element instanceof HTMLInputElement) return !NOT_TYPED.has(element.type);
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  return element instanceof HTMLElement && element.isContentEditable;
}

const isKeyContext = (value: string | null | undefined): value is KeyContext =>
  (KEY_CONTEXTS as readonly string[]).includes(value ?? "");

/** Contexts where a native control's own keys (Enter, Space, arrows, Home, End) can be stolen by a shortcut. */
const NATIVE_CONTEXTS = new Set<KeyContext>(["sheet", "card-rows"]);

/** Enter and Space activate these natively (a click); a button does nothing native with arrows, Home or End. */
const ACTIVATE_KEYS = new Set(["Enter", " "]);
const ACTIVATE_SELECTOR = "button, a[href], [role='button']";

/** Arrows, Home and End move within these instead of the region's own bindings (`select` for its options). */
const MOVE_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);
const MOVE_SELECTOR = "input, select, textarea";

/**
 * The key context of a keydown's target (contracts §5.3): `text` wherever typing goes, else the nearest
 * `data-keyctx`, else `global`. Inside a `sheet` or `card-rows` region (not on an element that declares its
 * own `data-keyctx`, and never on a card's row itself, `[data-card-row]`, which S4e's own row bindings own
 * regardless of the element), a natively interactive element keeps the keys it handles itself: Enter and
 * Space for a button, link or `[role=button]`, and arrows, Home and End for a form control that moves with
 * them. Otherwise the region's own bindings (FX13 item c, CR2) still get the key.
 */
export function keyContextOf(target: EventTarget | null, key?: string): KeyContext {
  if (!(target instanceof Element)) return "global";
  if (isTypingTarget(target)) return "text";
  const owner = target.closest(`[${KEY_CONTEXT_ATTRIBUTE}]`);
  const declared = owner?.getAttribute(KEY_CONTEXT_ATTRIBUTE);
  const context = isKeyContext(declared) ? declared : "global";
  if (
    key !== undefined && NATIVE_CONTEXTS.has(context) && owner !== target && !target.matches("[data-card-row]") &&
    ((ACTIVATE_KEYS.has(key) && target.matches(ACTIVATE_SELECTOR)) || (MOVE_KEYS.has(key) && target.matches(MOVE_SELECTOR)))
  ) {
    return "global";
  }
  return context;
}
