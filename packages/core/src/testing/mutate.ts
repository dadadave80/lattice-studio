/**
 * Malformed JSON documents with a known defect, for the hostile-input properties (spec L857, L936): one member
 * deleted, retyped or given a hostile key, and the path an error about it should name.
 */
import fc from "fast-check";
import { formatPath } from "../model/schema";

/** A step into a JSON document: an object key or an array index. */
export type JsonStep = string | number;

/** `["init", "steps", 0, "args"]` as `init.steps[0].args`, the way parse errors print paths (`owners["0x…"]`). */
export function formatJsonPath(path: readonly JsonStep[]): string {
  return formatPath(path);
}

/** Every path in `value` (the root included), depth first. */
export function jsonPaths(value: unknown, at: JsonStep[] = []): JsonStep[][] {
  const out: JsonStep[][] = [at];
  if (Array.isArray(value)) value.forEach((item, i) => out.push(...jsonPaths(item, [...at, i])));
  else if (value !== null && typeof value === "object") for (const [key, item] of Object.entries(value)) out.push(...jsonPaths(item, [...at, key]));
  return out;
}

/** The member at `path`, or undefined. */
export function jsonAt(value: unknown, path: readonly JsonStep[]): unknown {
  let here: unknown = value;
  for (const step of path) {
    if (here === null || typeof here !== "object") return undefined;
    here = (here as Record<string | number, unknown>)[step];
  }
  return here;
}

/** A copy of `value` with the member at `path` replaced (or, with `remove`, deleted; array items are spliced out). */
export function jsonWith(value: unknown, path: readonly JsonStep[], replacement: unknown, remove = false): unknown {
  const [step, ...rest] = path;
  if (step === undefined) return replacement;
  if (Array.isArray(value)) {
    const copy = [...(value as unknown[])];
    if (rest.length === 0 && remove) copy.splice(Number(step), 1);
    else copy[Number(step)] = jsonWith(copy[Number(step)], rest, replacement, remove);
    return copy;
  }
  if (value === null || typeof value !== "object") return value;
  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key !== String(step)) copy[key] = item;
    else if (rest.length > 0 || !remove) copy[key] = jsonWith(item, rest, replacement, remove);
  }
  return copy;
}

/** The JSON kind of a value: null, array, object, string, number or boolean. */
export function jsonKind(value: unknown): "null" | "array" | "object" | "string" | "number" | "boolean" | "other" {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const kind = typeof value;
  return kind === "object" || kind === "string" || kind === "number" || kind === "boolean" ? kind : "other";
}

/**
 * A value of another JSON kind than `value` (so an object also becomes an array or null), or a hostile string
 * where a string was.
 */
export function retyped(value: unknown): fc.Arbitrary<unknown> {
  const options: unknown[] = [null, 0, -1, 1.5, true, [], ["x"], {}, { x: 1 }, "", "0xZZ", "‮", 1e308, "__proto__"];
  const kind = jsonKind(value);
  return fc.constantFrom(...options.filter((option) => jsonKind(option) !== kind || (kind === "string" && option !== value)));
}

/** One defect in a document: what was done, where, and the resulting JSON text. */
export type Mutation = { kind: "delete" | "retype" | "truncate"; path: JsonStep[]; text: string };

/**
 * One defect in `document`: a member deleted, a member retyped, or the serialized text cut short. The root is
 * never deleted.
 */
export function mutationArb(document: unknown): fc.Arbitrary<Mutation> {
  const paths = jsonPaths(document);
  const members = paths.filter((path) => path.length > 0);
  const text = JSON.stringify(document, null, 2);
  const options: fc.Arbitrary<Mutation>[] = [
    fc.constantFrom(...paths).chain((path) =>
      retyped(jsonAt(document, path)).map((replacement): Mutation => ({ kind: "retype", path, text: JSON.stringify(jsonWith(document, path, replacement)) })),
    ),
    fc.integer({ min: 0, max: Math.max(0, text.length - 1) }).map((cut): Mutation => ({ kind: "truncate", path: [], text: text.slice(0, cut) })),
  ];
  if (members.length > 0) {
    options.push(fc.constantFrom(...members).map((path): Mutation => ({ kind: "delete", path, text: JSON.stringify(jsonWith(document, path, undefined, true)) })));
  }
  return fc.oneof(...options);
}

/** JSON text of `document` with `"<key>": <value>` added first in the object at `path` (which must be an object). */
export function withExtraKey(document: unknown, path: readonly JsonStep[], key: string, value: unknown): string {
  const write = (node: unknown, at: readonly JsonStep[]): string => {
    if (Array.isArray(node)) return `[${node.map((item, i) => write(item, [...at, i])).join(",")}]`;
    if (node === null || typeof node !== "object") return JSON.stringify(node);
    const members = Object.entries(node).map(([k, item]) => `${JSON.stringify(k)}:${write(item, [...at, k])}`);
    const here = at.length === path.length && at.every((step, i) => step === path[i]);
    if (here) members.unshift(`${JSON.stringify(key)}:${JSON.stringify(value)}`);
    return `{${members.join(",")}}`;
  };
  return write(document, []);
}

/** Paths of every object in `document`. */
export function objectPaths(document: unknown): JsonStep[][] {
  return jsonPaths(document).filter((path) => {
    const node = jsonAt(document, path);
    return node !== null && typeof node === "object" && !Array.isArray(node);
  });
}

/**
 * True when `issue` points at the defect at `defect`: the same path, a member inside it, or an enclosing member
 * (a union that can't tell which branch failed reports its parent). The document's root and its top-level
 * `containers` (a project file's `project`) don't count as enclosing members: an issue there isn't precise.
 */
export function pathsRelated(issue: string, defect: string, containers: readonly string[] = []): boolean {
  if (issue === defect) return true;
  const enclosing = issue !== "" && !containers.includes(issue);
  if (enclosing && (defect.startsWith(`${issue}.`) || defect.startsWith(`${issue}[`))) return true;
  return defect !== "" && (issue.startsWith(`${defect}.`) || issue.startsWith(`${defect}[`));
}
