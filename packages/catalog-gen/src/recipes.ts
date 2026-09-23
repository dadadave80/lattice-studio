/**
 * Recipe templates and seams (spec L192-L197, R19, L912; contracts §4 "Overlay files"): Studio's recipes as
 * data, taken from Lattice's deploy scripts, and the seams their exclusion notes imply.
 *
 * - `overlay/recipes/<Name>.yaml` records what one script's `buildCuts` does, step by step: each cut (Add or
 *   Replace, all of a facet's exported selectors, only some, or all but some), the init it passes and the
 *   example arguments Studio fills in. Every cut and list cites the script lines it comes from.
 * - `overlay/seams.yaml` lists the seams (R19): selectors that must stay on a version that keeps other state in
 *   step once certain facets are placed together.
 *
 * `buildTemplates` applies each recipe's cuts in order to an empty selector map with DiamondLib's rules, the way
 * the golden harness does (Add needs a free selector, Replace one on another facet), and turns the result into
 * the catalog's `RecipeTemplate`: facets in catalog order, an owner for every selector two placed facets export,
 * and every exported selector the script leaves out in `exclude`. So Add-then-Replace sequences and `_cutExcept`
 * lists become owners by construction, and routing never depends on defaults (spec L303).
 * `verifyTemplateRouting` then checks that core's routing, with the seams, reproduces what the script builds.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  ArgSchema,
  type Arg,
  type Catalog,
  computeRouting,
  err,
  type Hex4,
  lintCopy,
  ok,
  type ParseIssue,
  type Recipe,
  type RecipeTemplate,
  type Result,
  type Seam,
} from "@lattice-studio/core";
import { keccak256, stringToBytes } from "viem";
import * as z from "zod";
import { OVERLAY_DIR, parseSource } from "./overlay";

// ── selectors ──────────────────────────────────────────────────────────────────────────────────────

const HEX4 = /^0x[0-9a-f]{8}$/;
const SIGNATURE = /^[A-Za-z_$][A-Za-z0-9_$]*\((?:[A-Za-z0-9_$,()[\]]*)\)$/;

/** The 4-byte selector of a function signature such as `transfer(address,uint256)`. */
export function selectorOf(signature: string): Hex4 {
  return keccak256(stringToBytes(signature)).slice(0, 10) as Hex4;
}

/** A selector written as a quoted lowercase hex (`"0xa9059cbb"`) or a signature (`transfer(address,uint256)`). */
export function resolveSelector(ref: string): Hex4 {
  return HEX4.test(ref) ? (ref as Hex4) : selectorOf(ref);
}

/** The function name a selector reference names, for checking it against the cited script lines. */
function functionName(ref: string): string | undefined {
  return HEX4.test(ref) ? undefined : ref.slice(0, ref.indexOf("("));
}

// ── schemas ────────────────────────────────────────────────────────────────────────────────────────

const SourceSchema = z.string().refine((s) => parseSource(s) !== undefined, {
  message: "expected a citation like script/base/tokens/DeployERC20.s.sol#L58-L64 (path#L<a>-L<b>, a ≤ b).",
});
const NameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, { message: "expected a Solidity identifier." });
const InitNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/, { message: "expected an init name like ERC20Init." });
const TextSchema = z.string().trim().min(1, { message: "expected text." });
const SelectorRefSchema = z.string().refine((s) => HEX4.test(s) || SIGNATURE.test(s), {
  message: 'expected a quoted lowercase selector ("0xa9059cbb") or a signature (transfer(address,uint256)).',
});

const CutSchema = z
  .strictObject({
    /** Adds the facet's selectors: all it exports, only `selectors`, or all but `except`. */
    add: NameSchema.optional(),
    /** Replaces selectors already on the diamond with the facet's: all it exports, or only `selectors`. */
    replace: NameSchema.optional(),
    selectors: z.array(SelectorRefSchema).min(1).optional(),
    except: z.array(SelectorRefSchema).min(1).optional(),
    /** The `cuts[i] = …` line. */
    source: SourceSchema,
    /** Where `selectors` or `except` is spelled out (an exclusion helper, a local array), when not on the cut line. */
    listSource: SourceSchema.optional(),
  })
  .superRefine((c, ctx) => {
    if ((c.add === undefined) === (c.replace === undefined)) ctx.addIssue({ code: "custom", message: "a cut has either add or replace." });
    if (c.selectors !== undefined && c.except !== undefined) ctx.addIssue({ code: "custom", message: "a cut lists selectors or except, not both." });
    if (c.listSource !== undefined && c.selectors === undefined && c.except === undefined) {
      ctx.addIssue({ code: "custom", path: ["listSource"], message: "listSource goes with selectors or except." });
    }
  });

/** One cut, as written. */
export type CutDef = z.infer<typeof CutSchema>;

const StepSchema = z.strictObject({ spec: InitNameSchema, args: z.record(NameSchema, ArgSchema).default({}) });

const InitSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("bundle"), spec: InitNameSchema, args: z.record(NameSchema, ArgSchema).default({}), source: SourceSchema }),
  z.strictObject({ kind: z.literal("steps"), steps: z.array(StepSchema).min(1), source: SourceSchema }),
  z.strictObject({ kind: z.literal("none"), source: SourceSchema.optional() }),
]);

const RecipeFileSchema = z.strictObject({
  name: NameSchema,
  /** Position among recipes of the same phase (Flow 2's card order); unordered ones follow by name. */
  order: z.int().positive().optional(),
  script: z.string().regex(/^script\/.+\.s\.sol$/, { message: "expected a deploy script path like script/base/tokens/DeployERC20.s.sol." }),
  /** The overload the template follows, as the golden harness names it: `buildCuts(string,string)`. */
  buildCuts: z.string().regex(/^buildCuts\w*\(.*\)$/, { message: "expected an overload like buildCuts(string,string)." }),
  /** The `buildCuts` function. */
  source: SourceSchema,
  proxy: z.enum(["Lattice", "AccountDiamond", "ModularAccount6900"]),
  phase: z.enum(["v1", "v1.1", "later"]),
  /** Immutable by design: the script cuts no upgrade mechanism (CORE-02 acknowledged). */
  immutable: z.literal(true).optional(),
  cuts: z.array(CutSchema).min(1),
  init: InitSchema,
  /** What the template doesn't carry yet. Required for anything but a complete v1 template. */
  gaps: TextSchema.optional(),
  notes: TextSchema.optional(),
});

/** One recipe file, as written. */
export type RecipeDef = z.infer<typeof RecipeFileSchema>;

const SeamEntrySchema = z.strictObject({
  selectors: z.array(SelectorRefSchema).min(1),
  /** Active once every one of these is placed. */
  when: z.array(NameSchema).min(1),
  /** The facets allowed to serve it, preferred first. */
  anyOf: z.array(NameSchema).min(1),
  /** A lowercase clause that reads after "must be served by a version that " (spec L316). */
  reason: TextSchema,
  source: SourceSchema,
  notes: TextSchema.optional(),
});

/** One `seams.yaml` entry, as written: several selectors can share a rule. */
export type SeamDef = z.infer<typeof SeamEntrySchema>;

const SeamsFileSchema = z.strictObject({ seams: z.array(SeamEntrySchema) });

/** The recipe half of the overlay: seams and recipe files, each with the file it came from. */
export type RecipeOverlay = {
  seams: (SeamDef & { file: string })[];
  recipes: (RecipeDef & { file: string })[];
};

function zodIssues(error: z.ZodError, file: string): ParseIssue[] {
  return error.issues.map((issue) => ({
    file,
    path: issue.path.map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`)).join(""),
    message: issue.message,
  }));
}

function parseYaml(text: string, file: string): Result<unknown, ParseIssue[]> {
  try {
    return ok(Bun.YAML.parse(text));
  } catch (e) {
    return err([{ file, path: "", message: `isn't valid YAML: ${e instanceof Error ? e.message : String(e)}` }]);
  }
}

/** Parses `seams.yaml`. */
export function parseSeamsFile(text: string, file: string): Result<SeamDef[], ParseIssue[]> {
  const yaml = parseYaml(text, file);
  if (!yaml.ok) return yaml;
  const parsed = SeamsFileSchema.safeParse(yaml.value ?? { seams: [] });
  return parsed.success ? ok(parsed.data.seams) : err(zodIssues(parsed.error, file));
}

/** Parses one `recipes/<Name>.yaml`; the name must match the file's. */
export function parseRecipeFile(text: string, file: string): Result<RecipeDef, ParseIssue[]> {
  const yaml = parseYaml(text, file);
  if (!yaml.ok) return yaml;
  const parsed = RecipeFileSchema.safeParse(yaml.value);
  if (!parsed.success) return err(zodIssues(parsed.error, file));
  const def = parsed.data;
  const issues: ParseIssue[] = [];
  const base = file.slice(file.lastIndexOf("/") + 1).replace(/\.yaml$/, "");
  if (def.name !== base) issues.push({ file, path: "name", message: `is ${def.name}; expected ${base}, the file's name.` });
  const cited = parseSource(def.source)?.path;
  if (cited !== def.script) issues.push({ file, path: "source", message: `cites ${cited ?? "?"}; expected the script, ${def.script}.` });
  if (def.phase !== "v1" && def.gaps === undefined) {
    issues.push({ file, path: "gaps", message: "say what this template doesn't carry yet (anything but v1 may be partial)." });
  }
  return issues.length > 0 ? err(issues) : ok(def);
}

/** Reads `<dir>/seams.yaml` and `<dir>/recipes/*.yaml`. Every file is read before failing. */
export async function loadRecipeOverlay(dir: string = OVERLAY_DIR): Promise<Result<RecipeOverlay, ParseIssue[]>> {
  const out: RecipeOverlay = { seams: [], recipes: [] };
  const issues: ParseIssue[] = [];
  const seamsFile = Bun.file(join(dir, "seams.yaml"));
  if (await seamsFile.exists()) {
    const parsed = parseSeamsFile(await seamsFile.text(), "overlay/seams.yaml");
    if (parsed.ok) out.seams = parsed.value.map((s) => ({ ...s, file: "overlay/seams.yaml" }));
    else issues.push(...parsed.error);
  }
  let names: string[] = [];
  try {
    names = (await readdir(join(dir, "recipes"))).filter((n) => n.endsWith(".yaml")).sort();
  } catch {
    names = [];
  }
  for (const name of names) {
    const file = `overlay/recipes/${name}`;
    const parsed = parseRecipeFile(await Bun.file(join(dir, "recipes", name)).text(), file);
    if (parsed.ok) out.recipes.push({ ...parsed.value, file });
    else issues.push(...parsed.error);
  }
  return issues.length > 0 ? err(issues) : ok(out);
}

/** Where the deploy scripts live in the checkout: every script here is a template or listed below. */
export const SCRIPT_DIR = "script/base";

/** Scripts under `script/base` that aren't recipe templates, with the reason (the rest are, spec L912). */
export const SKIPPED_SCRIPTS: Record<string, string> = {
  "script/base/BaseDeploy.s.sol": "the building blocks every recipe inherits, not a recipe",
  "script/base/crosschain/CCTPHookDemo.s.sol": "a live CCTP hooks showcase across testnets; it builds no diamond",
  "script/base/crosschain/CCTPHookReceiptDemo.s.sol": "a CCTP relay demo against an existing diamond; it builds no diamond",
  "script/base/crosschain/CCTPUSDCDemo.s.sol": "a CCTP transfer demo against deployed adapters; it builds no diamond",
  "script/base/defi/GrantExample.s.sol": "a testnet example that deploys the GovernedVault recipe with a test asset (its source of examples)",
  "script/base/tokens/DeployERC20Wrapper.s.sol": "cuts ERC20Wrapper, which isn't in FacetInventory, so the catalog has no release of it (R18)",
  "script/base/tokens/DeployERC721URIStorage.s.sol": "cuts ERC721URIStorage, which isn't in FacetInventory, so the catalog has no release of it (R18)",
};

// ── facts ──────────────────────────────────────────────────────────────────────────────────────────

/** An init parameter as far as argument paths go: its name and a tuple's components. */
export type ParamShape = { name: string; components?: readonly ParamShape[] };

/** What the build knows, as far as templates need it. */
export type RecipeFacts = {
  /** The catalog's tag (`recipe.catalog.tag`). */
  tag: string;
  /** Every catalog facet, in catalog order, with its exported selectors (never 0x0ef22643) and its family. */
  facets: readonly { name: string; selectors: readonly { hex: Hex4; signature: string }[]; family?: string }[];
  /** Every init spec by name, with its params when known. Absent: init names aren't checked; no params: its arguments aren't. */
  inits?: readonly { name: string; params?: readonly ParamShape[] }[];
};

/** The zero hash: a catalog can't hold its own hash, so `loadTemplate` stamps the live one (contracts §3.1). */
export const ZERO_HASH = `0x${"00".repeat(32)}` as const;

/** The automatic ERC-165 step is the planner's, never a template's (R11). */
const INTROSPECTION = "DiamondIntrospectionInit";

// ── seams ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The seams, one per selector and rule, in file order (core takes the first active seam for a selector, so order
 * matters where two could apply). Checks: every facet is in the catalog, every `anyOf` facet exports the selector,
 * a `when` facet exports it or a contender does, no selector has two rules with the same `when`, and the reason
 * follows the voice rules.
 */
export function buildSeams(overlay: Pick<RecipeOverlay, "seams">, facts: RecipeFacts): Result<Seam[], ParseIssue[]> {
  const facets = new Map(facts.facets.map((f) => [f.name, new Set(f.selectors.map((s) => s.hex))]));
  const issues: ParseIssue[] = [];
  const seams: Seam[] = [];
  const seen = new Set<string>();
  overlay.seams.forEach((def, i) => {
    const at = `seams[${i}]`;
    for (const name of [...def.when, ...def.anyOf]) {
      if (!facets.has(name)) issues.push({ file: def.file, path: at, message: `${name} isn't a catalog facet.` });
    }
    if (/^[A-Z]/.test(def.reason) || /[.!?]$/.test(def.reason)) {
      issues.push({ file: def.file, path: `${at}.reason`, message: 'is a lowercase clause with no final period; it reads after "must be served by a version that ".' });
    }
    for (const c of lintCopy(def.reason)) issues.push({ file: def.file, path: `${at}.reason`, message: c.message });
    for (const ref of def.selectors) {
      const selector = resolveSelector(ref);
      for (const name of def.anyOf) {
        if (facets.get(name)?.has(selector) === false) issues.push({ file: def.file, path: at, message: `${name} doesn't export ${ref} (${selector}).` });
      }
      const key = `${selector}|${[...def.when].sort().join(",")}`;
      if (seen.has(key)) issues.push({ file: def.file, path: at, message: `${ref} already has a seam for when [${def.when.join(", ")}].` });
      seen.add(key);
      seams.push({ selector, when: [...def.when], anyOf: [...def.anyOf], reason: def.reason });
    }
  });
  return issues.length > 0 ? err(issues) : ok(seams);
}

// ── templates ──────────────────────────────────────────────────────────────────────────────────────

/** Selector → the facet that serves it after the script's cuts, keys sorted. */
export type ScriptRouting = Record<Hex4, string>;

/** `buildTemplates`' result: the templates in catalog order, what each script routes, and each one's gaps. */
export type BuiltTemplates = {
  templates: RecipeTemplate[];
  routing: Record<string, ScriptRouting>;
  gaps: { name: string; phase: RecipeTemplate["phase"]; gaps: string }[];
};

const PHASES: readonly RecipeTemplate["phase"][] = ["v1", "v1.1", "later"];

function sortTemplates(defs: readonly RecipeDef[]): RecipeDef[] {
  return [...defs].sort(
    (a, b) =>
      PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase) ||
      (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

function sortedRecord<V>(entries: Iterable<[Hex4, V]>): Record<Hex4, V> {
  const out: Record<Hex4, V> = {};
  for (const [k, v] of [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) out[k] = v;
  return out;
}

/** Checks argument names and tuple fields against the params they fill. */
function checkArgs(args: Record<string, Arg>, params: readonly ParamShape[], path: string, file: string, issues: ParseIssue[]): void {
  for (const [name, value] of Object.entries(args)) {
    const param = params.find((p) => p.name === name);
    if (param === undefined) {
      issues.push({ file, path: `${path}.${name}`, message: `isn't a parameter (${params.map((p) => p.name).join(", ") || "none"}).` });
      continue;
    }
    if (param.components !== undefined) {
      if (typeof value !== "object" || value === null || Array.isArray(value) || "$ref" in value) {
        issues.push({ file, path: `${path}.${name}`, message: "is a tuple; write its fields by name." });
      } else checkArgs(value as Record<string, Arg>, param.components, `${path}.${name}`, file, issues);
    }
  }
}

function copyArgs(args: Record<string, Arg>): Record<string, Arg> {
  return structuredClone(args);
}

/**
 * Applies one recipe's cuts and projects it onto a `RecipeTemplate`. Issues: an unknown facet or init, a
 * selector the facet doesn't export, an Add of a selector already served or a Replace of one that isn't (the
 * script would revert), the automatic ERC-165 step stored in the template, and `immutable` that disagrees with
 * the facets (it holds exactly when no upgrade mechanism is cut).
 */
function buildTemplate(
  def: RecipeDef & { file: string },
  facts: RecipeFacts,
  issues: ParseIssue[],
): { template: RecipeTemplate; routing: ScriptRouting } | undefined {
  const byName = new Map(facts.facets.map((f) => [f.name, f]));
  const before = issues.length;
  const routing = new Map<Hex4, string>();
  const placed = new Set<string>();
  def.cuts.forEach((cut, i) => {
    const at = `cuts[${i}]`;
    const name = cut.add ?? cut.replace ?? "";
    const facet = byName.get(name);
    if (facet === undefined) {
      issues.push({ file: def.file, path: at, message: `${name} isn't a catalog facet.` });
      return;
    }
    placed.add(name);
    const exported = facet.selectors.map((s) => s.hex);
    const listed = (refs: readonly string[] | undefined, key: string): Set<Hex4> => {
      const out = new Set<Hex4>();
      refs?.forEach((ref, k) => {
        const selector = resolveSelector(ref);
        if (!exported.includes(selector)) issues.push({ file: def.file, path: `${at}.${key}[${k}]`, message: `${name} doesn't export ${ref} (${selector}).` });
        out.add(selector);
      });
      return out;
    };
    const only = cut.selectors === undefined ? undefined : listed(cut.selectors, "selectors");
    const except = listed(cut.except, "except");
    const selectors = only === undefined ? exported.filter((s) => !except.has(s)) : exported.filter((s) => only.has(s));
    for (const selector of selectors) {
      const current = routing.get(selector);
      if (cut.add !== undefined && current !== undefined) {
        issues.push({ file: def.file, path: at, message: `adds ${selector}, which ${current} already serves; the script would revert.` });
      } else if (cut.replace !== undefined && (current === undefined || current === name)) {
        issues.push({ file: def.file, path: at, message: `replaces ${selector}, which ${current === undefined ? "nothing serves yet" : `${name} already serves`}; the script would revert.` });
      } else routing.set(selector, name);
    }
  });

  const initNames = facts.inits === undefined ? undefined : new Map(facts.inits.map((s) => [s.name, s]));
  const checkSpec = (spec: string, args: Record<string, Arg>, path: string) => {
    if (spec === INTROSPECTION || spec.startsWith(`${INTROSPECTION}.`)) {
      issues.push({ file: def.file, path, message: "the automatic ERC-165 step is the planner's (R11); leave it out of the template." });
    }
    if (initNames === undefined) return;
    const known = initNames.get(spec);
    if (known === undefined) issues.push({ file: def.file, path, message: `${spec} isn't a catalog init.` });
    else if (known.params !== undefined) checkArgs(args, known.params, `${path}.args`, def.file, issues);
  };
  let init: Recipe["init"];
  if (def.init.kind === "bundle") {
    checkSpec(def.init.spec, def.init.args, "init");
    init = { kind: "bundle", spec: def.init.spec, args: copyArgs(def.init.args) };
  } else if (def.init.kind === "steps") {
    def.init.steps.forEach((s, i) => checkSpec(s.spec, s.args, `init.steps[${i}]`));
    init = { kind: "steps", steps: def.init.steps.map((s) => ({ spec: s.spec, args: copyArgs(s.args) })) };
  } else init = { kind: "none" };

  const upgrade = [...placed].filter((name) => byName.get(name)?.family === "upgrade");
  if (def.immutable === true && upgrade.length > 0) {
    issues.push({ file: def.file, path: "immutable", message: `is set, but the script cuts ${upgrade.join(" and ")}.` });
  }
  if (def.immutable === undefined && upgrade.length === 0 && facts.facets.some((f) => f.family !== undefined)) {
    issues.push({ file: def.file, path: "immutable", message: "the script cuts no upgrade mechanism; set immutable: true." });
  }
  if (issues.length > before) return undefined;

  const facets = facts.facets.filter((f) => placed.has(f.name));
  const contenders = new Map<Hex4, number>();
  for (const f of facets) for (const { hex } of f.selectors) contenders.set(hex, (contenders.get(hex) ?? 0) + 1);
  const owners: [Hex4, string][] = [];
  const exclude: Hex4[] = [];
  for (const [selector, count] of contenders) {
    const owner = routing.get(selector);
    if (owner === undefined) exclude.push(selector);
    else if (count > 1) owners.push([selector, owner]);
  }
  const recipe: Recipe = {
    schemaVersion: 1,
    catalog: { tag: facts.tag, hash: ZERO_HASH },
    facets: facets.map((f) => f.name),
    owners: sortedRecord(owners),
    exclude: exclude.sort(),
    init,
  };
  if (def.immutable === true) recipe.immutable = true;
  return {
    template: { name: def.name, script: def.script, proxy: def.proxy, recipe, phase: def.phase },
    routing: sortedRecord(routing),
  };
}

/**
 * Every recipe as a catalog `RecipeTemplate`, v1 first in Flow 2's order, then the rest by phase and name. The
 * templates hold the zero hash in `recipe.catalog.hash` (contracts §3.1) and never the automatic ERC-165 step.
 */
export function buildTemplates(overlay: Pick<RecipeOverlay, "recipes">, facts: RecipeFacts): Result<BuiltTemplates, ParseIssue[]> {
  const issues: ParseIssue[] = [];
  const out: BuiltTemplates = { templates: [], routing: {}, gaps: [] };
  const names = new Set<string>();
  for (const def of sortTemplates(overlay.recipes) as (RecipeDef & { file: string })[]) {
    if (names.has(def.name)) issues.push({ file: def.file, path: "name", message: `${def.name} is written twice.` });
    names.add(def.name);
    const built = buildTemplate(def, facts, issues);
    if (built === undefined) continue;
    out.templates.push(built.template);
    out.routing[def.name] = built.routing;
    if (def.gaps !== undefined) out.gaps.push({ name: def.name, phase: def.phase, gaps: def.gaps });
  }
  return issues.length > 0 ? err(issues) : ok(out);
}

/**
 * Core's routing of each template (seams first, then owners and defaults) against what its script builds. An
 * issue for every selector that routes elsewhere or not at all, for example a seam that contradicts a script.
 */
export function verifyTemplateRouting(catalog: Catalog, routing: Record<string, ScriptRouting>): ParseIssue[] {
  const issues: ParseIssue[] = [];
  for (const template of catalog.recipes) {
    const expected = routing[template.name];
    if (expected === undefined) continue;
    const actual = computeRouting(template.recipe, catalog);
    const file = `overlay/recipes/${template.name}.yaml`;
    for (const selector of new Set([...Object.keys(expected), ...Object.keys(actual)] as Hex4[])) {
      const want = expected[selector];
      const got = actual[selector]?.owner;
      if (want !== got) {
        issues.push({ file, path: selector, message: `routes to ${got ?? "nothing"} (${actual[selector]?.via ?? "absent"}); the script routes it to ${want ?? "nothing"}.` });
      }
    }
  }
  return issues;
}

// ── citations against the checkout ─────────────────────────────────────────────────────────────────

const ELEMENTARY = /^(address|bool|string|bytes\d*|u?int\d*)(\[\d*\])*$/;

/** Splits a type list at its top-level commas: `(address,string),uint256` → two types. */
function splitTypes(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of list) {
    if (ch === "," && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    current += ch;
  }
  if (current !== "") out.push(current);
  return out;
}

/**
 * Whether a Solidity parameter list (`string memory name_, GovernedVaultParams memory p`) declares the overload
 * the template names (`buildCuts(string,(address,…))`): elementary types must match, a struct stands for a tuple.
 */
export function overloadMatches(declared: string, buildCuts: string): boolean {
  const solidity = (declared.trim() === "" ? [] : declared.split(",")).map((p) =>
    (p.trim().split(/\s+/)[0] ?? "").replace(/^(u?int)(?=$|\[)/, "$1256"),
  );
  const abi = splitTypes(buildCuts.slice(buildCuts.indexOf("(") + 1, -1));
  if (solidity.length !== abi.length) return false;
  return solidity.every((type, i) => (ELEMENTARY.test(type) ? type === abi[i] : abi[i]?.startsWith("(") === true));
}

/** Reads a checkout file as lines; `undefined` when it doesn't exist. */
export type SourceReader = (path: string) => readonly string[] | undefined;

/**
 * Checks every citation against the Lattice checkout: the file exists and the range is inside it, the cited
 * lines name what they're cited for (the cut's facet, each listed selector's function, the init contract, the
 * `buildCuts` overload), and a seam's source exists. Catches a script that moved or changed under a template.
 */
export function checkRecipeSources(overlay: RecipeOverlay, read: SourceReader): ParseIssue[] {
  const issues: ParseIssue[] = [];
  const cited = (file: string, path: string, source: string | undefined, needles: readonly string[]) => {
    if (source === undefined) return;
    const ref = parseSource(source);
    const lines = ref === undefined ? undefined : read(ref.path);
    if (ref === undefined || lines === undefined) {
      issues.push({ file, path, message: `cites ${source}, which isn't in the checkout.` });
      return;
    }
    if (ref.to > lines.length) {
      issues.push({ file, path, message: `cites ${source}, past the end of the file (${lines.length} lines).` });
      return;
    }
    const text = lines.slice(ref.from - 1, ref.to).join("\n");
    for (const needle of needles) {
      if (!text.includes(needle)) issues.push({ file, path, message: `cites ${source}, which doesn't mention ${needle}.` });
    }
  };
  for (const r of overlay.recipes) {
    cited(r.file, "source", r.source, [`function ${r.buildCuts.slice(0, r.buildCuts.indexOf("(") + 1)}`]);
    const from = parseSource(r.source)?.from ?? 1;
    const declared = new RegExp(`function ${r.buildCuts.slice(0, r.buildCuts.indexOf("("))}\\(([^)]*)\\)`).exec(read(r.script)?.slice(from - 1, from + 3).join(" ") ?? "")?.[1];
    if (declared !== undefined && !overloadMatches(declared, r.buildCuts)) {
      issues.push({ file: r.file, path: "buildCuts", message: `is ${r.buildCuts}, but the cited function takes (${declared.trim()}).` });
    }
    r.cuts.forEach((c, i) => {
      const facet = c.add ?? c.replace ?? "";
      cited(r.file, `cuts[${i}].source`, c.source, c.replace !== undefined && c.selectors === undefined ? [facet, "_replace"] : [facet]);
      const refs = [...(c.selectors ?? []), ...(c.except ?? [])];
      const names = refs.map(functionName).filter((n): n is string => n !== undefined);
      cited(r.file, `cuts[${i}].${c.listSource === undefined ? "source" : "listSource"}`, c.listSource ?? c.source, names);
    });
    if (r.init.kind === "bundle") cited(r.file, "init.source", r.init.source, [r.init.spec.split(".")[0] ?? ""]);
    else if (r.init.kind === "steps") {
      cited(r.file, "init.source", r.init.source, r.init.steps.map((s) => s.spec.split(".")[0] ?? ""));
    } else cited(r.file, "init.source", r.init.source, []);
  }
  overlay.seams.forEach((s, i) => cited(s.file, `seams[${i}].source`, s.source, []));
  return issues;
}
