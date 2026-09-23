/**
 * The pure half of `Tree` (APG treeview): flattening the nodes into visible rows, keyboard moves, type-ahead,
 * range selection and the virtualized window. No DOM, no React.
 */

export type TreeNode = {
  id: string;
  /** Visible text and what type-ahead matches. */
  label: string;
  children?: readonly TreeNode[];
  /** Why the item can't be selected or activated now. It stays focusable and says why. */
  disabledReason?: string;
};

/** One visible row. `setSize` and `posInSet` count the node's siblings, not the visible rows. */
export type TreeRow = {
  node: TreeNode;
  id: string;
  level: number;
  parentId: string | null;
  setSize: number;
  posInSet: number;
  hasChildren: boolean;
  expanded: boolean;
};

export function hasChildren(node: TreeNode): boolean {
  return (node.children?.length ?? 0) > 0;
}

/** The rows a person can see: every root, and the children of every expanded parent, in reading order. */
export function flattenVisible(nodes: readonly TreeNode[], expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (list: readonly TreeNode[], level: number, parentId: string | null) => {
    list.forEach((node, index) => {
      const parent = hasChildren(node);
      const open = parent && expanded.has(node.id);
      rows.push({
        node, id: node.id, level, parentId, setSize: list.length, posInSet: index + 1, hasChildren: parent, expanded: open,
      });
      if (open && node.children) walk(node.children, level + 1, node.id);
    });
  };
  walk(nodes, 1, null);
  return rows;
}

/** Every parent id in the tree (for "expand all"). */
export function parentIds(nodes: readonly TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly TreeNode[]) => {
    for (const node of list) {
      if (!hasChildren(node) || !node.children) continue;
      out.push(node.id);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

export function rowIndex(rows: readonly TreeRow[], id: string | null | undefined): number {
  if (id === null || id === undefined) return -1;
  return rows.findIndex((row) => row.id === id);
}

/** The item that takes Tab: the focused one if visible, else the first visible selected one, else the first. */
export function tabbableIndex(
  rows: readonly TreeRow[], focusedId: string | null | undefined, selected: readonly string[],
): number {
  if (rows.length === 0) return -1;
  const focused = rowIndex(rows, focusedId);
  if (focused >= 0) return focused;
  const chosen = new Set(selected);
  const first = rows.findIndex((row) => chosen.has(row.id));
  return first >= 0 ? first : 0;
}

export function parentIndex(rows: readonly TreeRow[], index: number): number {
  const row = rows[index];
  return row ? rowIndex(rows, row.parentId) : -1;
}

/**
 * The next index for a navigation key, or null when the key moves nothing (and isn't handled).
 * `ArrowRight`/`ArrowLeft` return an expansion change instead of a move when that's what they do.
 */
export type TreeMove =
  | { kind: "focus"; index: number }
  | { kind: "expand"; id: string }
  | { kind: "collapse"; id: string }
  | { kind: "none" };

export function navigate(rows: readonly TreeRow[], index: number, key: string): TreeMove | null {
  const row = rows[index];
  if (!row) return null;
  const last = rows.length - 1;
  switch (key) {
    case "ArrowDown":
      return index < last ? { kind: "focus", index: index + 1 } : { kind: "none" };
    case "ArrowUp":
      return index > 0 ? { kind: "focus", index: index - 1 } : { kind: "none" };
    case "Home":
      return { kind: "focus", index: 0 };
    case "End":
      return { kind: "focus", index: last };
    case "ArrowRight":
      if (!row.hasChildren) return { kind: "none" };
      return row.expanded ? { kind: "focus", index: index + 1 } : { kind: "expand", id: row.id };
    case "ArrowLeft": {
      if (row.hasChildren && row.expanded) return { kind: "collapse", id: row.id };
      const parent = parentIndex(rows, index);
      return parent >= 0 ? { kind: "focus", index: parent } : { kind: "none" };
    }
    default:
      return null;
  }
}

/** The ids of the focused row's siblings (itself included) that have children: what `*` expands. */
export function expandableSiblings(rows: readonly TreeRow[], index: number): string[] {
  const row = rows[index];
  if (!row) return [];
  return rows.filter((other) => other.parentId === row.parentId && other.level === row.level && other.hasChildren)
    .map((other) => other.id);
}

/**
 * Type-ahead: the index of the next row whose label starts with `typed` (case-insensitive), wrapping, or -1.
 * A new search starts after the current row; a longer buffer keeps the current row when it still matches, and
 * one character typed repeatedly ("aaa") cycles through the rows starting with it.
 */
export function typeAheadIndex(rows: readonly TreeRow[], from: number, typed: string): number {
  if (!typed || rows.length === 0) return -1;
  const lower = typed.toLocaleLowerCase();
  const repeated = [...lower].every((char) => char === lower[0]);
  const query = repeated ? lower.slice(0, 1) : lower;
  const start = repeated || typed.length === 1 ? from + 1 : from;
  for (let step = 0; step < rows.length; step += 1) {
    const i = (((start + step) % rows.length) + rows.length) % rows.length;
    const row = rows[i];
    if (row && row.node.label.toLocaleLowerCase().startsWith(query)) return i;
  }
  return -1;
}

/** The selectable ids between two rows, inclusive, in reading order. */
export function rangeIds(rows: readonly TreeRow[], a: number, b: number): string[] {
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(rows.length - 1, Math.max(a, b));
  const out: string[] = [];
  for (let i = lo; i <= hi; i += 1) {
    const row = rows[i];
    if (row && !row.node.disabledReason) out.push(row.id);
  }
  return out;
}

/** Every selectable visible id (Ctrl/⌘+A). */
export function allSelectable(rows: readonly TreeRow[]): string[] {
  return rows.filter((row) => !row.node.disabledReason).map((row) => row.id);
}

/** `ids` with `id` added, or removed if it was there. */
export function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];
}

/** Trees longer than this render only the rows in view. */
export const VIRTUALIZE_AFTER = 200;

/**
 * The rows to render in a virtualized tree: those in the viewport plus `overscan` on each side, as the
 * half-open range [start, end). An unmeasured viewport (0) counts as 20 rows.
 */
export function windowRange(
  scrollTop: number, viewport: number, rowHeight: number, count: number, overscan = 8,
): { start: number; end: number } {
  if (count === 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const height = viewport > 0 ? viewport : rowHeight * 20;
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const last = Math.ceil((Math.max(0, scrollTop) + height) / rowHeight);
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + overscan) };
}

/** The scrollTop that brings row `index` fully into view with the least movement. */
export function scrollToReveal(scrollTop: number, viewport: number, rowHeight: number, index: number): number {
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return top;
  if (viewport > 0 && bottom > scrollTop + viewport) return bottom - viewport;
  return scrollTop;
}
