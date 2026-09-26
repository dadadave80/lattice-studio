// Source map lookups for the benchmarks' CPU profiles (brief Q4: "each miss becomes a fix request naming the
// module"). A production chunk is minified, so a profile names positions like `index-B4GI5LtV.js:20:20907`; the
// composition build writes hidden maps for the same chunks, and this turns a position back into its source file.
// Pure: a Source Map v3 `mappings` decoder, nothing else.

/**
 * A Source Map v3, plus `lineOffset`: lines a plugin prepended to the chunk after the map was made (the
 * benchmarks record it when they save a map), which a lookup skips.
 */
export type RawSourceMap = {
  readonly sources: readonly (string | null)[];
  readonly mappings: string;
  readonly sourceRoot?: string;
  readonly lineOffset?: number;
};

/** One mapping segment: generated column, source index (-1 when it maps to nothing), 0-based source line. */
type Segment = readonly [number, number, number];

export type DecodedMap = { readonly sources: readonly string[]; readonly lines: readonly (readonly Segment[])[] };

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DIGIT = new Map([...BASE64].map((ch, i) => [ch, i] as const));

/** Decodes one segment's VLQ fields. */
function fields(segment: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (const ch of segment) {
    const digit = DIGIT.get(ch);
    if (digit === undefined) throw new Error(`Invalid base64 VLQ character "${ch}" in a source map.`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
      continue;
    }
    out.push(value & 1 ? -(value >>> 1) : value >>> 1);
    value = 0;
    shift = 0;
  }
  return out;
}

/** Decodes `mappings` into, per generated line, the segments sorted by generated column. */
export function decodeMap(map: RawSourceMap): DecodedMap {
  const lines: Segment[][] = Array.from({ length: map.lineOffset ?? 0 }, () => []);
  let source = 0;
  let sourceLine = 0;
  for (const line of map.mappings.split(";")) {
    const segments: Segment[] = [];
    let column = 0;
    for (const segment of line.split(",")) {
      if (segment === "") continue;
      const f = fields(segment);
      column += f[0] ?? 0;
      if (f.length >= 4) {
        source += f[1] ?? 0;
        sourceLine += f[2] ?? 0;
        segments.push([column, source, sourceLine]);
      } else {
        segments.push([column, -1, -1]);
      }
    }
    segments.sort((a, b) => a[0] - b[0]);
    lines.push(segments);
  }
  const root = map.sourceRoot ?? "";
  return { sources: map.sources.map((s) => `${root}${s ?? ""}`), lines };
}

/** The source file at 0-based generated `line` and `column`: the last segment starting at or before it. */
export function sourceAt(map: DecodedMap, line: number, column: number): string | null {
  return positionAt(map, line, column)?.source ?? null;
}

/** The source file and its 1-based line at 0-based generated `line` and `column`. */
export function positionAt(map: DecodedMap, line: number, column: number): { source: string; line: number } | null {
  const segments = map.lines[line];
  if (!segments || segments.length === 0) return null;
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = segments[mid];
    if (seg !== undefined && seg[0] <= column) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const seg = found < 0 ? undefined : segments[found];
  if (seg === undefined || seg[1] < 0) return null;
  const source = map.sources[seg[1]];
  return source === undefined ? null : { source, line: seg[2] + 1 };
}
