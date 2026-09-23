// Readable drift between an expected routing file and what Lattice's script builds now.

import { type RoutingFile, serialize } from "./report.ts";

const NONE = "(not routed)";

/** One line per difference, empty when the files say the same thing. */
export function diffRouting(expected: RoutingFile, actual: RoutingFile): string[] {
  const out: string[] = [];
  for (const key of ["recipe", "script", "buildCuts"] as const) {
    if (expected[key] !== actual[key]) out.push(`${key}: ${expected[key]} → ${actual[key]}`);
  }
  if (expected.facets.join(",") !== actual.facets.join(",")) {
    out.push(`facets: [${expected.facets.join(", ")}] → [${actual.facets.join(", ")}]`);
  }

  const selectors = [...new Set([...Object.keys(expected.routing), ...Object.keys(actual.routing)])].sort();
  for (const s of selectors) {
    const was = expected.routing[s] ?? NONE;
    const now = actual.routing[s] ?? NONE;
    const sig = actual.signatures[s] ?? expected.signatures[s] ?? "";
    const label = sig ? `${s} ${sig}` : s;
    if (was !== now) out.push(`${label}: ${was} → ${now}`);
    else if (expected.signatures[s] !== actual.signatures[s]) {
      out.push(`${s}: signature ${expected.signatures[s] ?? "(none)"} → ${actual.signatures[s] ?? "(none)"}`);
    }
  }

  if (expected.init.kind !== actual.init.kind) out.push(`init: ${expected.init.kind} → ${actual.init.kind}`);
  const steps = Math.max(expected.init.steps.length, actual.init.steps.length);
  for (let i = 0; i < steps; i++) {
    const was = expected.init.steps[i];
    const now = actual.init.steps[i];
    const a = was ? `${was.init}.${was.signature} (${was.selector})` : "(no step)";
    const b = now ? `${now.init}.${now.signature} (${now.selector})` : "(no step)";
    if (a !== b) out.push(`init step ${i}: ${a} → ${b}`);
  }

  // Anything else (an extra key, a reordered object) still counts: the file must be exactly what --update writes.
  if (out.length === 0 && serialize(expected) !== serialize(actual)) {
    out.push("the file differs from what --update writes (extra keys or a different key order)");
  }
  return out;
}

/** Parses an expected file's text. Returns an error message instead of throwing. */
export function parseRoutingFile(text: string): { ok: true; value: RoutingFile } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `isn't valid JSON (${e instanceof Error ? e.message : String(e)})` };
  }
  if (!isRoutingFile(json)) return { ok: false, error: "doesn't have the routing file's shape" };
  return { ok: true, value: json };
}

function isRoutingFile(v: unknown): v is RoutingFile {
  if (!isObject(v)) return false;
  const init = v["init"];
  return (
    typeof v["recipe"] === "string" &&
    typeof v["script"] === "string" &&
    typeof v["buildCuts"] === "string" &&
    Array.isArray(v["facets"]) &&
    v["facets"].every((f) => typeof f === "string") &&
    isStringRecord(v["routing"]) &&
    isStringRecord(v["signatures"]) &&
    isObject(init) &&
    typeof init["kind"] === "string" &&
    Array.isArray(init["steps"]) &&
    init["steps"].every(
      (s) =>
        isObject(s) &&
        typeof s["init"] === "string" &&
        typeof s["selector"] === "string" &&
        typeof s["signature"] === "string",
    )
  );
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return isObject(v) && Object.values(v).every((x) => typeof x === "string");
}
