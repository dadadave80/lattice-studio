import { useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { getAnalysis } from "@/contracts";
import { Button, copyText } from "@/ui";
import { filterEntries, isFiltering } from "./filter";
import { locatable, selectAndLocate } from "./locate";
import { logEntries, subscribeLog, type LogEntry, type LogTag } from "./log-store";
import { LogLine } from "./LogLine";
import { LogToolbar } from "./LogToolbar";
import styles from "./LogView.module.css";

export const EMPTY_LOG = "Type help for commands.";
export const NO_MATCH = "No lines match the filter.";
export const JUMP_TO_LATEST = "Jump to latest";

/** How close to the bottom still counts as following the log, in px. */
const FOLLOW_SLACK = 4;

function lineText(entry: LogEntry): string {
  return entry.count > 1 ? `${entry.text} ×${entry.count}` : entry.text;
}

function isLocatable(entry: LogEntry): boolean {
  return entry.anchor?.kind === "facet" || entry.anchor?.kind === "selector";
}

/**
 * The Log tab (IR L134): `role="log"`, tag chips and text filters with "Showing x of y", repeats as ×n, a click
 * on a line selects and locates its facet or pin, auto-scroll that pauses when you scroll up ("Jump to latest"),
 * Clear, Copy line, Copy all and Keep log across reloads. Lines are one Tab stop; ↑ ↓ Home End move among them.
 */
export function LogView() {
  const entries = useSyncExternalStore(subscribeLog, logEntries);
  const [tags, setTags] = useState<ReadonlySet<LogTag>>(() => new Set());
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [following, setFollowing] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const filter = { tags, query };
  const shown = filterEntries(entries, filter);
  const filtering = isFiltering(filter);
  const selected = entries.find((e) => e.id === selectedId) ?? null;
  const tabbableId = shown.some((e) => e.id === focusId) ? focusId : (shown.at(-1)?.id ?? null);
  const lastShown = shown.at(-1);

  // Follow the newest line unless the reader scrolled up.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (following) list.scrollTop = list.scrollHeight;
    // Cleared or filtered down to what fits: there's nothing to jump to.
    else if (list.scrollHeight <= list.clientHeight) setFollowing(true);
  }, [following, lastShown?.id, lastShown?.count, shown.length]);

  const onScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight <= FOLLOW_SLACK;
    if (atBottom !== following) setFollowing(atBottom);
  };

  const jump = () => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
    setFollowing(true);
  };

  const activate = (entry: LogEntry) => {
    setSelectedId(entry.id);
    setFocusId(entry.id);
    const target = locatable(entry.anchor, getAnalysis());
    if (target) selectAndLocate([target.facet], target, "button");
  };

  const focusLine = (id: number | undefined) => {
    if (id === undefined) return;
    setFocusId(id);
    listRef.current?.querySelector<HTMLElement>(`[data-line-id="${id}"]`)?.focus();
  };

  const onNavigate = (entry: LogEntry, event: KeyboardEvent<HTMLButtonElement>) => {
    const at = shown.findIndex((e) => e.id === entry.id);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = Math.min(shown.length - 1, at + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, at - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = shown.length - 1;
    if (next === null || next < 0) return;
    event.preventDefault();
    focusLine(shown[next]?.id);
  };

  const copyLine = () => {
    if (selected) void copyText(lineText(selected), { label: "line" });
  };
  const copyAll = () => {
    void copyText(shown.map((e) => `${e.tag}\t${lineText(e)}`).join("\n"), { label: "the log" });
  };

  return (
    <div className={styles.view}>
      <LogToolbar
        tags={tags}
        onTagsChange={setTags}
        query={query}
        onQueryChange={setQuery}
        showing={filtering ? { shown: shown.length, total: entries.length } : null}
        copyLineReason={selected ? null : "Select a line first"}
        onCopyLine={copyLine}
        copyAllReason={shown.length ? null : "The log is empty"}
        onCopyAll={copyAll}
      />
      <div className={styles.listWrap}>
        <div
          ref={listRef}
          className={styles.list}
          role="log"
          aria-label="Log"
          aria-live="polite"
          onScroll={onScroll}
        >
          {shown.map((entry) => (
            <LogLine
              key={entry.id}
              entry={entry}
              selected={entry.id === selectedId}
              tabbable={entry.id === tabbableId}
              locatable={isLocatable(entry)}
              onActivate={activate}
              onFocusLine={(e) => setFocusId(e.id)}
              onNavigate={onNavigate}
            />
          ))}
          {shown.length === 0 ? <p className={styles.empty}>{entries.length ? NO_MATCH : EMPTY_LOG}</p> : null}
        </div>
        {following ? null : (
          <div className={styles.jump}>
            <Button size="small" onClick={jump}>
              {JUMP_TO_LATEST}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
