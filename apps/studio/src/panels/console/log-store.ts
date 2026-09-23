/**
 * The console's record (spec L665, IR L134): every line `log()` delivers, in order, with consecutive repeats
 * collapsed to one entry and a count (×n). Plain module state behind a subscription, so `useSyncExternalStore`
 * reads it and the kernel's `log` can append before anything renders.
 *
 * With Keep log across reloads on (settings `keepLog`), the entries are written to browser storage after a short
 * quiet and read back at the next start, oldest first. Stored lines are validated field by field when read,
 * because storage is outside Studio's control.
 */
import type { Anchor, ConsoleLine } from "@lattice-studio/core";

export const LOG_TAGS = [
  "Note", "Placed", "Resolved", "Collision", "Missing", "Init", "Deploy", "Verify", "Error",
] as const satisfies readonly ConsoleLine["tag"][];

export type LogTag = (typeof LOG_TAGS)[number];

/** One entry: a line and how many times it arrived in a row. `at` is the latest arrival. */
export type LogEntry = ConsoleLine & { id: number; count: number };

/** The most entries kept; older ones drop off the top. */
export const LOG_CAP = 1000;

/** Where kept lines live between reloads. */
export const LOG_STORAGE_KEY = "lattice-studio.console-log";

export type LogStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

let entries: readonly LogEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of Array.from(listeners)) listener();
}

function sameAnchor(a: Anchor | undefined, b: Anchor | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameLine(a: ConsoleLine, b: ConsoleLine): boolean {
  return a.tag === b.tag && a.text === b.text && Boolean(a.dim) === Boolean(b.dim) && sameAnchor(a.anchor, b.anchor);
}

function entryOf(line: ConsoleLine, count = 1): LogEntry {
  return { ...line, id: nextId++, count };
}

function capped(list: LogEntry[]): LogEntry[] {
  return list.length > LOG_CAP ? list.slice(list.length - LOG_CAP) : list;
}

/** Appends a line: a repeat of the last entry bumps its count instead (IR L134 "Repeats collapse to ×n"). */
export function appendLine(line: ConsoleLine): void {
  const last = entries.at(-1);
  if (last && sameLine(last, line)) {
    entries = [...entries.slice(0, -1), { ...last, at: line.at, count: last.count + 1 }];
  } else {
    entries = capped([...entries, entryOf(line)]);
  }
  emit();
  schedulePersist();
}

/** Empties the log (Clear, `clear`, Ctrl L on macOS). */
export function clearLog(): void {
  entries = [];
  emit();
  schedulePersist();
}

export function logEntries(): readonly LogEntry[] {
  return entries;
}

export function subscribeLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The newest of `list` with one of `tags` and an id of at least `since`, or null. */
export function latestWith(list: readonly LogEntry[], tags: readonly LogTag[], since = 0): LogEntry | null {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const entry = list[i];
    if (entry && entry.id >= since && tags.includes(entry.tag)) return entry;
  }
  return null;
}

/** The first entry id of the current deploy: lines before it (an earlier deploy, a kept log) don't describe it. */
let deployMark = 1;

/** A deploy left idle or review: its lines are the ones logged from now on. */
export function markDeployStart(): void {
  if (deployMark === nextId) return;
  deployMark = nextId;
  emit();
}

export function deployLinesSince(): number {
  return deployMark;
}

// ---------------------------------------------------------------------------------------------------------
// Keep log across reloads

let storage: LogStorage | null = null;
let keep = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** How long the log waits for quiet before it writes (a burst of lines is one write). */
export const PERSIST_DELAY_MS = 300;

/** Where kept lines go. Null (the default under tests) keeps nothing. */
export function setLogStorage(next: LogStorage | null): void {
  storage = next;
}

/**
 * Turns keeping on or off. On writes after the next quiet (so a `restoreLog()` right after still finds what the
 * last session kept); off forgets what was kept.
 */
export function setKeepLog(on: boolean): void {
  keep = on;
  if (on) {
    schedulePersist();
    return;
  }
  if (timer) clearTimeout(timer);
  timer = null;
  try {
    storage?.removeItem(LOG_STORAGE_KEY);
  } catch {
    // Storage refused: nothing was kept to forget.
  }
}

function schedulePersist(): void {
  if (!keep || !storage || timer) return;
  timer = setTimeout(flushLogPersistence, PERSIST_DELAY_MS);
}

/** Writes the kept lines now (page hide, tests). */
export function flushLogPersistence(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!keep || !storage) return;
  const lines = entries.map((entry) => {
    const line: Record<string, unknown> = { tag: entry.tag, text: entry.text, at: entry.at, count: entry.count };
    if (entry.dim) line.dim = true;
    if (entry.anchor) line.anchor = entry.anchor;
    return line;
  });
  try {
    storage.setItem(LOG_STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // Full or blocked storage: the log still works for this session.
  }
}

const TAGS = new Set<string>(LOG_TAGS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function anchorOf(value: unknown): Anchor | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.kind) {
    case "diamond":
      return { kind: "diamond" };
    case "facet":
      return typeof value.facet === "string" ? { kind: "facet", facet: value.facet } : undefined;
    case "selector":
      if (typeof value.selector !== "string" || !/^0x[0-9a-f]{8}$/.test(value.selector)) return undefined;
      return typeof value.facet === "string"
        ? { kind: "selector", selector: value.selector as `0x${string}`, facet: value.facet }
        : { kind: "selector", selector: value.selector as `0x${string}` };
    case "init":
      return typeof value.path === "string" ? { kind: "init", path: value.path } : undefined;
    case "chain":
      return typeof value.chainId === "number" ? { kind: "chain", chainId: value.chainId } : undefined;
    default:
      return undefined;
  }
}

/** A stored entry, or null when any field is off. */
function storedEntry(value: unknown): { line: ConsoleLine; count: number } | null {
  if (!isRecord(value)) return null;
  const { tag, text, at, dim, count } = value;
  if (typeof tag !== "string" || !TAGS.has(tag) || typeof text !== "string" || typeof at !== "string") return null;
  const line: ConsoleLine = { tag: tag as LogTag, text, at };
  if (dim === true) line.dim = true;
  const anchor = anchorOf(value.anchor);
  if (anchor) line.anchor = anchor;
  const repeats = typeof count === "number" && Number.isSafeInteger(count) && count > 0 ? count : 1;
  return { line, count: repeats };
}

/**
 * Puts the kept lines back, before anything logged since this start. Returns how many came back. Does nothing
 * while keeping is off or no storage is set.
 */
export function restoreLog(): number {
  if (!keep || !storage) return 0;
  let raw: string | null;
  try {
    raw = storage.getItem(LOG_STORAGE_KEY);
  } catch {
    return 0;
  }
  if (!raw) return 0;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 0;
  }
  if (!Array.isArray(parsed)) return 0;
  const kept: LogEntry[] = [];
  for (const item of parsed) {
    const stored = storedEntry(item);
    if (stored) kept.push(entryOf(stored.line, stored.count));
  }
  if (!kept.length) return 0;
  entries = capped([...kept, ...entries]);
  // Kept lines are an earlier session's: a deploy resumed after the reload streams only its new lines.
  deployMark = nextId;
  emit();
  return kept.length;
}

/** @internal Tests: an empty log, keeping off, no storage. */
export function resetConsoleLog(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  entries = [];
  keep = false;
  storage = null;
  deployMark = nextId;
  emit();
}
