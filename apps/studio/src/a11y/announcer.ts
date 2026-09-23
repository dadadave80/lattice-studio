/**
 * The `announce` service (contracts §5.2, spec L775-L777): one polite `status` region, present from load,
 * where messages are merged and debounced, and one `alert` region only for failures that interrupt (a deploy
 * that reverts, storage that's full), which speaks at once.
 *
 * Merging: an announcement with a `merge` key replaces the waiting one with the same key, so five nudges
 * read as their last "Moved ERC20 right, beside ERC4626". Distinct messages that arrive together are read as
 * one, in order. Debouncing: the status region updates once the messages stop for `QUIET_MS`, and at the
 * latest `MAX_WAIT_MS` after the first one, so a held key still speaks.
 */
import type { AnnounceOptions } from "@/contracts";
import styles from "./a11y.module.css";

export const QUIET_MS = 400;
export const MAX_WAIT_MS = 1500;

type Waiting = { text: string; merge?: string };

let waiting: Waiting[] = [];
let quietTimer: ReturnType<typeof setTimeout> | null = null;
let maxTimer: ReturnType<typeof setTimeout> | null = null;
let statusNode: HTMLElement | null = null;
let alertNode: HTMLElement | null = null;

function liveNode(role: "status" | "alert"): HTMLElement {
  const node = document.createElement("div");
  node.setAttribute("role", role);
  node.setAttribute("aria-live", role === "alert" ? "assertive" : "polite");
  node.setAttribute("aria-atomic", "true");
  node.dataset.announcer = role;
  node.className = styles.visuallyHidden ?? "";
  document.body.append(node);
  return node;
}

/**
 * Puts both live regions in the document if they aren't there yet. `useRegion`'s first mount calls it, so
 * the regions exist from load, before anything is said (a live region added with its text isn't read).
 */
export function ensureLiveRegions(): void {
  if (typeof document === "undefined" || !document.body) return;
  if (!statusNode?.isConnected) statusNode = liveNode("status");
  if (!alertNode?.isConnected) alertNode = liveNode("alert");
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?…:]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Replaces a region's text with a new node, so the same words said twice are read twice. */
function speak(node: HTMLElement, text: string): void {
  const line = document.createElement("p");
  line.textContent = text;
  node.replaceChildren(line);
}

function clearTimers(): void {
  if (quietTimer !== null) clearTimeout(quietTimer);
  if (maxTimer !== null) clearTimeout(maxTimer);
  quietTimer = null;
  maxTimer = null;
}

/** Reads out everything waiting now. */
export function flushAnnouncements(): void {
  clearTimers();
  if (!waiting.length) return;
  const texts = waiting.map((w) => w.text);
  waiting = [];
  ensureLiveRegions();
  if (!statusNode) return;
  speak(statusNode, texts.length === 1 ? (texts[0] ?? "") : texts.map(sentence).join(" "));
}

/** The `announce` implementation `services.ts` provides. */
export function announceImpl(text: string, options: AnnounceOptions = {}): void {
  if (!text.trim()) return;
  ensureLiveRegions();
  if (options.politeness === "assertive") {
    // An interrupting failure outranks what was waiting: that is read after it.
    if (alertNode) speak(alertNode, text);
    return;
  }
  const { merge } = options;
  const at = merge === undefined ? -1 : waiting.findIndex((w) => w.merge === merge);
  const entry: Waiting = merge === undefined ? { text } : { text, merge };
  if (at >= 0) waiting[at] = entry;
  else waiting.push(entry);
  if (quietTimer !== null) clearTimeout(quietTimer);
  quietTimer = setTimeout(flushAnnouncements, QUIET_MS);
  maxTimer ??= setTimeout(flushAnnouncements, MAX_WAIT_MS);
}

/** What the status and alert regions say now (tests, and the harness's future readers). */
export function spoken(): { status: string; alert: string } {
  return { status: statusNode?.textContent ?? "", alert: alertNode?.textContent ?? "" };
}

/** @internal Drops what's waiting and empties both regions (between tests). */
export function resetAnnouncer(): void {
  clearTimers();
  waiting = [];
  statusNode?.replaceChildren();
  alertNode?.replaceChildren();
}
