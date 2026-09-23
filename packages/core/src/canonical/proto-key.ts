import type { ParseSource } from "../model/io";
import { MAX_JSON_DEPTH } from "../model/schema";

/**
 * The one object key untrusted JSON may not carry. `JSON.parse` keeps `"__proto__"` as an own property, but
 * any copy written as `out[key] = value` sends it through `Object.prototype`'s accessor instead: the value
 * vanishes, or (when it's an object) becomes the copy's prototype. Studio never writes this key, so a file,
 * link or stored record that holds one is refused rather than guessed at.
 */
export const PROTO_KEY = "__proto__";

/** What `formatParseIssue` prints after the key's path: `recipe.json: owners.__proto__ is a reserved …`. */
export const PROTO_KEY_MESSAGE = "is a reserved field name. Remove the field and try again.";

/** The same for a share link, which the person can't edit: share/link.ts's "Ask for the link again." */
export const PROTO_KEY_LINK_MESSAGE = "is a reserved field name. Ask for the link again.";

/** The message for where the input came from: a link gets the link wording, a file or stored project the file's. */
export function protoKeyMessage(source: ParseSource): string {
  return source === "link" ? PROTO_KEY_LINK_MESSAGE : PROTO_KEY_MESSAGE;
}

/**
 * The path to the first `"__proto__"` key, depth-first in key order, ending with that key; null when there's
 * none. Run it on parsed JSON before anything copies it. Stops descending at `MAX_JSON_DEPTH`, as
 * `findLoneSurrogate` does: input nested past that is refused by `validate`'s own depth guard instead.
 */
export function findProtoKey(value: unknown, path: readonly (string | number)[] = []): (string | number)[] | null {
  if (value === null || typeof value !== "object") return null;
  if (path.length >= MAX_JSON_DEPTH) return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const found = findProtoKey(value[index], [...path, index]);
      if (found !== null) return found;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    if (key === PROTO_KEY) return [...path, key];
    const found = findProtoKey((value as Record<string, unknown>)[key], [...path, key]);
    if (found !== null) return found;
  }
  return null;
}
