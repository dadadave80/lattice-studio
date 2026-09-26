/**
 * Source maps the benchmarks save beside their results, with every source made repo-relative, so run.ts can name
 * the module behind a profiled position however the map was produced. Runs under Node (Playwright).
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { repoRoot } from "../../local-env.ts";

/** A module id or path relative to the repo, without Rolldown's virtual-module prefix. */
export function relativeId(id: string): string {
  const clean = id.replace(/^\0/, "");
  return clean.startsWith(repoRoot) ? clean.slice(repoRoot.length).replace(/^\//, "") : clean;
}

type MapLike = { sources?: readonly (string | null)[]; sourceRoot?: string; mappings: string };

/**
 * Writes `map` to `to`, its sources resolved from `base` (the folder the map's paths are relative to). `written`,
 * the chunk as it landed on disk, sets `lineOffset`: a plugin that prepends lines after the map was made (the SRI
 * plugin's runtime, ahead of the entry chunk) shifts every line, and the lookup has to skip them.
 */
export function saveMap(map: MapLike, base: string, to: string, written?: string): void {
  const root = map.sourceRoot ?? "";
  const sources = (map.sources ?? []).map((s) => (s === null ? null : relativeId(resolve(base, `${root}${s}`))));
  const lineOffset = written === undefined ? 0 : Math.max(0, written.split("\n").length - map.mappings.split(";").length);
  writeFileSync(to, JSON.stringify({ version: 3, sources, mappings: map.mappings, lineOffset }));
}
