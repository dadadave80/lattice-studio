/**
 * The Log's filter (IR L134): tag chips, then text. Text is words that must all appear (case-insensitive),
 * words starting with `-` that must not, or one `/regex/` with optional flags. A pattern that isn't a valid
 * regular expression is matched as plain text, the way DevTools' console filter does.
 */
import type { LogEntry, LogTag } from "./log-store";

export type TextQuery =
  | { kind: "none" }
  | { kind: "words"; include: string[]; exclude: string[] }
  | { kind: "regex"; pattern: RegExp };

export type LogFilter = {
  /** Tags to show; empty shows every tag. */
  tags: ReadonlySet<LogTag>;
  query: string;
};

const REGEX = /^\/(.+)\/([a-z]*)$/s;

/** Parses the filter text. */
export function parseQuery(text: string): TextQuery {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "none" };
  const regex = REGEX.exec(trimmed);
  if (regex) {
    const flags = [...new Set(`${regex[2] ?? ""}i`)].filter((f) => "imsu".includes(f)).join("");
    try {
      return { kind: "regex", pattern: new RegExp(regex[1] ?? "", flags) };
    } catch {
      return { kind: "words", include: [trimmed.toLowerCase()], exclude: [] };
    }
  }
  const include: string[] = [];
  const exclude: string[] = [];
  for (const word of trimmed.toLowerCase().split(/\s+/)) {
    if (word.length > 1 && word.startsWith("-")) exclude.push(word.slice(1));
    else include.push(word);
  }
  return { kind: "words", include, exclude };
}

/** What the filter searches: the tag and the line's text, as the line reads. */
function haystack(entry: Pick<LogEntry, "tag" | "text">): string {
  return `${entry.tag} ${entry.text}`;
}

export function matchesQuery(entry: Pick<LogEntry, "tag" | "text">, query: TextQuery): boolean {
  switch (query.kind) {
    case "none":
      return true;
    case "regex":
      return query.pattern.test(haystack(entry));
    case "words": {
      const text = haystack(entry).toLowerCase();
      return query.include.every((w) => text.includes(w)) && !query.exclude.some((w) => text.includes(w));
    }
  }
}

export function isFiltering(filter: LogFilter): boolean {
  return filter.tags.size > 0 || parseQuery(filter.query).kind !== "none";
}

/** The entries the filter lets through, in order. */
export function filterEntries(entries: readonly LogEntry[], filter: LogFilter): LogEntry[] {
  const query = parseQuery(filter.query);
  return entries.filter((entry) => (filter.tags.size === 0 || filter.tags.has(entry.tag)) && matchesQuery(entry, query));
}

/** "Showing 3 of 12" (IR L134). */
export function showingText(shown: number, total: number): string {
  return `Showing ${shown} of ${total}`;
}
