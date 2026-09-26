/**
 * Keeps what didn't change the same object, so an edit re-renders only the notes and edges it touched
 * (spec L825: a pin edit re-renders a fraction of the sheet). Each new item is matched to the previous item with
 * its key and kept when the two are structurally equal: linear in the items, with no serializing.
 */
export function reuse<T>(previous: readonly T[], next: readonly T[], key: (item: T) => string): T[] {
  const byKey = new Map(previous.map((item) => [key(item), item]));
  const out = next.map((item) => {
    const old = byKey.get(key(item));
    return old !== undefined && same(old, item) ? old : item;
  });
  const unchanged = out.length === previous.length && out.every((item, i) => item === previous[i]);
  return unchanged ? (previous as T[]) : out;
}

/**
 * Structural equality for plain data (objects, arrays, primitives). A field set to `undefined` equals a missing
 * one, as it would in JSON.
 */
export function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return true;
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  let count = 0;
  for (const k in x) {
    if (x[k] === undefined) continue;
    count += 1;
    if (!same(x[k], y[k])) return false;
  }
  for (const k in y) if (y[k] !== undefined) count -= 1;
  return count === 0;
}
