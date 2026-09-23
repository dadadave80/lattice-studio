import { Autocomplete } from "@base-ui/react/autocomplete";
import { Dialog } from "@base-ui/react/dialog";
import type { CommandRef } from "@lattice-studio/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KEY_CONTEXT_ATTRIBUTE, listPaletteRows, runCommand, useAnalysis, useCatalog, useDocument, type SheetPoint,
} from "@/contracts";
import { Kbd } from "@/ui";
import { filterGroups, paletteGroups, type PaletteGroup, type PaletteItem } from "./palette-items";
import {
  closePalette, paletteReturnTarget, useRecentCommands, usePaletteState, type PaletteMode,
} from "./palette-state";
import { PaletteRow } from "./PaletteRow";
import styles from "./Palette.module.css";

/**
 * The palette itself, in its own chunk (spec L822): the current opening, keyed so each opening starts with an
 * empty query and the first row active.
 */
export function PalettePopup() {
  const { open, mode, at, key } = usePaletteState();
  // Mounted while open and through the close animation only: a hidden palette builds no rows on each edit.
  const [closed, setClosed] = useState(() => (open ? -1 : key));
  if (!open && closed === key) return null;
  return <PaletteDialog key={key} open={open} mode={mode} at={at} onClosed={() => setClosed(key)} />;
}

type PaletteDialogProps = { open: boolean; mode: PaletteMode; at: SheetPoint | null; onClosed: () => void };

const itemTitle = (item: PaletteItem): string => item.title;

/** Rows shown, in order: the list Home and End move through. */
function rowCount(groups: readonly PaletteGroup[]): number {
  return groups.reduce((n, g) => n + g.items.length, 0);
}

/**
 * Moves the active row from `from` to `to` with the list's own arrow keys, the short way round (IR L166:
 * Home and End). Base UI 1.8's Autocomplete has no controlled highlight, so this relies on three of its
 * behaviors, each covered by the palette's key test:
 * 1. The typeable input's own keydown handler takes Home and End for the caret and stops them. Ours is a
 *    native listener on the input, which runs before React's delegated handler, and stops them first.
 * 2. An ArrowDown or ArrowUp keydown dispatched on the input moves the highlight one row; with
 *    `autoHighlight="always"` and `loopFocus` (the default) it wraps from the last row to the first and back,
 *    never stopping on the input.
 * 3. `onItemHighlighted`'s `details.index` is the row's index across all groups, in render order.
 */
function stepTo(input: HTMLInputElement, from: number, to: number, count: number): void {
  if (from < 0) {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    from = 0;
  }
  const down = (to - from + count) % count;
  const up = (from - to + count) % count;
  const key = down <= up ? "ArrowDown" : "ArrowUp";
  for (let i = Math.min(down, up); i > 0; i -= 1) {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  }
}

function PaletteDialog({ open, mode, at, onClosed }: PaletteDialogProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  /** The command chosen, run once the palette has closed and focus is back. */
  const pending = useRef<CommandRef | null>(null);
  const highlighted = useRef(-1);

  const catalog = useCatalog();
  const problems = useAnalysis((a) => a.problems);
  const facets = useDocument((s) => s.project.recipe.facets);
  const recent = useRecentCommands();
  const [rows] = useState(listPaletteRows);

  const groups = useMemo(
    () => paletteGroups({ mode, at, rows, recent, problems, catalog, placed: new Set(facets) }),
    [mode, at, rows, recent, problems, catalog, facets],
  );
  const shown = useMemo(() => filterGroups(groups, query), [groups, query]);
  const count = rowCount(shown);
  const countRef = useRef(count);
  useEffect(() => {
    countRef.current = count;
  }, [count]);

  /** The input, with Home and End attached for as long as it's in the document (see `stepTo`). */
  const attachInput = useCallback((input: HTMLInputElement | null) => {
    inputRef.current = input;
    if (!input) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Home" && event.key !== "End") return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const total = countRef.current;
      if (total === 0) return;
      event.preventDefault();
      event.stopPropagation();
      stepTo(input, highlighted.current, event.key === "Home" ? 0 : total - 1, total);
    };
    input.addEventListener("keydown", onKeyDown);
    return () => {
      input.removeEventListener("keydown", onKeyDown);
      inputRef.current = null;
    };
  }, []);

  const activate = useCallback((item: PaletteItem, enabled: boolean) => {
    if (!enabled) {
      // Says why (the console and a live announcement) and leaves the palette open.
      void runCommand(item.ref, "palette");
      return;
    }
    pending.current = item.ref;
    closePalette();
  }, []);

  const afterClose = (isOpen: boolean) => {
    if (isOpen) return;
    const ref = pending.current;
    pending.current = null;
    if (ref) {
      // Focus goes back first, so a command that moves focus or opens a dialog starts from there.
      const back = paletteReturnTarget();
      if (back && document.activeElement !== back) back.focus();
      void runCommand(ref, "palette");
    }
    onClosed();
  };

  const facetsOnly = mode === "facets";
  const label = facetsOnly ? "Add facet here…" : "Command palette";
  const trimmed = query.trim();
  const empty = facetsOnly ? `No facets match “${trimmed}”.` : `Nothing matches “${trimmed}”.`;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        // Esc clears the query first, then closes (IR L166).
        if (details.reason === "escape-key" && query !== "") {
          details.cancel();
          setQuery("");
          return;
        }
        closePalette();
      }}
      onOpenChangeComplete={afterClose}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Viewport className={styles.viewport}>
          <Dialog.Popup
            className={styles.popup}
            aria-label={label}
            initialFocus={inputRef}
            finalFocus={() => (pending.current ? false : (paletteReturnTarget() ?? true))}
            {...{ [KEY_CONTEXT_ATTRIBUTE]: "palette" }}
          >
            <Autocomplete.Root
              items={shown}
              value={query}
              onValueChange={(value, details) => {
                if (details.reason === "item-press") return;
                setQuery(value);
              }}
              open
              inline
              mode="none"
              autoHighlight="always"
              keepHighlight
              itemToStringValue={itemTitle}
              onItemHighlighted={(_value, details) => {
                highlighted.current = details.index;
              }}
            >
              <div className={styles.query}>
                <span className={styles.prompt} aria-hidden>
                  &gt;
                </span>
                <Autocomplete.Input
                  ref={attachInput}
                  className={styles.input}
                  aria-label={facetsOnly ? "Search facets" : "Search commands, facets and recipes"}
                  placeholder={facetsOnly ? "Add facet here…" : "Type a command, facet or recipe"}
                  autoComplete="off"
                  spellCheck={false}
                />
                <span className={styles.hint} aria-hidden>
                  <Kbd keys="Escape" />
                </span>
              </div>
              <Autocomplete.Empty className={styles.empty}>{trimmed === "" ? null : empty}</Autocomplete.Empty>
              <Autocomplete.List className={styles.list}>
                {(group: PaletteGroup) => (
                  <Autocomplete.Group key={group.id} items={group.items} className={styles.group}>
                    <Autocomplete.GroupLabel className={styles.groupLabel}>{group.label}</Autocomplete.GroupLabel>
                    <Autocomplete.Collection>
                      {(item: PaletteItem) => <PaletteRow key={item.key} item={item} onActivate={activate} />}
                    </Autocomplete.Collection>
                  </Autocomplete.Group>
                )}
              </Autocomplete.List>
            </Autocomplete.Root>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
