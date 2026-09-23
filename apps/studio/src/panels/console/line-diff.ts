/**
 * Change marks for the Script and Recipe JSON tabs (IR L135): which lines of the new text are new or changed
 * since the previous text. A longest-common-subsequence over lines; past a size where that gets slow, lines
 * are compared by position instead.
 */

/** Above this many cells the LCS table is skipped. A 600-line script against itself is 360,000. */
const LCS_LIMIT = 1_000_000;

/** Indexes (0-based) of lines in `next` that aren't in the common subsequence with `prev`. */
export function changedLines(prev: readonly string[], next: readonly string[]): Set<number> {
  const changed = new Set<number>();
  if (prev.length * next.length > LCS_LIMIT) {
    next.forEach((line, i) => {
      if (prev[i] !== line) changed.add(i);
    });
    return changed;
  }
  const n = prev.length;
  const m = next.length;
  // lengths[i][j]: LCS of prev[i..] and next[j..].
  const lengths: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = lengths[i] as Uint32Array;
    const below = lengths[i + 1] as Uint32Array;
    for (let j = m - 1; j >= 0; j -= 1) {
      row[j] = prev[i] === next[j] ? (below[j + 1] as number) + 1 : Math.max(below[j] as number, row[j + 1] as number);
    }
  }
  let i = 0;
  let j = 0;
  while (j < m) {
    if (i < n && prev[i] === next[j]) {
      i += 1;
      j += 1;
    } else if (i < n && ((lengths[i + 1] as Uint32Array)[j] as number) >= ((lengths[i] as Uint32Array)[j + 1] as number)) {
      i += 1;
    } else {
      changed.add(j);
      j += 1;
    }
  }
  return changed;
}
