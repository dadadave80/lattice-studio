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
