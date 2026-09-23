/**
 * Zod 4 schemas for everything Studio reads from outside (contracts §3.2): recipes, projects, project files,
 * deployment records, the catalog index and manifest, facet shards and the share payload.
 *
 * - Objects are loose: unknown fields survive parsing, and `listUnknownFields` reports their paths (spec L289).
 * - No transforms: normalization (lowercase hex, checksums, catalog order) is C1's `normalizeRecipe`, and
 *   `z.toJSONSchema(RecipeSchema)` must work for the published recipe schema (C7b).
 * - Hex is accepted in any letter case; an address that isn't all lowercase must be its EIP-55 checksum.
 * - Hashes, salts and slots are exactly 32 bytes (`Hash32Schema`); selectors 4; entropy 11.
 * - JSON nested deeper than `MAX_JSON_DEPTH` is refused before Zod sees it.
 * - Issues come back as `{ path, message }`: `facets[0]` / "is 1; expected text."
 */
import * as z from "zod";

// Studio ships a strict CSP with no 'unsafe-eval'; Zod's JIT probes `new Function` (caught, but it still files a
// CSP report). Validation without the JIT is fast enough for Studio's documents (CCR from S11a).
z.config({ jitless: true });
import type { AbiItem, Catalog, CatalogManifest, FacetDetail, InitParam } from "./catalog";
import { isAddress } from "./hex";
import { formatPath, MAX_JSON_DEPTH } from "./path";
import type { ParseIssue } from "./io";
import type { Json } from "./json";
import type { Deployment, Project, ProjectFile } from "./project";
import type { Arg, Recipe } from "./recipe";
import { err, ok, type Result } from "./result";

// ── messages ───────────────────────────────────────────────────────────────────────────────────────

/** How a value reads inside a message: `"0xabc"`, `2`, `a list`. */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value.length > 48 ? `${value.slice(0, 47)}…` : value);
    case "number":
    case "boolean":
    case "bigint":
      return String(value);
    case "object":
      return "an object";
    default:
      return typeof value;
  }
}

/** The message for an absent required field. */
const MISSING = "is missing.";

/** An error function for a schema: "is missing." or `is <value>; expected <what>.` */
function expected(what: string): (issue: { input?: unknown }) => string {
  return (issue) => (issue.input === undefined ? MISSING : `is ${describe(issue.input)}; expected ${what}.`);
}

const EXPECTED_TYPE: Record<string, string> = {
  string: "text",
  number: "a number",
  int: "a whole number",
  boolean: "true or false",
  array: "a list",
  object: "an object",
  record: "an object",
  null: "null",
  literal: "a fixed value",
  template_literal: "text",
};

function joinOr(items: readonly string[]): string {
  const unique = [...new Set(items)];
  if (unique.length <= 1) return unique[0] ?? "something else";
  return `${unique.slice(0, -1).join(", ")} or ${unique.at(-1)}`;
}

/** Per-parse messages for issues whose schema sets none. */
const issueMessage: z.core.$ZodErrorMap = (issue) => {
  if (issue.input === undefined) return MISSING;
  switch (issue.code) {
    case "invalid_type":
      return `is ${describe(issue.input)}; expected ${EXPECTED_TYPE[issue.expected] ?? issue.expected}.`;
    case "invalid_value":
      return `is ${describe(issue.input)}; expected ${joinOr(issue.values.map((v) => JSON.stringify(v)))}.`;
    case "too_small":
      return `is ${describe(issue.input)}; expected at least ${String(issue.minimum)}${issue.origin === "string" ? " characters" : issue.origin === "array" ? " items" : ""}.`;
    case "too_big":
      return `is ${describe(issue.input)}; expected at most ${String(issue.maximum)}${issue.origin === "string" ? " characters" : issue.origin === "array" ? " items" : ""}.`;
    case "invalid_format":
      return `is ${describe(issue.input)}; expected ${issue.format === "regex" ? "a different format" : issue.format}.`;
    case "invalid_union":
      return `is ${describe(issue.input)}; expected ${joinOr(issue.errors.map((branch) => {
        const first = branch[0];
        return first && first.code === "invalid_type" ? (EXPECTED_TYPE[first.expected] ?? first.expected) : "another shape";
      }))}.`;
    default:
      return undefined;
  }
};

// ── paths and issues ───────────────────────────────────────────────────────────────────────────────


/** How deep a union branch got before failing: the branch that got furthest explains the failure best. */
function branchDepth(branch: readonly z.core.$ZodIssue[]): number {
  let depth = 0;
  for (const issue of branch) {
    const nested = issue.code === "invalid_union" ? Math.max(0, ...issue.errors.map(branchDepth)) : 0;
    depth = Math.max(depth, issue.path.length + nested);
  }
  return depth;
}

/**
 * Issues that only say the value has the wrong shape for this branch (a field it lacks, a key it has):
 * on a tie in depth, the branch with fewer of them is the one the input meant.
 */
function branchMisfit(branch: readonly z.core.$ZodIssue[]): number {
  return branch.filter((issue) => issue.message === MISSING || issue.code === "unrecognized_keys").length;
}

function flatten(issue: z.core.$ZodIssue, base: readonly PropertyKey[]): { path: PropertyKey[]; message: string }[] {
  const path = [...base, ...issue.path];
  if (issue.code === "invalid_union" && issue.errors.length > 0) {
    let best: readonly z.core.$ZodIssue[] = [];
    let bestDepth = 0;
    let bestMisfit = Number.POSITIVE_INFINITY;
    for (const branch of issue.errors) {
      const depth = branchDepth(branch);
      const misfit = branchMisfit(branch);
      if (depth > bestDepth || (depth === bestDepth && depth > 0 && misfit < bestMisfit)) {
        best = branch;
        bestDepth = depth;
        bestMisfit = misfit;
      }
    }
    if (bestDepth > 0) return best.flatMap((inner) => flatten(inner, path));
  }
  if ((issue.code === "invalid_key" || issue.code === "invalid_element") && issue.issues.length > 0) {
    return issue.issues.flatMap((inner) => flatten(inner, path));
  }
  return [{ path, message: issue.message }];
}

/** Zod issues as `{ path, message }`, one per path, in document order. */
export function toParseIssues(error: z.ZodError): ParseIssue[] {
  const seen = new Set<string>();
  const out: ParseIssue[] = [];
  for (const issue of error.issues) {
    for (const flat of flatten(issue, [])) {
      const path = formatPath(flat.path);
      if (seen.has(path)) continue;
      seen.add(path);
      out.push({ path, message: flat.message });
    }
  }
  return out;
}

// ── primitives ─────────────────────────────────────────────────────────────────────────────────────

/** Hex bytes, any letter case: `0x` then pairs of hex digits. */
export const HexSchema = z.templateLiteral(["0x", z.string().regex(/^(?:[0-9a-fA-F]{2})*$/)], {
  error: expected("hex bytes (0x followed by pairs of hex digits)"),
});

/**
 * A 32-byte value, any letter case: hashes (recipe, catalog, code, init code, shards), salts, storage slots,
 * transaction hashes. `"0x"` and short values fail.
 */
export const Hash32Schema = z.templateLiteral(["0x", z.string().regex(/^[0-9a-fA-F]{64}$/)], {
  error: expected("a 32-byte hash (0x followed by 64 hex digits)"),
});

/** A 4-byte selector, any letter case. */
export const Hex4Schema = z.templateLiteral(["0x", z.string().regex(/^[0-9a-fA-F]{8}$/)], {
  error: expected("a 4-byte selector (0x followed by 8 hex digits)"),
});

/** 11 bytes of salt entropy (spec L238). */
export const EntropySchema = z.templateLiteral(["0x", z.string().regex(/^[0-9a-fA-F]{22}$/)], {
  error: expected("11 bytes of entropy (0x followed by 22 hex digits)"),
});

/** A 20-byte address: all lowercase, or exactly its EIP-55 checksum (so all-uppercase fails). */
export const AddressSchema = z
  .templateLiteral(["0x", z.string().regex(/^[0-9a-fA-F]{40}$/)], {
    error: expected("an address (0x followed by 40 hex digits)"),
  })
  .refine(isAddress, { error: (issue) => `is ${describe(issue.input)}; its EIP-55 checksum doesn't match.`, abort: true });

/** Any JSON value. */
export const JsonValueSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)]),
);

/** `{ "$ref": "self" | "deployer" }` (spec L227, L285). */
export const RefSchema = z.strictObject({ $ref: z.enum(["self", "deployer"]) });

/**
 * An init argument (spec L224-L227). Numbers aren't arguments: integers travel as decimal strings, because
 * canonical JSON would round anything above 2^53 (spec L283). An object may not use the key `$ref` except as
 * a reference, so `{ "$ref": "me" }` fails instead of passing as a plain object.
 */
export const ArgSchema: z.ZodType<Arg> = z.lazy(() =>
  z.union(
    [z.string(), z.boolean(), z.array(ArgSchema), RefSchema, z.record(z.string().regex(/^(?!\$ref$)/), ArgSchema)],
    {
      error: expected('text (integers as decimal strings), true or false, a list, an object or {"$ref": "self" | "deployer"}'),
    },
  ),
);

const text = z.string();
const opt = z.exactOptional;

// ── recipe, project, deployments ───────────────────────────────────────────────────────────────────

const InitArgsSchema = z.record(z.string(), ArgSchema);

const RecipeInitSchema = z.discriminatedUnion(
  "kind",
  [
    z.looseObject({ kind: z.literal("bundle"), spec: text, args: InitArgsSchema }),
    z.looseObject({ kind: z.literal("steps"), steps: z.array(z.looseObject({ spec: text, args: InitArgsSchema })) }),
    z.looseObject({ kind: z.literal("none") }),
  ],
  {
    error: (issue) => {
      const input: unknown = issue.input;
      if (input !== null && typeof input === "object" && !Array.isArray(input)) {
        const kind: unknown = (input as Record<string, unknown>)["kind"];
        return `has kind ${kind === undefined ? "missing" : describe(kind)}; expected "bundle", "steps" or "none".`;
      }
      return input === undefined ? MISSING : `is ${describe(input)}; expected an object with a kind.`;
    },
  },
);

/** `schemaVersion` is the literal 1; a newer file names the version it needs (spec L289). */
const SchemaVersionSchema = z.literal(1, {
  error: (issue) => {
    const input: unknown = issue.input;
    if (input === undefined) return MISSING;
    if (typeof input === "number" && Number.isInteger(input) && input > 1) {
      return `is ${input}: this file needs Studio schema v${input}. This Studio reads v1.`;
    }
    return `is ${describe(input)}; expected 1.`;
  },
});

/** The recipe (spec L209-L223). */
export const RecipeSchema = z.looseObject({
  $schema: opt(text),
  schemaVersion: SchemaVersionSchema,
  name: opt(text),
  catalog: z.looseObject({ tag: text, hash: Hash32Schema }),
  template: opt(z.looseObject({ name: text, catalogHash: Hash32Schema })),
  facets: z.array(text),
  owners: z.record(Hex4Schema, text),
  exclude: z.array(Hex4Schema),
  init: RecipeInitSchema,
  immutable: opt(z.literal(true)),
}) satisfies z.ZodType<Recipe>;

/** The share payload: the full recipe minus `$schema`, with no layout (spec L291). */
export const SharePayloadSchema = RecipeSchema.omit({ $schema: true }) satisfies z.ZodType<Omit<Recipe, "$schema">>;

const CardLayoutSchema = z.looseObject({
  x: z.number(),
  y: z.number(),
  pins: z.enum(["left", "right"]),
  expanded: opt(z.literal(true)),
});

/** The project (spec L233-L243). */
export const ProjectSchema = z.looseObject({
  id: text,
  name: text,
  recipe: RecipeSchema,
  layout: z.record(text, CardLayoutSchema),
  deploy: z.looseObject({
    path: z.enum(["factory", "createx"]),
    entropy: EntropySchema,
    scope: z.enum(["every-chain", "this-chain"]),
  }),
  provenance: z.record(text, z.enum(["link", "file", "confirmed"])),
  predicted: z.array(z.looseObject({ chainId: z.int().positive(), address: AddressSchema })),
}) satisfies z.ZodType<Project>;

/** A deployment record (spec L244-L253). */
export const DeploymentSchema = z.looseObject({
  projectId: text,
  chainId: z.int().positive(),
  address: AddressSchema,
  path: z.enum(["factory", "createx"]),
  deployer: AddressSchema,
  salt: Hash32Schema,
  status: z.enum(["pending", "proposed", "confirmed", "mismatch", "failed"]),
  tx: opt(Hash32Schema),
  safeTxHash: opt(Hash32Schema),
  callsId: opt(text),
  block: opt(z.int().nonnegative()),
  recipeHash: Hash32Schema,
  catalogHash: Hash32Schema,
  at: text,
  verification: z.enum(["pending", "match", "exact_match", "failed"]),
  revision: z.int().positive(),
  fromFile: opt(z.literal(true)),
}) satisfies z.ZodType<Deployment>;

/** A `.lattice.json` file (spec L254). */
export const ProjectFileSchema = z.looseObject({
  project: ProjectSchema,
  deployments: z.array(DeploymentSchema),
}) satisfies z.ZodType<ProjectFile>;

// ── catalog ────────────────────────────────────────────────────────────────────────────────────────

export const AREAS = [
  "access", "accounts", "amm", "crosschain", "defi", "diamond", "ens",
  "governance", "oracles", "privacy", "security", "tokens", "utils",
] as const;

export const ShardRefSchema = z.looseObject({ path: text, bytes: z.int().nonnegative(), hash: Hash32Schema });

export const SharedContractSchema = z.looseObject({
  salt: Hash32Schema,
  version: text,
  address: AddressSchema,
  codehash: Hash32Schema,
  initCodeHash: Hash32Schema,
  creationCode: ShardRefSchema,
  detail: opt(ShardRefSchema),
  dependsOn: opt(z.array(text)),
  provisional: opt(text),
});

export const FacetSchema = z.looseObject({
  name: text,
  area: z.enum(AREAS),
  source: text,
  summary: text,
  selectors: z.array(z.looseObject({ hex: Hex4Schema, signature: text })),
  storage: opt(z.looseObject({ id: text, slot: Hash32Schema })),
  touches: z.array(text),
  release: SharedContractSchema,
  requires: z.array(z.looseObject({ anyOf: z.array(text), strength: z.enum(["hard", "convention"]), reason: text })),
  family: opt(z.enum(["upgrade", "access", "account"])),
  defaultOwnerOf: opt(z.array(Hex4Schema)),
  init: opt(text),
  detail: ShardRefSchema,
});

export const SeamSchema = z.looseObject({ selector: Hex4Schema, when: z.array(text), anyOf: z.array(text), reason: text });

export const InitParamSchema: z.ZodType<InitParam> = z.lazy(() =>
  z.looseObject({
    name: text,
    type: text,
    doc: text,
    unit: opt(z.enum(["seconds", "percent", "wei"])),
    rule: opt(text),
    example: opt(JsonValueSchema),
    exampleSource: opt(text),
    authority: opt(z.literal(true)),
    role: opt(text),
    components: opt(z.array(InitParamSchema)),
  }),
);

export const InitSpecSchema = z.looseObject({
  name: text,
  contract: text,
  fn: text,
  kind: z.enum(["step", "bundle"]),
  params: z.array(InitParamSchema),
  initializes: z.array(z.looseObject({ module: text, with: opt(z.record(text, text)) })),
  after: z.array(text),
  sameCall: z.array(text),
  sequence: opt(z.array(text)),
  registersInterfaces: opt(z.literal(true)),
  ctorArgs: opt(z.array(z.looseObject({ name: text, type: text }))),
  release: opt(SharedContractSchema),
});

export const RecipeTemplateSchema = z.looseObject({
  name: text,
  script: text,
  proxy: z.enum(["Lattice", "AccountDiamond", "ModularAccount6900"]),
  recipe: RecipeSchema,
  phase: z.enum(["v1", "v1.1", "later"]),
});

export const ChainReleaseSchema = z.looseObject({
  chainId: z.int().positive(),
  factory: opt(
    z.looseObject({
      address: AddressSchema,
      codehash: Hash32Schema,
      buildCommit: text,
      proxyStandardJson: ShardRefSchema,
      proxyInitCodeHash: Hash32Schema,
    }),
  ),
});

/** The catalog index (spec L139-L148, contracts §3.1, §4 `index.json`). */
export const CatalogSchema = z.looseObject({
  lattice: z.looseObject({ tag: text, commit: text }),
  toolchain: z.looseObject({ foundry: text, solc: text }),
  hash: Hash32Schema,
  deployer: z.looseObject({ address: AddressSchema, codehash: Hash32Schema }),
  registry: SharedContractSchema,
  factory: SharedContractSchema,
  proxy: z.looseObject({
    creationCode: ShardRefSchema,
    initCodeHash: Hash32Schema,
    standardJson: ShardRefSchema,
    detail: opt(ShardRefSchema),
  }),
  facets: z.array(FacetSchema),
  inits: z.array(InitSpecSchema),
  recipes: z.array(RecipeTemplateSchema),
  chains: z.array(ChainReleaseSchema),
  seams: z.array(SeamSchema),
  provisional: opt(text),
  libraries: opt(z.array(z.looseObject({ name: text, release: SharedContractSchema }))),
  registryOwner: opt(AddressSchema),
}) satisfies z.ZodType<Catalog>;

/** `catalog/manifest.json` (contracts §4). */
export const CatalogManifestSchema = z.looseObject({
  default: text,
  catalogs: z.array(z.looseObject({ id: text, tag: text, commit: text, hash: Hash32Schema, path: text })),
}) satisfies z.ZodType<CatalogManifest>;

const MUTABILITY = new Set(["pure", "view", "nonpayable", "payable"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOptional(value: unknown, type: "string" | "boolean"): boolean {
  return value === undefined || typeof value === type;
}

function isAbiParameter(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["type"] === "string" &&
    isOptional(value["name"], "string") &&
    isOptional(value["internalType"], "string") &&
    isOptional(value["indexed"], "boolean") &&
    (value["components"] === undefined || isAbiParameters(value["components"]))
  );
}

function isAbiParameters(value: unknown): boolean {
  return Array.isArray(value) && value.every(isAbiParameter);
}

/** Structural guard for one ABI entry, as solc emits it. */
export function isAbiItem(value: unknown): value is AbiItem {
  if (!isRecord(value)) return false;
  const named = typeof value["name"] === "string";
  switch (value["type"]) {
    case "function":
      return named && isAbiParameters(value["inputs"]) && isAbiParameters(value["outputs"]) && MUTABILITY.has(String(value["stateMutability"]));
    case "event":
      return named && isAbiParameters(value["inputs"]) && isOptional(value["anonymous"], "boolean");
    case "error":
      return named && isAbiParameters(value["inputs"]);
    case "constructor":
      return isAbiParameters(value["inputs"]) && MUTABILITY.has(String(value["stateMutability"]));
    case "fallback":
    case "receive":
      return MUTABILITY.has(String(value["stateMutability"]));
    default:
      return false;
  }
}

export const AbiItemSchema = z.custom<AbiItem>(isAbiItem, {
  error: (issue) => `is ${describe(issue.input)}; expected an ABI entry (function, event, error, constructor, fallback or receive).`,
});

/** A facet shard (contracts §3.1, §4 `shards/<Facet>.json`). */
export const FacetDetailSchema = z.looseObject({
  name: text,
  abi: z.array(AbiItemSchema),
  natspec: z.looseObject({
    notice: opt(text),
    dev: opt(text),
    functions: z.record(Hex4Schema, z.looseObject({ notice: opt(text), dev: opt(text), params: opt(z.record(text, text)) })),
  }),
  storageLayout: opt(z.unknown()),
  source: z.looseObject({ path: text, url: text }),
}) satisfies z.ZodType<FacetDetail>;

// ── unknown fields ─────────────────────────────────────────────────────────────────────────────────

/** Schemas that accept any key, so nothing under them is ever unknown; the walk stops there. */
const OPEN_SCHEMAS: ReadonlySet<z.core.$ZodType> = new Set<z.core.$ZodType>([ArgSchema, JsonValueSchema, RefSchema]);

function walkUnknown(schema: z.core.$ZodType, value: unknown, path: PropertyKey[], out: string[]): void {
  if (OPEN_SCHEMAS.has(schema)) return;
  if (schema instanceof z.ZodLazy) return walkUnknown(schema.unwrap(), value, path, out);
  if (schema instanceof z.ZodExactOptional || schema instanceof z.ZodOptional) {
    if (value !== undefined) walkUnknown(schema.unwrap(), value, path, out);
    return;
  }
  if (schema instanceof z.ZodObject) {
    if (!isRecord(value)) return;
    const shape: Record<string, z.core.$ZodType> = schema.shape;
    for (const key of Object.keys(value)) {
      const field = Object.hasOwn(shape, key) ? shape[key] : undefined;
      if (field === undefined) out.push(formatPath([...path, key]));
      else walkUnknown(field, value[key], [...path, key], out);
    }
    return;
  }
  if (schema instanceof z.ZodArray) {
    if (!Array.isArray(value)) return;
    value.forEach((item: unknown, index) => walkUnknown(schema.element, item, [...path, index], out));
    return;
  }
  if (schema instanceof z.ZodRecord) {
    if (!isRecord(value)) return;
    const values: z.core.$ZodType = schema.valueType;
    for (const key of Object.keys(value)) walkUnknown(values, value[key], [...path, key], out);
    return;
  }
  if (schema instanceof z.ZodUnion) {
    const options: readonly z.core.$ZodType[] = schema.options;
    const match = options.find((option) => z.safeParse(option, value).success);
    if (match) walkUnknown(match, value, path, out);
  }
}

/**
 * Paths of fields a schema doesn't declare, at every level (`"extra"`, `"init.note"`, `"deployments[0].x"`).
 * Records (owners, args, layout) declare any key, so their keys are never unknown.
 */
export function listUnknownFields(schema: z.core.$ZodType, value: unknown): string[] {
  const out: string[] = [];
  walkUnknown(schema, value, [], out);
  return out;
}

// ── validation entry points ────────────────────────────────────────────────────────────────────────


/** The path of the first object or list nested deeper than `MAX_JSON_DEPTH`, or null. Iterative, so it can't overflow. */
function tooDeep(json: unknown): PropertyKey[] | null {
  const stack: { value: unknown; path: PropertyKey[] }[] = [{ value: json, path: [] }];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { value, path } = item;
    if (value === null || typeof value !== "object") continue;
    if (path.length >= MAX_JSON_DEPTH) return path;
    if (Array.isArray(value)) value.forEach((child: unknown, index) => stack.push({ value: child, path: [...path, index] }));
    else for (const [key, child] of Object.entries(value)) stack.push({ value: child, path: [...path, key] });
  }
  return null;
}

/** Validates `json` against `schema`; issues as `{ path, message }`. Refuses JSON nested past `MAX_JSON_DEPTH`. */
export function validate<S extends z.ZodType>(schema: S, json: unknown): Result<z.output<S>, ParseIssue[]> {
  const deep = tooDeep(json);
  if (deep) return err([{ path: formatPath(deep), message: `nests deeper than ${MAX_JSON_DEPTH} levels.` }]);
  const parsed = schema.safeParse(json, { error: issueMessage });
  return parsed.success ? ok(parsed.data) : err(toParseIssues(parsed.error));
}

/** A validated value and the paths of the fields it kept without recognizing them. */
export type Validated<T> = { value: T; unknownFields: string[] };

function validateKeeping<T>(schema: z.ZodType<T>, json: unknown): Result<Validated<T>, ParseIssue[]> {
  const result = validate(schema, json);
  if (!result.ok) return result;
  return ok({ value: result.value, unknownFields: listUnknownFields(schema, json) });
}

/** A recipe, keeping unknown fields and listing their paths (spec L289). Normalization is C1's. */
export function validateRecipe(json: unknown): Result<Validated<Recipe>, ParseIssue[]> {
  return validateKeeping<Recipe>(RecipeSchema, json);
}

/** A share-link payload (the recipe minus `$schema`). */
export function validateSharePayload(json: unknown): Result<Validated<Omit<Recipe, "$schema">>, ParseIssue[]> {
  return validateKeeping<Omit<Recipe, "$schema">>(SharePayloadSchema, json);
}

export function validateProject(json: unknown): Result<Validated<Project>, ParseIssue[]> {
  return validateKeeping<Project>(ProjectSchema, json);
}

export function validateProjectFile(json: unknown): Result<Validated<ProjectFile>, ParseIssue[]> {
  return validateKeeping<ProjectFile>(ProjectFileSchema, json);
}

export function validateDeployment(json: unknown): Result<Validated<Deployment>, ParseIssue[]> {
  return validateKeeping<Deployment>(DeploymentSchema, json);
}

export function validateCatalog(json: unknown): Result<Catalog, ParseIssue[]> {
  return validate<z.ZodType<Catalog>>(CatalogSchema, json);
}

export function validateCatalogManifest(json: unknown): Result<CatalogManifest, ParseIssue[]> {
  return validate<z.ZodType<CatalogManifest>>(CatalogManifestSchema, json);
}

export function validateFacetDetail(json: unknown): Result<FacetDetail, ParseIssue[]> {
  return validate<z.ZodType<FacetDetail>>(FacetDetailSchema, json);
}
