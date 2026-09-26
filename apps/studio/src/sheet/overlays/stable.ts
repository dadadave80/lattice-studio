/**
 * Keeps what didn't change the same object, so an edit re-renders only the notes and edges it touched
 * (spec L825: a pin edit re-renders a fraction of the sheet). Items are compared by their content as JSON.
 */
export function reuse<T>(previous: readonly T[], next: readonly T[]): T[] {
  const byContent = new Map(previous.map((item) => [JSON.stringify(item), item]));
  const out = next.map((item) => byContent.get(JSON.stringify(item)) ?? item);
  const same = out.length === previous.length && out.every((item, i) => item === previous[i]);
  return same ? (previous as T[]) : out;
}
