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

/**
 * The key context of a keydown's target (contracts §5.3): `text` wherever typing goes, else the nearest
 * `data-keyctx`, else `global`.
 */
export function keyContextOf(target: EventTarget | null): KeyContext {
  if (!(target instanceof Element)) return "global";
  if (isTypingTarget(target)) return "text";
  const declared = target.closest(`[${KEY_CONTEXT_ATTRIBUTE}]`)?.getAttribute(KEY_CONTEXT_ATTRIBUTE);
  return isKeyContext(declared) ? declared : "global";
}
