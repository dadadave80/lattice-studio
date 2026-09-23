/**
 * The command line's help with typing (IR L137): the completion Tab accepts, and the nearest verb for input
 * that isn't one. Pure; the verbs come from the registry through S2's `listVerbs()`.
 */

/** A verb, its aliases and the fixed first words its forms take (`export foundry`). */
export type VerbWords = { verb: string; aliases: readonly string[]; subs: readonly string[] };

/** Optimal string alignment distance (Damerau-Levenshtein with adjacent swaps), case-insensitive. */
export function editDistance(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const rows = s.length + 1;
  const cols = t.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      const row = d[i] as number[];
      const up = d[i - 1] as number[];
      let best = Math.min((up[j] as number) + 1, (row[j - 1] as number) + 1, (up[j - 1] as number) + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        best = Math.min(best, ((d[i - 2] as number[])[j - 2] as number) + 1);
      }
      row[j] = best;
    }
  }
  return (d[rows - 1] as number[])[cols - 1] as number;
}

/**
 * The verb closest to `word`: one it starts, else the fewest edits within a third of its length (at least 2).
 * Returns the verb itself even when an alias was closer. Null when nothing is near.
 */
export function nearestVerb(word: string, verbs: readonly VerbWords[]): string | null {
  const typed = word.toLowerCase();
  if (typed === "") return null;
  const prefixed = verbs.find((v) => [v.verb, ...v.aliases].some((w) => w.toLowerCase().startsWith(typed)));
  if (prefixed) return prefixed.verb;
  const limit = Math.max(2, Math.floor(typed.length / 3));
  let best: { verb: string; distance: number } | null = null;
  for (const v of verbs) {
    for (const w of [v.verb, ...v.aliases]) {
      const distance = editDistance(typed, w);
      if (distance <= limit && (!best || distance < best.distance)) best = { verb: v.verb, distance };
    }
  }
  return best?.verb ?? null;
}

/**
 * What Tab would complete `input` to, or null: the first verb (or alias) the one typed word starts, or the
 * first fixed word (`foundry`) a verb's second word starts. Only at the end of the line.
 */
export function completion(input: string, verbs: readonly VerbWords[]): string | null {
  const match = /^(\S*)(?:(\s+)(\S*))?$/.exec(input);
  if (!match) return null;
  const [, first = "", gap, second] = match;
  if (first === "") return null;
  if (gap === undefined) {
    const lower = first.toLowerCase();
    for (const v of verbs) {
      for (const w of [v.verb, ...v.aliases]) {
        if (w.toLowerCase().startsWith(lower) && w.length > first.length) return w;
      }
    }
    return null;
  }
  const verb = verbs.find((v) => [v.verb, ...v.aliases].some((w) => w.toLowerCase() === first.toLowerCase()));
  if (!verb || second === undefined || second === "") return null;
  const lower = second.toLowerCase();
  const sub = verb.subs.find((s) => s.toLowerCase().startsWith(lower) && s.length > second.length);
  return sub ? `${first}${gap}${sub}` : null;
}
