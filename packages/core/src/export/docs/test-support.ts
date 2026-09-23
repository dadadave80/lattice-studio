/**
 * A JSON Schema checker for `index.test.ts` (not exported from the barrel): enough of the 2020-12 vocabulary
 * to walk what `z.toJSONSchema(RecipeSchema, { io: "input" })` emits (`model/schema.test.ts` pins the shape) —
 * `$ref`/`$defs`, `oneOf`, `anyOf`, `const`, `enum`, `type`, `properties`/`required`/`additionalProperties`,
 * `propertyNames`, `items`, `pattern` — so `recipeJsonSchema()` can be checked against real recipes without an
 * AJV dependency core doesn't have.
 */
export type JsonSchema = Record<string, unknown>;

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function resolveRef(ref: string, root: JsonSchema): JsonSchema {
  if (!ref.startsWith("#/")) throw new Error(`schemaMatches: unsupported $ref "${ref}".`);
  let node: unknown = root;
  for (const key of ref.slice(2).split("/")) {
    if (typeof node !== "object" || node === null) throw new Error(`schemaMatches: "${ref}" doesn't resolve.`);
    node = (node as Record<string, unknown>)[key];
  }
  return node as JsonSchema;
}

function matchesObject(value: Record<string, unknown>, schema: JsonSchema, root: JsonSchema): boolean {
  for (const key of Array.isArray(schema.required) ? (schema.required as string[]) : []) {
    if (!(key in value)) return false;
  }
  const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const propertyNames = schema.propertyNames as JsonSchema | undefined;
  const additional = schema.additionalProperties;
  for (const [key, member] of Object.entries(value)) {
    if (propertyNames && !schemaMatches(key, propertyNames, root)) return false;
    if (Object.hasOwn(props, key)) {
      if (!schemaMatches(member, props[key] as JsonSchema, root)) return false;
      continue;
    }
    if (additional === false) return false;
    if (additional && typeof additional === "object" && !schemaMatches(member, additional as JsonSchema, root)) return false;
  }
  return true;
}

/** Whether `value` satisfies `schema` (with `root` for `$ref` resolution). Unsupported keywords are ignored. */
export function schemaMatches(value: unknown, schema: JsonSchema, root: JsonSchema = schema): boolean {
  if (typeof schema.$ref === "string") return schemaMatches(value, resolveRef(schema.$ref, root), root);
  if (Array.isArray(schema.oneOf)) return (schema.oneOf as JsonSchema[]).filter((s) => schemaMatches(value, s, root)).length === 1;
  if (Array.isArray(schema.anyOf)) return (schema.anyOf as JsonSchema[]).some((s) => schemaMatches(value, s, root));
  if (Object.hasOwn(schema, "const")) return deepEqual(value, schema.const);
  if (Array.isArray(schema.enum)) return schema.enum.some((option) => deepEqual(value, option));
  switch (schema.type) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value)
        ? matchesObject(value as Record<string, unknown>, schema, root)
        : false;
    case "array": {
      if (!Array.isArray(value)) return false;
      const items = schema.items as JsonSchema | undefined;
      return items === undefined || value.every((item) => schemaMatches(item, items, root));
    }
    case "string":
      return typeof value === "string" && (typeof schema.pattern !== "string" || new RegExp(schema.pattern).test(value));
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    default:
      return true;
  }
}

/** What `readInline` found: the text a CommonMark renderer shows, and every construct it would have opened. */
export type InlineReading = { text: string; openers: string[] };

const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/;
const ENTITIES: readonly (readonly [string, string])[] = [["&amp;", "&"], ["&lt;", "<"], ["&gt;", ">"]];

/**
 * Reads one line of generated Markdown the way CommonMark's inline parser (plus GFM tables and strikethrough)
 * would, for text meant to hold no inline construct at all: a backslash before ASCII punctuation is that
 * character (§2.4), `&amp;` `&lt;` `&gt;` are theirs (§2.5), a backslash before anything else is itself.
 * Anything that could open a construct is listed in `openers` instead: an unescaped `` ` `` (code span),
 * `*` `_` (emphasis), `~` (strikethrough), `[` `]` (links; `![` images), `<` `>` (autolinks, raw HTML), `|`
 * (a table cell), an `&` that starts any other entity, a `#` that starts the line, a trailing backslash (a
 * hard break), and GFM extended-autolink triggers: an unescaped `://`, `www.` or `@`. So `readInline(md)` returning `{ text: t, openers: [] }` means `md` renders as exactly `t`.
 *
 * With `spans`, code spans are allowed (for copy that marks code, like a problem message): an unescaped
 * backtick run closed by a later run of exactly its length (§6.1) is read as a span, its content verbatim,
 * and a run with no closer is literal text. Nothing inside a span opens a construct.
 */
export function readInline(md: string, spans = false): InlineReading {
  const openers: string[] = [];
  let text = "";
  if (md.startsWith("#")) openers.push("# at 0");
  for (let at = 0; at < md.length; at++) {
    const char = md[at] ?? "";
    if (char === "`" && spans) {
      const run = /^`+/.exec(md.slice(at))?.[0] ?? "`";
      const close = new RegExp(`(?<!\`)${run}(?!\`)`, "g");
      close.lastIndex = at + run.length;
      const found = close.exec(md);
      const end = found === null ? at + run.length : found.index + run.length;
      text += md.slice(at, end);
      at = end - 1;
      continue;
    }
    if (char === "\\") {
      const next = md[at + 1];
      if (next === undefined) openers.push(`\\ at ${at}`);
      if (next !== undefined && ASCII_PUNCTUATION.test(next)) {
        text += next;
        at++;
      } else {
        text += char;
      }
      continue;
    }
    if (char === "&") {
      const entity = ENTITIES.find(([name]) => md.startsWith(name, at));
      if (entity === undefined) {
        openers.push(`& at ${at}`);
        text += char;
      } else {
        text += entity[1];
        at += entity[0].length - 1;
      }
      continue;
    }
    if ("`*_~[]<>|".includes(char)) openers.push(`${char} at ${at}`);
    // GFM extended autolinks: a scheme's `://`, `www.` (any case) and an email's `@`, each unescaped.
    if (char === ":" && md.startsWith("//", at + 1)) openers.push(`:// at ${at}`);
    if (/^www\./i.test(md.slice(at, at + 4))) openers.push(`www. at ${at}`);
    if (char === "@") openers.push(`@ at ${at}`);
    text += char;
  }
  return { text, openers };
}
