/**
 * Issue paths and the nesting limit, kept free of Zod so the app's first load can leave validation to a lazy
 * chunk (`@lattice-studio/core/schema`; CCR from FX15).
 */

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** `["facets", 3]` → `facets[3]`; `["owners", "0xcdfe7f5c"]` → `owners["0xcdfe7f5c"]`; `[]` → "". */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const key of path) {
    if (typeof key === "number") out += `[${key}]`;
    else if (typeof key === "string" && IDENTIFIER.test(key)) out += out ? `.${key}` : key;
    else out += `[${JSON.stringify(String(key))}]`;
  }
  return out;
}

/** No file, link or record Studio reads nests anywhere near this deep; hostile input that does is refused. */
export const MAX_JSON_DEPTH = 64;
