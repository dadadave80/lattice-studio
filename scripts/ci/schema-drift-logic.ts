// Pure logic behind `bun scripts/ci/schema-drift.ts` (brief Q6 "schema drift"): compare a freshly generated
// JSON Schema against a committed snapshot, key path by key path, so a drift says exactly where it happened
// instead of dumping two blobs.

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type DriftLine = { readonly path: string; readonly expected: string; readonly actual: string };

function describe(value: JsonValue | undefined): string {
  if (value === undefined) return "(missing)";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return Array.isArray(value) ? "[array]" : "{object}";
}

/** Walks both trees in lockstep; a leaf that differs, or a key present on only one side, is one line. */
export function diffJson(expected: JsonValue, actual: JsonValue, path = "$"): DriftLine[] {
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return [{ path, expected: describe(expected), actual: describe(actual) }];
    if (expected.length !== actual.length) {
      return [{ path: `${path}.length`, expected: String(expected.length), actual: String(actual.length) }];
    }
    return expected.flatMap((item, i) => diffJson(item, actual[i] as JsonValue, `${path}[${i}]`));
  }
  if (expected !== null && actual !== null && typeof expected === "object" && typeof actual === "object") {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    const lines: DriftLine[] = [];
    for (const key of [...keys].sort()) {
      const e = (expected as Record<string, JsonValue>)[key];
      const a = (actual as Record<string, JsonValue>)[key];
      if (e === undefined || a === undefined) lines.push({ path: `${path}.${key}`, expected: describe(e), actual: describe(a) });
      else lines.push(...diffJson(e, a, `${path}.${key}`));
    }
    return lines;
  }
  return expected === actual ? [] : [{ path, expected: describe(expected), actual: describe(actual) }];
}

export function formatDrift(lines: readonly DriftLine[]): string {
  return lines.map((l) => `  ${l.path}: expected ${l.expected}, got ${l.actual}`).join("\n");
}
