/**
 * F8 and ⇧F8 walk the analysis's problems in its order (spec L300: severity, then catalog order), one stop per
 * problem, wrapping at either end. Pure, so the order is testable without a sheet.
 */

/** Where F8 last stopped: the problem, and its index then (so a resolved one still has a place). */
export type ProblemCursor = { id: string; index: number };

/**
 * The problem F8 (`dir` 1) or ⇧F8 (`dir` -1) goes to from `cursor`. With no cursor: the first (F8) or the last
 * (⇧F8). When the cursor's problem is gone (resolved), F8 goes to the one now in its place and ⇧F8 to the one
 * before it. Undefined when there are no problems.
 */
export function stepProblem(ids: readonly string[], cursor: ProblemCursor | null, dir: 1 | -1): string | undefined {
  const count = ids.length;
  if (count === 0) return undefined;
  if (cursor === null) return dir === 1 ? ids[0] : ids[count - 1];
  const at = ids.indexOf(cursor.id);
  if (at >= 0) return ids[(at + dir + count) % count];
  const slot = Math.min(Math.max(cursor.index, 0), count);
  return dir === 1 ? ids[slot % count] : ids[(slot - 1 + count) % count];
}
