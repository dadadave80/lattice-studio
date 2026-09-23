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

/** The keys a natively interactive element already handles itself. */
const CONTROL_KEYS = new Set(["Enter", " ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

/** A button, link, form control or `[role=button]`: FX13 item c. */
const INTERACTIVE_SELECTOR = "button, a[href], input, select, [role='button']";

/**
 * The key context of a keydown's target (contracts §5.3): `text` wherever typing goes, else the nearest
 * `data-keyctx`, else `global`. When `key` is Enter, Space, an arrow, Home or End and the target is a natively
 * interactive element inside a `sheet` or `card-rows` region (not one that declares its own `data-keyctx`),
 * the key goes to the control instead: `global` never carries the sheet's own bindings for it (FX13 item c).
 */
export function keyContextOf(target: EventTarget | null, key?: string): KeyContext {
  if (!(target instanceof Element)) return "global";
  if (isTypingTarget(target)) return "text";
  const owner = target.closest(`[${KEY_CONTEXT_ATTRIBUTE}]`);
  const declared = owner?.getAttribute(KEY_CONTEXT_ATTRIBUTE);
  const context = isKeyContext(declared) ? declared : "global";
  if (
    key !== undefined && CONTROL_KEYS.has(key) && NATIVE_CONTEXTS.has(context) && owner !== target &&
    target.matches(INTERACTIVE_SELECTOR)
  ) {
    return "global";
  }
  return context;
}
