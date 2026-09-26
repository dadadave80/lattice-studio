// Where a profiled phase's main-thread time goes (brief Q4: a fix request names the module). Each profile frame is
// a position in a minified chunk; the source maps the composition and analysis benchmarks saved turn it back into
// a source file and line, grouped like the first-load composition. Pure: the caller supplies the maps.
import { groupOf } from "./composition.ts";
import { positionAt, type DecodedMap } from "./sourcemap.ts";
import type { Profile } from "./types.ts";

/** Time outside JavaScript: V8 reports style, layout, paint and other browser work as "(program)". */
export const BROWSER_WORK = "(browser: style, layout, paint)";

/** A source or group and its self time, in ms. */
export type Timed = { readonly name: string; readonly ms: number };

export type Attribution = {
  readonly label: string;
  /** Busy time: everything but "(idle)". */
  readonly busy: number;
  readonly bySource: readonly Timed[];
  readonly byGroup: readonly Timed[];
  /** Functions by where they start, `file:line` (the line of the function's first mapped token). */
  readonly byLine: readonly Timed[];
};

/** The file part of a script URL: `http://host/assets/index-abc.js` → `index-abc.js`. */
export function scriptName(url: string): string {
  const path = url.replace(/[?#].*$/, "");
  return path.slice(path.lastIndexOf("/") + 1);
}

function sorted(m: Map<string, number>): Timed[] {
  return [...m].map(([name, ms]) => ({ name, ms })).sort((a, b) => b.ms - a.ms);
}

/** Attributes each frame's self time to its source file and line (through `mapFor`) and to the file's group. */
export function attribute(profile: Profile, mapFor: (script: string) => DecodedMap | null): Attribution {
  const bySource = new Map<string, number>();
  const byLine = new Map<string, number>();
  let busy = 0;
  for (const frame of profile.frames) {
    if (frame.fn === "(idle)") continue;
    busy += frame.self;
    let source: string;
    if (frame.fn === "(program)") source = BROWSER_WORK;
    else if (frame.fn === "(garbage collector)") source = "(garbage collector)";
    else if (!frame.url) source = `(native ${frame.fn || "code"})`;
    else {
      const map = mapFor(scriptName(frame.url));
      const at = map && frame.line >= 0 ? positionAt(map, frame.line, frame.column) : null;
      source = at?.source ?? `${scriptName(frame.url)} (unmapped)`;
      if (at) byLine.set(`${at.source}:${at.line}`, (byLine.get(`${at.source}:${at.line}`) ?? 0) + frame.self);
    }
    bySource.set(source, (bySource.get(source) ?? 0) + frame.self);
  }
  const byGroup = new Map<string, number>();
  for (const [source, ms] of bySource) {
    const group = source.startsWith("(") || source.endsWith("(unmapped)") ? source : groupOf(source);
    byGroup.set(group, (byGroup.get(group) ?? 0) + ms);
  }
  return { label: profile.label, busy, bySource: sorted(bySource), byGroup: sorted(byGroup), byLine: sorted(byLine) };
}
