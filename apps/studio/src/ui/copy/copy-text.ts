/**
 * The one copy helper every Copy control uses (contracts §6, spec L865, PA L32 bug 24). It copies the exact
 * value (an address checksummed), echoes it in a toast ("Copied 0x1234…abcd"), and when the clipboard is
 * blocked, shows the value selected with "Press ⌘C to copy" (Ctrl+C on Windows and Linux) instead of
 * failing silently.
 */
import { formatAddress, formatKeys, isAddress, toChecksum } from "@lattice-studio/core";
import { toast } from "@/contracts";
import { platform } from "../shared/platform";
import styles from "./copy-fallback.module.css";

export type CopyOptions = {
  /**
   * What the toast names after "Copied": "link", "`transfer · 0xa9059cbb`", "script". Default: an address
   * as `0x1234…abcd`, a short value as itself, a long one truncated in the middle.
   */
  label?: string;
  /** The clipboard to write to (tests). Default: `navigator.clipboard`. */
  clipboard?: Pick<Clipboard, "writeText"> | null;
};

export type CopyResult =
  /** On the clipboard; the toast said so. */
  | { ok: true; text: string }
  /** The clipboard refused: the value is shown selected for ⌘C / Ctrl+C. */
  | { ok: false; text: string; reason: "blocked" };

/** The exact text that goes on the clipboard: addresses checksummed (EIP-55), anything else as given. */
export function copyValue(value: string): string {
  return isAddress(value) ? toChecksum(value) : value;
}

/** How the toast names the value. */
export function copyLabel(text: string, label?: string): string {
  if (label) return label;
  if (isAddress(text)) return formatAddress(text);
  return text.length <= 32 ? text : `${text.slice(0, 16)}…${text.slice(-8)}`;
}

/** "Press ⌘C to copy" on macOS, "Press Ctrl+C to copy" elsewhere. */
export function copyHint(): string {
  return `Press ${formatKeys("Mod+C", platform())} to copy`;
}

let fallbackCount = 0;
let fallback: { element: HTMLElement; restore: Element | null; dispose(): void } | null = null;

/** @internal Closes the blocked-clipboard fallback if it's showing (tests, route changes). */
export function dismissCopyFallback(): void {
  fallback?.dispose();
}

function showFallback(text: string, label: string): void {
  if (typeof document === "undefined") return;
  dismissCopyFallback();
  const restore = document.activeElement;
  const anchor = restore instanceof HTMLElement && restore !== document.body ? restore.getBoundingClientRect() : null;

  const element = document.createElement("div");
  element.className = styles.fallback ?? "";
  element.setAttribute("role", "group");
  element.dataset.copyFallback = "";
  // Typing context: single-key shortcuts stay inert while it shows (spec L659).
  element.dataset.keyctx = "text";
  fallbackCount += 1;
  const hintId = `lx-copy-hint-${fallbackCount}`;
  const hint = document.createElement("p");
  hint.id = hintId;
  hint.className = styles.hint ?? "";
  hint.textContent = copyHint();
  const area = document.createElement("textarea");
  area.className = styles.value ?? "";
  area.readOnly = true;
  area.value = text;
  area.rows = Math.min(4, Math.max(1, Math.ceil(text.length / 44)));
  area.setAttribute("aria-labelledby", hintId);
  area.spellcheck = false;
  element.setAttribute("aria-labelledby", hintId);
  element.append(hint, area);
  document.body.append(element);

  // Below the control that asked, kept inside the window.
  const box = element.getBoundingClientRect();
  const top = anchor ? Math.min(anchor.bottom + 8, window.innerHeight - box.height - 8) : (window.innerHeight - box.height) / 2;
  const left = anchor ? Math.min(Math.max(8, anchor.left), window.innerWidth - box.width - 8) : (window.innerWidth - box.width) / 2;
  element.style.top = `${Math.max(8, top)}px`;
  element.style.left = `${Math.max(8, left)}px`;

  const close = (returnFocus: boolean) => {
    element.remove();
    document.removeEventListener("pointerdown", outside, true);
    if (fallback?.element === element) fallback = null;
    if (returnFocus && restore instanceof HTMLElement && restore.isConnected) restore.focus();
  };
  const outside = (event: Event) => {
    if (!element.contains(event.target as Node)) close(false);
  };
  area.addEventListener("copy", () => {
    toast({ text: `Copied ${label}` });
    queueMicrotask(() => close(true));
  });
  area.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  });
  document.addEventListener("pointerdown", outside, true);
  fallback = { element, restore, dispose: () => close(false) };

  area.focus();
  area.select();
}

/**
 * Copies `value`. Addresses go on the clipboard checksummed and the toast echoes the short form
 * ("Copied 0x1234…abcd"); anything else is copied exactly and named by `label`. When the clipboard is
 * blocked, the value is shown selected under the control with "Press ⌘C to copy".
 */
export async function copyText(value: string, options: CopyOptions = {}): Promise<CopyResult> {
  const text = copyValue(value);
  const label = copyLabel(text, options.label);
  const clipboard = options.clipboard === undefined ? globalThis.navigator?.clipboard : options.clipboard;
  try {
    if (!clipboard) throw new Error("No clipboard.");
    await clipboard.writeText(text);
  } catch {
    showFallback(text, label);
    return { ok: false, text, reason: "blocked" };
  }
  toast({ text: `Copied ${label}` });
  return { ok: true, text };
}
