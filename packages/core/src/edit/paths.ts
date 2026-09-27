/**
 * Init-argument paths (contracts §3.1 `Anchor`): `bundle.p.asset` addresses `init.args.p.asset`, and
 * `steps[2].admin` addresses `init.steps[2].args.admin`. `bundle` and `steps[2]` name the step itself.
 * Also the keys of `Project.provenance` and `Project.labels`, so step edits can move both along.
 */

/** A parsed init path: the step it lives in, then the fields below it (none for the step itself). */
export type InitPath =
  | { root: "bundle"; fields: string[] }
  | { root: "steps"; index: number; fields: string[] };

const FIELD = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const STEP = /^steps\[(0|[1-9][0-9]*)\]$/;

/** Parses `bundle`, `bundle.p.asset`, `steps[2]` or `steps[2].admin`; null for anything else. */
export function parseInitPath(path: string): InitPath | null {
  const [head, ...fields] = path.split(".");
  if (head === undefined || !fields.every((field) => FIELD.test(field))) return null;
  if (head === "bundle") return { root: "bundle", fields };
  const step = STEP.exec(head);
  if (step?.[1] === undefined) return null;
  const index = Number(step[1]);
  return Number.isSafeInteger(index) ? { root: "steps", index, fields } : null;
}

/** The path of the step an init path lives in: "bundle" or "steps[2]". */
export function stepPath(path: InitPath): string {
  return path.root === "bundle" ? "bundle" : `steps[${path.index}]`;
}

/** True when `key` is `path` itself or a path below it (`steps[2].p` is under `steps[2]`; `steps[20]` isn't). */
export function isUnder(key: string, path: string): boolean {
  return key === path || key.startsWith(`${path}.`) || key.startsWith(`${path}[`);
}

/**
 * A record keyed by init path (provenance or labels) without `path` and every path below it. Returns the input
 * itself when nothing matched.
 */
export function dropProvenance<T>(provenance: Record<string, T>, path: string): Record<string, T> {
  const keys = Object.keys(provenance);
  if (!keys.some((key) => isUnder(key, path))) return provenance;
  const out: Record<string, T> = {};
  for (const key of keys) {
    const source = provenance[key];
    if (source !== undefined && !isUnder(key, path)) out[key] = source;
  }
  return out;
}

/**
 * The record with every `steps[i]…` key moved to `steps[map(i)]…`, or dropped where `map` returns null.
 * Other keys (`bundle…`) stay. Used when steps are removed, inserted or reordered.
 */
export function remapStepProvenance<T>(provenance: Record<string, T>, map: (index: number) => number | null): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(provenance)) {
    const source = provenance[key];
    if (source === undefined) continue;
    const step = /^steps\[(0|[1-9][0-9]*)\](.*)$/.exec(key);
    if (step?.[1] === undefined) {
      out[key] = source;
      continue;
    }
    const next = map(Number(step[1]));
    if (next !== null) out[`steps[${next}]${step[2] ?? ""}`] = source;
  }
  return out;
}
