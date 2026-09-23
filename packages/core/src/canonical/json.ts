import type { CanonicalJsonFn } from "../model/api";

/** A lone UTF-16 surrogate: RFC 8785 §3.2.2.2 requires an error, since it has no UTF-8 encoding. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function describePath(path: readonly (string | number)[]): string {
  if (path.length === 0) return "the value";
  return path.map((key) => (typeof key === "number" ? `[${key}]` : `[${JSON.stringify(key)}]`)).join("");
}

function reject(path: readonly (string | number)[], what: string): never {
  throw new TypeError(`canonicalJson: ${describePath(path)} is ${what}, which JSON can't hold.`);
}

/** JCS string escaping is ECMAScript's (RFC 8785 §3.2.2.2), once lone surrogates are ruled out. */
function serializeString(value: string, path: readonly (string | number)[]): string {
  if (LONE_SURROGATE.test(value)) reject(path, "text with a lone surrogate");
  return JSON.stringify(value);
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function serialize(value: unknown, path: (string | number)[], ancestors: Set<object>): string {
  switch (typeof value) {
    case "string":
      return serializeString(value, path);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      // ECMAScript Number::toString is exactly RFC 8785 §3.2.2.3 (and -0 prints as 0).
      if (!Number.isFinite(value)) reject(path, String(value));
      return JSON.stringify(value);
    case "object":
      break;
    default:
      return reject(path, typeof value);
  }
  if (value === null) return "null";
  if (ancestors.has(value)) reject(path, "a reference to itself");
  ancestors.add(value);
  let out: string;
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) reject([...path, index], "a hole in a list");
      items.push(serialize(value[index], [...path, index], ancestors));
    }
    out = `[${items.join(",")}]`;
  } else {
    if (!isPlainObject(value)) reject(path, `a ${value.constructor?.name ?? "non-plain"} object`);
    const record = value as Record<string, unknown>;
    // The default sort compares UTF-16 code units, which is RFC 8785 §3.2.3's order.
    const keys = Object.keys(record).sort();
    const members = keys.map((key) => `${serializeString(key, [...path, key])}:${serialize(record[key], [...path, key], ancestors)}`);
    out = `{${members.join(",")}}`;
  }
  ancestors.delete(value);
  return out;
}

/**
 * RFC 8785 (JCS) canonical JSON: object keys sorted by UTF-16 code units, ECMAScript number serialization,
 * ECMAScript string escaping, no whitespace. Accepts readonly structures (a viem ABI). Throws a `TypeError`
 * on anything JSON can't hold: `undefined` (also as a property value), bigint, functions, symbols, NaN and
 * the infinities, lone surrogates, holes in lists, cycles and objects that aren't plain (Date, Map, class
 * instances). Symbol-keyed properties are ignored, as `JSON.stringify` ignores them.
 */
export const canonicalJson: CanonicalJsonFn = (value) => serialize(value, [], new Set());
