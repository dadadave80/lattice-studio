import {
  Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent,
  type HTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode,
} from "react";
import { KEY_CONTEXT_ATTRIBUTE } from "@/contracts";
import { Icon } from "../icons/Icon";
import { ContextMenu } from "../overlays/ContextMenu";
import { cx } from "../shared/cx";
import { VisuallyHidden } from "../shared/VisuallyHidden";
import {
  allSelectable, expandableSiblings, flattenVisible, navigate, rangeIds, rowIndex, scrollToReveal, tabbableIndex,
  toggleId, typeAheadIndex, VIRTUALIZE_AFTER, windowRange, type TreeNode,
} from "./tree-model";
import styles from "./Tree.module.css";
import { TreeRow } from "./TreeRow";

export type TreeItemState = {
  level: number;
  expanded: boolean;
  selected: boolean;
  focused: boolean;
  hasChildren: boolean;
  disabled: boolean;
};

export type TreeProps = {
  /** The tree's accessible name: "Structure", "Catalog". */
  label: string;
  nodes: readonly TreeNode[];
  /** Ids of the open parents. */
  expanded: ReadonlySet<string> | readonly string[];
  onExpandedChange: (expanded: string[]) => void;
  /** Selected ids, in the order they were selected. */
  selected: readonly string[];
  onSelectedChange: (selected: string[]) => void;
  /** Space toggles, Shift + arrows and Shift-click extend, Ctrl/⌘-click toggles, Ctrl/⌘+A selects all visible. */
  multiSelect?: boolean;
  /**
   * The focused item, when the caller keeps it (so the sheet can sync both ways). Omit to let the tree keep it.
   * A change from outside moves the Tab stop but never takes DOM focus.
   */
  focusedId?: string | null;
  onFocusedChange?: (id: string) => void;
  /** Enter or double-click on an item that isn't disabled. */
  onActivate?: (node: TreeNode) => void;
  /**
   * Runs before the tree's own keys. Call `event.preventDefault()` to take the key (Alt + ↑ ↓ to reorder,
   * Delete): the tree then does nothing with it.
   */
  onItemKeyDown?: (event: KeyboardEvent<HTMLElement>, node: TreeNode) => void;
  /**
   * Every click on an item, disabled ones included, even when it's already selected (the tree's own selection
   * change fires only when the selection changes). Not for a click on a parent's chevron, which only toggles.
   */
  onItemClick?: (node: TreeNode, event: MouseEvent<HTMLElement>) => void;
  /**
   * Extra attributes for an item's row element: `data-*` attributes and pointer handlers (drag start). The tree
   * keeps its own role, tabindex, `aria-*` and `data-tree-id`; `className` and `style` are merged.
   */
  itemProps?: (node: TreeNode) => TreeItemProps;
  /**
   * An item's context menu items (`MenuItem`s), or null for none. Right click, long press, Shift+F10 and the
   * Menu key on the focused item open it; Esc returns focus to the item.
   */
  itemMenu?: (node: TreeNode) => ReactNode;
  /** The menu's accessible name. Default: "<label> actions". */
  itemMenuLabel?: (node: TreeNode) => string;
  /** An item's content after its chevron. Default: the label. */
  renderItem?: (node: TreeNode, state: TreeItemState) => ReactNode;
  /** Row height in px (default 28, never under 24). Rows are exactly this tall once the tree is virtualized. */
  rowHeight?: number;
  /** Size the tree here (height or max-height): it scrolls inside. */
  className?: string | undefined;
  style?: CSSProperties;
  id?: string;
};

/** Attributes a caller can add to an item's row element. */
export type TreeItemProps = HTMLAttributes<HTMLDivElement> & {
  [attribute: `data-${string}`]: string | number | boolean | undefined;
};

const TYPE_AHEAD_RESET_MS = 500;

const MENU_POPUP = `[${KEY_CONTEXT_ATTRIBUTE}="menu"]`;

function toSet(value: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  return isList(value) ? new Set(value) : value;
}

function isList(value: ReadonlySet<string> | readonly string[]): value is readonly string[] {
  return Array.isArray(value);
}

function rowIdOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const row = target.closest<HTMLElement>("[data-tree-id]");
  return row?.dataset.treeId ?? null;
}

/**
 * A tree (APG treeview), controlled. One Tab stop (the focused item, else the first selected, else the first);
 * ↑ ↓ move; → opens a parent or enters it; ← closes it or goes to the parent; Home and End; Enter activates;
 * `*` opens every sibling; typing a name jumps to it. Past 200 visible rows it renders only the rows in view.
 */
export function Tree({
  label, nodes, expanded, onExpandedChange, selected, onSelectedChange, multiSelect = false, focusedId,
  onFocusedChange, onActivate, onItemKeyDown, onItemClick, itemProps, itemMenu, itemMenuLabel, renderItem,
  rowHeight: rowHeightProp = 28, className, style, id,
}: TreeProps) {
  const rowHeight = Math.max(24, rowHeightProp);
  const reasonPrefix = useId();
  const expandedSet = useMemo(() => toSet(expanded), [expanded]);
  const rows = useMemo(() => flattenVisible(nodes, expandedSet), [nodes, expandedSet]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const [ownFocus, setOwnFocus] = useState<string | null>(null);
  const currentFocus = focusedId === undefined ? ownFocus : focusedId;
  const tabbable = tabbableIndex(rows, currentFocus, selected);

  const container = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  /** Whether focus is on an item (or in an item's menu), so losing the focused item can hand focus on. */
  const focusInside = useRef(false);
  const anchor = useRef<string | null>(null);
  const typed = useRef({ text: "", timer: 0 });

  const virtual = rows.length > VIRTUALIZE_AFTER;
  const [viewport, setViewport] = useState({ top: 0, height: 0 });

  useEffect(() => {
    const el = container.current;
    if (!virtual || !el) return;
    const measure = () => setViewport({ top: el.scrollTop, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [virtual]);

  useEffect(() => () => window.clearTimeout(typed.current.timer), []);

  // Keyboard moves land here after the render that puts the target row in the DOM.
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    const el = container.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(target)}"]`);
    if (!el) return;
    pendingFocus.current = null;
    el.focus({ preventScroll: virtual });
  });

  // The focused item went away (removed, or its parent closed by the caller) and took focus with it: the item
  // that now takes Tab gets it, not the page.
  useLayoutEffect(() => {
    if (!focusInside.current) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const row = rows[tabbable];
    const el = row ? container.current?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(row.id)}"]`) : null;
    if (el) el.focus({ preventScroll: virtual });
    else focusInside.current = false;
  });

  const setFocus = (next: string) => {
    if (next === currentFocus) return;
    setOwnFocus(next);
    onFocusedChange?.(next);
  };

  const select = (next: string[]) => {
    if (next.length === selected.length && next.every((value, i) => value === selected[i])) return;
    onSelectedChange(next);
  };

  /** Moves focus to a row, scrolling it into view; in a single-select tree, selection follows. */
  const moveTo = (index: number, followSelection: boolean) => {
    const row = rows[index];
    if (!row) return;
    setFocus(row.id);
    if (followSelection && !row.node.disabledReason) select([row.id]);
    const el = container.current;
    if (virtual && el) {
      const top = scrollToReveal(el.scrollTop, el.clientHeight, rowHeight, index);
      if (top !== el.scrollTop) el.scrollTop = top;
      setViewport({ top, height: el.clientHeight });
    }
    const existing = el?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(row.id)}"]`);
    if (existing) existing.focus({ preventScroll: virtual });
    else pendingFocus.current = row.id;
  };

  const setExpanded = (id: string, open: boolean) => {
    if (expandedSet.has(id) === open) return;
    onExpandedChange(open ? [...expandedSet, id] : [...expandedSet].filter((other) => other !== id));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Taken already: an item's context menu (Shift+F10, the Menu key) or a handler on the row.
    if (event.defaultPrevented) return;
    const id = rowIdOf(event.target);
    const index = rowIndex(rows, id);
    const row = rows[index];
    if (!row) return;
    onItemKeyDown?.(event, row.node);
    if (event.defaultPrevented || event.altKey) return;
    const disabled = Boolean(row.node.disabledReason);
    const mod = event.ctrlKey || event.metaKey;

    if (mod) {
      if (multiSelect && event.key.toLowerCase() === "a") {
        event.preventDefault();
        select(allSelectable(rows));
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (!disabled) onActivate?.(row.node);
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      if (disabled) return;
      anchor.current = row.id;
      select(multiSelect ? toggleId(selected, row.id) : [row.id]);
      return;
    }
    if (event.key === "*") {
      event.preventDefault();
      const open = expandableSiblings(rows, index).filter((other) => !expandedSet.has(other));
      if (open.length > 0) onExpandedChange([...expandedSet, ...open]);
      return;
    }

    const move = navigate(rows, index, event.key);
    if (move) {
      event.preventDefault();
      if (move.kind === "expand") setExpanded(move.id, true);
      else if (move.kind === "collapse") setExpanded(move.id, false);
      else if (move.kind === "focus") {
        if (multiSelect && event.shiftKey) {
          anchor.current ??= row.id;
          const from = rowIndex(rows, anchor.current);
          moveTo(move.index, false);
          select(rangeIds(rows, from >= 0 ? from : index, move.index));
        } else {
          moveTo(move.index, !multiSelect);
          if (multiSelect) anchor.current = rows[move.index]?.id ?? null;
        }
      }
      return;
    }

    if (event.key.length === 1) {
      event.preventDefault();
      const buffer = typed.current;
      window.clearTimeout(buffer.timer);
      buffer.text += event.key;
      buffer.timer = window.setTimeout(() => {
        buffer.text = "";
      }, TYPE_AHEAD_RESET_MS);
      const match = typeAheadIndex(rows, index, buffer.text);
      if (match >= 0 && match !== index) moveTo(match, !multiSelect);
    }
  };

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const id = rowIdOf(event.target);
    if (id === null) return;
    focusInside.current = true;
    setFocus(id);
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const { target, relatedTarget: next } = event;
    // An item's menu is portaled, but its focus events still bubble here through React.
    if (rowIdOf(target) === null && !target.closest(MENU_POPUP)) return;
    if (next instanceof Element) {
      // Into another item, or into an item's menu (whose action may remove the item): still inside.
      if (!container.current?.contains(next) && !next.closest(MENU_POPUP)) focusInside.current = false;
      return;
    }
    // Focus went nowhere: a click on the page, or the item was removed. Only a removal disconnects the item.
    queueMicrotask(() => {
      if (target.isConnected) focusInside.current = false;
    });
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const index = rowIndex(rows, rowIdOf(event.target));
    const row = rows[index];
    if (!row) return;
    setFocus(row.id);
    if (event.target instanceof Element && event.target.closest("[data-tree-toggle]")) {
      if (row.hasChildren) setExpanded(row.id, !row.expanded);
      return;
    }
    onItemClick?.(row.node, event);
    if (row.node.disabledReason) return;
    if (multiSelect && event.shiftKey) {
      const from = rowIndex(rows, anchor.current);
      select(rangeIds(rows, from >= 0 ? from : index, index));
      return;
    }
    anchor.current = row.id;
    if (multiSelect && (event.ctrlKey || event.metaKey)) select(toggleId(selected, row.id));
    else select([row.id]);
  };

  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("[data-tree-toggle]")) return;
    const row = rows[rowIndex(rows, rowIdOf(event.target))];
    if (row && !row.node.disabledReason) onActivate?.(row.node);
  };

  const range = virtual ? windowRange(viewport.top, viewport.height, rowHeight, rows.length) : { start: 0, end: rows.length };
  const indices: number[] = [];
  if (tabbable >= 0 && tabbable < range.start) indices.push(tabbable);
  for (let i = range.start; i < range.end; i += 1) indices.push(i);
  if (tabbable >= range.end) indices.push(tabbable);

  const reasons: { id: string; reason: string }[] = [];
  const items = indices.map((index) => {
    const row = rows[index];
    if (!row) return null;
    const reason = row.node.disabledReason;
    const reasonId = reason ? `${reasonPrefix}-${index}` : undefined;
    if (reason && reasonId) reasons.push({ id: reasonId, reason });
    const state: TreeItemState = {
      level: row.level,
      expanded: row.expanded,
      selected: selectedSet.has(row.id),
      focused: row.id === currentFocus,
      hasChildren: row.hasChildren,
      disabled: Boolean(reason),
    };
    const indent = `calc(var(--lx-space-4) * ${row.level - 1})`;
    const place: CSSProperties = virtual
      ? { position: "absolute", insetInline: 0, top: index * rowHeight, blockSize: rowHeight, paddingInlineStart: indent }
      : { minBlockSize: rowHeight, paddingInlineStart: indent };
    const extra = itemProps?.(row.node);
    const element = (
      <TreeRow
        {...extra}
        role="treeitem"
        tabIndex={index === tabbable ? 0 : -1}
        aria-level={row.level}
        aria-setsize={row.setSize}
        aria-posinset={row.posInSet}
        aria-selected={state.selected}
        {...(row.hasChildren ? { "aria-expanded": row.expanded } : {})}
        {...(reasonId ? { "aria-disabled": true, "aria-describedby": reasonId } : {})}
        data-tree-id={row.id}
        className={cx(styles.row, extra?.className)}
        style={{ ...extra?.style, ...place }}
        reason={reason}
      >
        <span
          aria-hidden="true"
          className={cx(styles.chevron, row.hasChildren && styles.toggle)}
          {...(row.hasChildren ? { "data-tree-toggle": "" } : {})}
        >
          {row.hasChildren ? <Icon name={row.expanded ? "chevron-down" : "chevron-right"} size="small" /> : null}
        </span>
        <span className={styles.content}>{renderItem ? renderItem(row.node, state) : row.node.label}</span>
      </TreeRow>
    );
    const menu = itemMenu?.(row.node);
    if (menu === null || menu === undefined || menu === false) return <Fragment key={row.id}>{element}</Fragment>;
    return (
      <ContextMenu key={row.id} label={itemMenuLabel?.(row.node) ?? `${row.node.label} actions`} items={menu}>
        {element}
      </ContextMenu>
    );
  });

  return (
    <>
      {/* The items carry the roving tabindex (APG treeview); the tree itself isn't a Tab stop. */}
      {/* oxlint-disable-next-line jsx-a11y/interactive-supports-focus */}
      <div
        ref={container}
        role="tree"
        aria-label={label}
        {...(multiSelect ? { "aria-multiselectable": true } : {})}
        {...{ [KEY_CONTEXT_ATTRIBUTE]: "tree" }}
        {...(id ? { id } : {})}
        data-virtual={virtual ? "" : undefined}
        className={cx(styles.tree, className)}
        style={style}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onScroll={virtual ? (event) => setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight }) : undefined}
      >
        {virtual ? (
          <div role="presentation" className={styles.spacer} style={{ blockSize: rows.length * rowHeight }}>
            {items}
          </div>
        ) : (
          items
        )}
      </div>
      {reasons.map(({ id: reasonId, reason }) => (
        <VisuallyHidden key={reasonId} id={reasonId}>
          {reason}
        </VisuallyHidden>
      ))}
    </>
  );
}
