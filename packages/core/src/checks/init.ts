/**
 * INIT-01 to INIT-05 (spec L327-L331, R6-R11, R14). Owner: WP-C4a.
 * The plan comes from `planInit`, so every count the UI shows and every problem here share one source (PA L17).
 */
import type { Check, CheckInput } from "../model/analysis";
import type { Catalog, InitParam, InitSpec } from "../model/catalog";
import type { CommandRef } from "../model/commands";
import type { ArgContext, FieldModel, InitPlan, InitStepView } from "../model/init";
import type { Json } from "../model/json";
import { problem, problemId, type Anchor, type Problem, type ProblemParams } from "../model/problems";
import type { Arg } from "../model/recipe";
import { canonicalJson } from "../canonical/json";
import { judgeArg } from "../init/plan/fields";
import { AUTO_STEP_PATH, planInit, predecessors } from "../init/plan/plan";
import { argAt, facetModule, findSpec, leaves, mainModule, modulesOf } from "../init/plan/specs";

/** Known consequences of a module left uninitialized, for INIT-04's message (spec L330). */
const CONSEQUENCES: Readonly<Record<string, string>> = { ERC20: "`name()` and `symbol()` would be empty" };

type PlannedStep = { view: InitStepView; spec: InitSpec };

function plannedSteps(plan: InitPlan, catalog: Catalog): PlannedStep[] {
  return plan.steps.flatMap((view) => {
    if (view.path === AUTO_STEP_PATH) return [];
    const spec = findSpec(catalog, view.spec);
    return spec ? [{ view, spec }] : [];
  });
}

function initAnchor(path: string): Anchor {
  return { kind: "init", path };
}

// ── INIT-01 ────────────────────────────────────────────────────────────────────────────────────────

function argContext(input: CheckInput): ArgContext {
  const ctx: ArgContext = {};
  if (input.ctx.chain) {
    ctx.chain = input.ctx.chain;
    ctx.chainName = input.ctx.chain.name;
  }
  if (input.ctx.refs) ctx.refs = input.ctx.refs;
  return ctx;
}

function init01(steps: readonly PlannedStep[], ctx: ArgContext): Problem[] {
  const out: Problem[] = [];
  for (const { view } of steps) {
    for (const { field, value } of leaves(view.fields, view.args)) {
      const judged = judgeArg(field, value, ctx);
      if (judged.ok) continue;
      const params: ProblemParams["INIT-01"] = { path: judged.path, label: judged.label, missing: judged.kind === "missing", detail: judged.detail };
      if (judged.kind === "invalid") params.value = judged.value;
      if (judged.kind === "chain") params.chain = judged.chain;
      out.push(problem("INIT-01", [initAnchor(judged.path)], params, [{ id: "init.focusField", args: { path: judged.path } }]));
    }
  }
  return out;
}

// ── INIT-02 ────────────────────────────────────────────────────────────────────────────────────────

function init02(plan: InitPlan, steps: readonly PlannedStep[]): Problem[] {
  if (plan.kind !== "steps") return [];
  const before = predecessors(steps.map((s) => s.spec));
  const out: Problem[] = [];
  steps.forEach(({ view, spec }, i) => {
    const late = [...(before[i] ?? [])].filter((j) => j > i);
    if (late.length === 0) return;
    const modules = late.map((j) => modulesOf(steps[j]?.spec));
    const own = modulesOf(spec);
    const after = spec.after.find((m) => !own.has(m) && modules.some((set) => set.has(m))) ?? "";
    const params: ProblemParams["INIT-02"] = { path: view.path, spec: spec.name, module: mainModule(spec), after };
    const fixes: CommandRef[] = [{ id: "init.reorderAuto" }, { id: "init.open", args: { focus: view.path } }];
    out.push(problem("INIT-02", [initAnchor(view.path)], params, fixes));
  });
  return out;
}

// ── INIT-03 ────────────────────────────────────────────────────────────────────────────────────────

type Side = { step: PlannedStep; with: Record<string, string> };
/** A module argument as one side sets it: from a parameter (with its path) or a literal in Solidity. */
type Setting = { value: Json; argPath?: string; authority: boolean };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Addresses compare case-insensitively; everything else by canonical JSON. */
function comparable(value: Json): string {
  if (typeof value === "string" && ADDRESS.test(value)) return value.toLowerCase();
  if (Array.isArray(value)) return canonicalJson(value.map((v) => (typeof v === "string" && ADDRESS.test(v) ? v.toLowerCase() : v)));
  return canonicalJson(value);
}

/** Solidity literals in `initializes.with`: `address(this)` is the diamond, `address(0)` the zero address. */
function literal(text: string): Json | undefined {
  const trimmed = text.trim();
  if (trimmed === "address(this)") return { $ref: "self" };
  if (trimmed === "address(0)") return `0x${"0".repeat(40)}`;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const items = trimmed.slice(1, -1).split(",").filter((s) => s.trim() !== "").map(literal);
    return items.every((item) => item !== undefined) ? (items as Json[]) : undefined;
  }
  return trimmed;
}

/** The parameter a dotted path names ("p.name" is component `name` of tuple `p`), if the spec has one. */
function paramAt(params: readonly InitParam[], parts: readonly string[]): InitParam | undefined {
  const [head, ...rest] = parts;
  const param = params.find((p) => p.name === head);
  if (!param || rest.length === 0) return param;
  return paramAt(param.components ?? [], rest);
}

function setting(side: Side, key: string): Setting | undefined {
  const expr = side.with[key];
  if (expr === undefined) return undefined;
  const parts = expr.split(".");
  const param = paramAt(side.step.spec.params, parts);
  if (!param) {
    const value = literal(expr);
    return value === undefined ? undefined : { value, authority: false };
  }
  const value: Arg | undefined = argAt(side.step.view.args, parts);
  if (value === undefined || value === "") return undefined;
  return { value: value as Json, argPath: `${side.step.view.path}.${expr}`, authority: param.authority === true };
}

type Comparison = { differing: string[]; roles: boolean; settings: Map<string, [Setting, Setting]> };

function compare(a: Side, b: Side): Comparison {
  const differing: string[] = [];
  const settings = new Map<string, [Setting, Setting]>();
  for (const key of Object.keys(a.with)) {
    const left = setting(a, key);
    const right = setting(b, key);
    if (!left || !right) continue;
    if (comparable(left.value) === comparable(right.value)) continue;
    differing.push(key);
    settings.set(key, [left, right]);
  }
  const roles = differing.length > 0 && differing.every((key) => settings.get(key)?.some((s) => s.authority) === true);
  return { differing, roles, settings };
}

function eip712Detail(keys: readonly string[]): string | undefined {
  const name = keys.includes("name");
  const version = keys.includes("version");
  if (!name && !version) return undefined;
  // Spec L329 says "different names" for ERC20PermitInit and ERC6538RegistryInit, whose versions differ too
  // ("1" and "1.0"): the name is what a signer sees, so it leads; "versions" only when the names match.
  const what = name ? "names" : "versions";
  return `set the diamond's one EIP-712 domain, to different ${what}, so only one standard's signatures would verify`;
}

/** "Use one admin": the later side's authority argument takes the other side's value. */
function oneAdmin(comparisons: readonly Comparison[]): { fixes: CommandRef[]; argPaths: string[]; admin?: Json } {
  const fixes: CommandRef[] = [];
  const argPaths: string[] = [];
  let admin: Json | undefined;
  for (const comparison of comparisons) {
    if (!comparison.roles) continue;
    for (const key of comparison.differing) {
      const pair = comparison.settings.get(key);
      if (!pair) continue;
      const [left, right] = pair;
      for (const s of pair) if (s.argPath && !argPaths.includes(s.argPath)) argPaths.push(s.argPath);
      const target = right.argPath && right.authority ? right : left.argPath && left.authority ? left : undefined;
      const source = target === right ? left : right;
      if (!target?.argPath) continue;
      admin ??= source.value;
      if (!fixes.some((f) => f.args?.["path"] === target.argPath)) fixes.push({ id: "init.setArg", args: { path: target.argPath, value: source.value } });
    }
    break;
  }
  return admin === undefined ? { fixes, argPaths } : { fixes, argPaths, admin };
}

function init03(steps: readonly PlannedStep[]): Problem[] {
  const byModule = new Map<string, Side[]>();
  for (const step of steps) {
    for (const entry of step.spec.initializes) {
      const sides = byModule.get(entry.module) ?? [];
      if (sides.some((s) => s.step === step)) continue;
      sides.push({ step, with: entry.with ?? {} });
      byModule.set(entry.module, sides);
    }
  }
  const out: Problem[] = [];
  for (const [module, sides] of byModule) {
    if (sides.length < 2) continue;
    const comparisons: Comparison[] = [];
    sides.forEach((a, i) => sides.slice(i + 1).forEach((b) => comparisons.push(compare(a, b))));
    const conflicts = comparisons.filter((c) => c.differing.length > 0 && !c.roles);
    const kind: ProblemParams["INIT-03"]["case"] = conflicts.length > 0 ? "conflict" : comparisons.some((c) => c.roles) ? "roles" : "same";
    const paths = sides.map((s) => s.step.view.path);
    const params: ProblemParams["INIT-03"] = { module, case: kind, specs: sides.map((s) => s.step.spec.name), paths };
    const fixes: CommandRef[] = paths.map((path) => ({ id: "init.removeStep", args: { path } }));
    if (kind === "conflict" && module === "EIP712") {
      const detail = eip712Detail(conflicts.flatMap((c) => c.differing));
      if (detail) params.detail = detail;
    }
    if (kind === "roles") {
      const use = oneAdmin(comparisons);
      params.argPaths = use.argPaths;
      if (use.admin !== undefined) params.admin = use.admin;
      fixes.push(...use.fixes);
    }
    const severity = kind === "conflict" ? "blocker" : kind === "roles" ? "warning" : "info";
    out.push(problem("INIT-03", paths.map(initAnchor), params, fixes, { severity, id: problemId("INIT-03", module) }));
  }
  return out;
}

// ── INIT-04 ────────────────────────────────────────────────────────────────────────────────────────

/** The init to add for a module: a step init that is for it, else any step init that runs it. */
function specFor(module: string, catalog: Catalog): InitSpec | undefined {
  const steps = catalog.inits.filter((spec) => spec.kind === "step");
  return steps.find((spec) => mainModule(spec) === module) ?? steps.find((spec) => modulesOf(spec).has(module));
}

function init04(input: CheckInput, steps: readonly PlannedStep[]): Problem[] {
  const { recipe, catalog } = input;
  const planned = new Set(steps.map((s) => s.spec.name));
  const initialized = new Set(steps.flatMap((s) => [...modulesOf(s.spec)]));
  const reported = new Set<string>();
  const out: Problem[] = [];
  const placed = new Set(recipe.facets);
  for (const facet of catalog.facets) {
    if (!placed.has(facet.name) || facet.init === undefined) continue;
    const spec = findSpec(catalog, facet.init);
    if (!spec || planned.has(spec.name)) continue;
    // The facet's own module, not the init's last one: ERC20VotesInit ends with AccessControl even though
    // ERC20Votes is its own module (FX23).
    const module = facetModule(facet.name, spec);
    if (initialized.has(module) || reported.has(module)) continue;
    reported.add(module);
    const params: ProblemParams["INIT-04"] = { module, spec: spec.name, facet: facet.name };
    const consequence = CONSEQUENCES[module];
    if (consequence) params.consequence = consequence;
    // A bundle can't join an init plan that already has steps, or replace another bundle (`addInitStep`
    // refuses both): offer a step init for the module instead when the catalog has one, or no fix at all,
    // the way the sameCall case with no step init does (FX23; ruling 2026-09-23).
    const hasExistingPlan = recipe.init.kind === "bundle" || (recipe.init.kind === "steps" && recipe.init.steps.length > 0);
    const blocked = spec.kind === "bundle" && hasExistingPlan;
    const add = blocked ? specFor(module, catalog) : spec;
    if (blocked) params.spec = add?.name ?? "";
    const fixes: CommandRef[] = add ? [{ id: "init.addStep", args: { spec: add.name } }] : [];
    const where: Anchor[] = [{ kind: "facet", facet: facet.name }];
    out.push(problem("INIT-04", where, params, fixes, { id: problemId("INIT-04", module) }));
  }
  for (const { view, spec } of steps) {
    for (const module of spec.sameCall) {
      if (initialized.has(module) || reported.has(module)) continue;
      reported.add(module);
      // When no step init in the catalog runs the module, there is nothing to add: `spec` stays "" and the
      // problem offers no fix (ruling 2026-09-23); C10 words it from `module` and `sameCallWith`.
      const add = specFor(module, catalog);
      const params: ProblemParams["INIT-04"] = { module, spec: add?.name ?? "", sameCallWith: spec.name };
      const fixes: CommandRef[] = add ? [{ id: "init.addStep", args: { spec: add.name } }] : [];
      out.push(problem("INIT-04", [initAnchor(view.path)], params, fixes, { id: problemId("INIT-04", module) }));
    }
  }
  return out;
}

// ── INIT-05 ────────────────────────────────────────────────────────────────────────────────────────

type Example = ProblemParams["INIT-05"]["examples"][number];

/**
 * Which examples the message names first: authority fields, then fields with a rule, then fields with a unit,
 * then the rest. GovernedVault then names voting period and quorum, as spec L331 does.
 */
function tier(field: FieldModel): number {
  if (field.authority) return 0;
  if (field.rule !== undefined) return 1;
  if (field.unit !== undefined) return 2;
  return 3;
}

function init05(steps: readonly PlannedStep[]): Problem[] {
  const found: { example: Example; tier: number }[] = [];
  for (const { view } of steps) {
    const flagged = new Set(view.examples);
    for (const { field, value } of leaves(view.fields, view.args)) {
      if (!flagged.has(field.path) || value === undefined) continue;
      const example: Example = { path: field.path, label: field.label, value: value as Json };
      if (field.unit) example.unit = field.unit;
      found.push({ example, tier: tier(field) });
    }
  }
  if (found.length === 0) return [];
  const id = problemId("INIT-05", { kind: "diamond" });
  // `paths` stays in field order; `examples` is tiered (a stable sort keeps field order within each tier).
  const examples = [...found].sort((a, b) => a.tier - b.tier).map((f) => f.example);
  const params: ProblemParams["INIT-05"] = { count: found.length, paths: found.map((f) => f.example.path), examples };
  return [problem("INIT-05", [{ kind: "diamond" }], params, [{ id: "init.open", args: { focus: "examples" } }, { id: "ack.set", args: { problemId: id } }])];
}

/** INIT-01 to INIT-05, in code order. */
export const checkInit: Check = (input) => {
  const plan = planInit(input.recipe, input.catalog);
  const steps = plannedSteps(plan, input.catalog);
  return [...init01(steps, argContext(input)), ...init02(plan, steps), ...init03(steps), ...init04(input, steps), ...init05(steps)];
};
