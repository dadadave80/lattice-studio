/**
 * Recipe ops (spec L283-L289, Flows 3-7): every change a person makes to what the diamond is. Each returns the
 * recipe through C1's `normalizeRecipe`, so facets stay in catalog order and owners and exclusions stay
 * canonical. Positions come from the caller (C9's `freeSlot`); nothing here does geometry.
 */
import { canonicalJson } from "../canonical/json";
import { normalizeRecipe } from "../canonical/normalize";
import { formatAddress, formatDuration, formatSelector, plural } from "../format/format";
import { joinAnd, joinOr } from "../format/text";
import type {
  AddInitStepFn, ClearOwnerFn, ExcludeSelectorFn, IncludeSelectorFn, LoadRecipeFn, MoveInitStepFn, PlaceFacetFn,
  RemoveFacetsFn, RemoveInitStepFn, RouteSelectorFn, SetImmutableFn, SetInitArgFn,
} from "../model/api";
import type { Catalog, Facet, InitParam, Seam } from "../model/catalog";
import { isAddress, toLowerHex, type Hex4 } from "../model/hex";
import type { Project } from "../model/project";
import type { Arg, InitStep, Recipe, RecipeInit } from "../model/recipe";
import { dropProvenance, parseInitPath, remapStepProvenance, type InitPath } from "./paths";
import { done, isFinitePoint, noOp, notOnSheet, unique } from "./shared";

/** Pins of a newly placed card: on the right, as C9's `tidy` gives new cards. */
const DEFAULT_PINS = "right";

/** `exportSelectors()`: never in a facet's list (spec L162), so its signature is known here (SEL-04). */
const EXPORT_SELECTORS: Hex4 = "0x0ef22643";

type Owners = Recipe["owners"];

/**
 * What removing every init leaves (orchestrator ruling): a step plan with no steps, so the planner still adds the
 * automatic introspection step and the ERC-165 flags survive. `none` appears only when a recipe says so.
 */
const EMPTY_INIT: RecipeInit = { kind: "steps", steps: [] };

// ── Lookups ────────────────────────────────────────────────────────────────────────────────────────────

function facetOf(catalog: Catalog, name: string): Facet | undefined {
  return catalog.facets.find((facet) => facet.name === name);
}

function exports(catalog: Catalog, name: string, selector: Hex4): boolean {
  return facetOf(catalog, name)?.selectors.some((s) => s.hex === selector) ?? false;
}

/** Placed facets that export `selector`, in recipe order. */
function exportersOf(recipe: Recipe, catalog: Catalog, selector: Hex4): string[] {
  return recipe.facets.filter((name) => exports(catalog, name, selector));
}

/** `transfer · 0xa9059cbb` (spec L679, dense). A selector the catalog doesn't know shows as its hex. */
function selectorLabel(catalog: Catalog, selector: Hex4): string {
  if (selector === EXPORT_SELECTORS) return formatSelector({ hex: selector, signature: "exportSelectors()" }, "dense");
  for (const facet of catalog.facets) {
    const found = facet.selectors.find((s) => s.hex === selector);
    if (found) return formatSelector(found, "dense");
  }
  return `\`${selector}\``;
}

/** The seam for `selector` once every facet in its `when` is placed (spec L302). */
function activeSeam(recipe: Recipe, catalog: Catalog, selector: Hex4): Seam | undefined {
  return catalog.seams.find((seam) => seam.selector === selector && seam.when.every((name) => recipe.facets.includes(name)));
}

/**
 * Who serves a contested selector without a new choice (spec L302-L303): a valid explicit owner, else an active
 * seam's first placed allowed facet, else the one contender that lists it in `defaultOwnerOf`.
 */
function currentOwner(recipe: Recipe, catalog: Catalog, selector: Hex4, exporters: readonly string[]): string | undefined {
  const explicit = recipe.owners[selector];
  if (explicit !== undefined && exporters.includes(explicit)) return explicit;
  const seam = activeSeam(recipe, catalog, selector);
  if (seam) return seam.anyOf.find((name) => recipe.facets.includes(name));
  const defaults = exporters.filter((name) => facetOf(catalog, name)?.defaultOwnerOf?.includes(selector) === true);
  return defaults.length === 1 ? defaults[0] : undefined;
}

/**
 * Why `facet` can't serve `selector`, or null when it can: it has to be placed and export it, and an active seam
 * keeps it on its allowed facets ("A seam says why it can't move", IR L144).
 */
function cannotServe(recipe: Recipe, catalog: Catalog, selector: Hex4, facet: string): string | null {
  const label = selectorLabel(catalog, selector);
  if (!recipe.facets.includes(facet)) return notOnSheet([facet]);
  if (!exports(catalog, facet, selector)) return `${facet} doesn't export ${label}.`;
  const seam = activeSeam(recipe, catalog, selector);
  if (seam && !seam.anyOf.includes(facet)) {
    const explicit = recipe.owners[selector];
    const holder = explicit !== undefined && seam.anyOf.includes(explicit) && recipe.facets.includes(explicit)
      ? explicit
      : seam.anyOf.find((name) => recipe.facets.includes(name));
    if (holder === undefined) return `${label} must be served by ${joinOr(seam.anyOf)}, not ${facet}.`;
    return `${label} stays on ${holder}: its version ${seam.reason}.`;
  }
  return null;
}

/** The recipe normalized, in a new project. */
function withRecipe(project: Project, catalog: Catalog, recipe: Recipe, extra: Partial<Project> = {}): Project {
  return { ...project, ...extra, recipe: normalizeRecipe(recipe, catalog) };
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(record)) {
    const value = record[k];
    if (k !== key && value !== undefined) out[k] = value;
  }
  return out;
}

/** The owners with `selector` routed to `facet` when it's contested and nothing already sends it there. */
function routedOwners(recipe: Recipe, catalog: Catalog, selector: Hex4, facet: string): Owners {
  const exporters = exportersOf(recipe, catalog, selector);
  const explicit = recipe.owners[selector];
  if (exporters.length > 1) {
    const settled = explicit === undefined || explicit === facet;
    if (settled && currentOwner(recipe, catalog, selector, exporters) === facet) return recipe.owners;
    return { ...recipe.owners, [selector]: facet };
  }
  // The only exporter serves it: an owner entry naming anyone else is stale.
  return explicit !== undefined && explicit !== facet ? withoutKey(recipe.owners, selector) : recipe.owners;
}

// ── Facets ─────────────────────────────────────────────────────────────────────────────────────────────

export const placeFacet: PlaceFacetFn = (project, catalog, name, at) => {
  const facet = facetOf(catalog, name);
  if (facet === undefined) return noOp(project, `The catalog has no facet named ${name}.`);
  if (project.recipe.facets.includes(facet.name)) return noOp(project, `${facet.name} is already on the sheet.`);
  if (!isFinitePoint(at)) return noOp(project, `${facet.name} wasn't placed: the position isn't a number.`);
  const previous = project.layout[facet.name];
  const layout = { ...project.layout, [facet.name]: { x: at.x, y: at.y, pins: previous?.pins ?? DEFAULT_PINS } };
  const recipe: Recipe = { ...project.recipe, facets: [...project.recipe.facets, facet.name] };
  return done(withRecipe(project, catalog, recipe, { layout }), `Placed ${facet.name}`);
};

export const removeFacets: RemoveFacetsFn = (project, catalog, names) => {
  const asked = unique(names);
  if (asked.length === 0) return noOp(project, "Select a facet to remove.");
  const { recipe } = project;
  const removed = asked.filter((name) => recipe.facets.includes(name));
  if (removed.length === 0) return noOp(project, notOnSheet(asked));

  const remaining = recipe.facets.filter((name) => !removed.includes(name));
  const gone = new Set(removed);

  // Their owner entries go with them (spec L285), and so does every choice left without a contest: placing a
  // facet again brings back only seams and defaults, and a hand-picked owner comes back as a fresh SEL-01
  // (spec L429, PA bug 7), never as a silent route to whichever facet was kept.
  const owners: Owners = {};
  for (const key of Object.keys(recipe.owners) as Hex4[]) {
    const owner = recipe.owners[key];
    if (owner === undefined || gone.has(owner)) continue;
    if (remaining.filter((name) => exports(catalog, name, key)).length > 1) owners[key] = owner;
  }

  // An exclusion only a removed facet exported has nothing left to exclude.
  const exclude = recipe.exclude.filter((selector) => {
    const fromRemoved = removed.some((name) => exports(catalog, name, selector));
    return !fromRemoved || remaining.some((name) => exports(catalog, name, selector));
  });

  // Their init steps, unless a facet still on the sheet uses the same init (OwnableInit serves two facets).
  const stillUsed = new Set(remaining.map((name) => facetOf(catalog, name)?.init).filter((spec) => spec !== undefined));
  const dropped = new Set(
    removed.map((name) => facetOf(catalog, name)?.init).filter((spec): spec is string => spec !== undefined && !stillUsed.has(spec)),
  );
  const { init, provenance } = dropInitSpecs(recipe.init, project.provenance, dropped);

  const layout = { ...project.layout };
  for (const name of removed) delete layout[name];

  const next: Recipe = { ...recipe, facets: remaining, owners, exclude, init };
  return done(withRecipe(project, catalog, next, { layout, provenance }), `Removed ${joinAnd(removed)}`);
};

/** The init without steps (or the bundle) whose spec is in `specs`, with provenance moved to match. */
function dropInitSpecs(
  init: RecipeInit,
  provenance: Project["provenance"],
  specs: ReadonlySet<string>,
): { init: RecipeInit; provenance: Project["provenance"] } {
  if (specs.size === 0) return { init, provenance };
  if (init.kind === "bundle") {
    if (!specs.has(init.spec)) return { init, provenance };
    return { init: EMPTY_INIT, provenance: dropProvenance(provenance, "bundle") };
  }
  if (init.kind !== "steps") return { init, provenance };
  const kept: number[] = [];
  init.steps.forEach((step, index) => {
    if (!specs.has(step.spec)) kept.push(index);
  });
  if (kept.length === init.steps.length) return { init, provenance };
  const steps = kept.map((index) => init.steps[index]).filter((step): step is InitStep => step !== undefined);
  return {
    init: { ...init, steps },
    provenance: remapStepProvenance(provenance, (index) => {
      const at = kept.indexOf(index);
      return at === -1 ? null : at;
    }),
  };
}

// ── Selectors ──────────────────────────────────────────────────────────────────────────────────────────

export const routeSelector: RouteSelectorFn = (project, catalog, selector, facet) => {
  const sel = toLowerHex(selector);
  const { recipe } = project;
  const refusal = cannotServe(recipe, catalog, sel, facet);
  if (refusal !== null) return noOp(project, refusal);
  const owners = routedOwners(recipe, catalog, sel, facet);
  const excluded = recipe.exclude.includes(sel);
  const label = selectorLabel(catalog, sel);
  if (!excluded && owners === recipe.owners) return noOp(project, `${label} already routes to ${facet}.`);
  const exclude = excluded ? recipe.exclude.filter((s) => s !== sel) : recipe.exclude;
  return done(withRecipe(project, catalog, { ...recipe, owners, exclude }), `Routed ${label} to ${facet}`);
};

export const clearOwner: ClearOwnerFn = (project, catalog, selector) => {
  const sel = toLowerHex(selector);
  const { recipe } = project;
  const label = selectorLabel(catalog, sel);
  if (recipe.owners[sel] === undefined) return noOp(project, `${label} has no owner to clear.`);
  const owners = withoutKey(recipe.owners, sel);
  return done(withRecipe(project, catalog, { ...recipe, owners }), `Cleared the owner of ${label}`);
};

export const excludeSelector: ExcludeSelectorFn = (project, catalog, selector) => {
  const sel = toLowerHex(selector);
  const { recipe } = project;
  const label = selectorLabel(catalog, sel);
  if (recipe.exclude.includes(sel)) return noOp(project, `${label} is already out.`);
  if (exportersOf(recipe, catalog, sel).length === 0) return noOp(project, `No facet on the sheet exports ${label}.`);
  // One encoding (spec L285): an excluded selector has no owner; bringing it back chooses again.
  const owners = recipe.owners[sel] === undefined ? recipe.owners : withoutKey(recipe.owners, sel);
  const next: Recipe = { ...recipe, owners, exclude: [...recipe.exclude, sel] };
  return done(withRecipe(project, catalog, next), `Left ${label} out of the diamond`);
};

export const includeSelector: IncludeSelectorFn = (project, catalog, selector, facet) => {
  const sel = toLowerHex(selector);
  const { recipe } = project;
  const label = selectorLabel(catalog, sel);
  if (!recipe.exclude.includes(sel)) return noOp(project, `${label} is already in the diamond.`);
  const exclude = recipe.exclude.filter((s) => s !== sel);
  if (facet === undefined) {
    return done(withRecipe(project, catalog, { ...recipe, exclude }), `Brought ${label} back into the diamond`);
  }
  const refusal = cannotServe(recipe, catalog, sel, facet);
  if (refusal !== null) return noOp(project, refusal);
  const owners = routedOwners(recipe, catalog, sel, facet);
  return done(withRecipe(project, catalog, { ...recipe, owners, exclude }), `Brought ${label} back, routed to ${facet}`);
};

// ── Whole recipe ───────────────────────────────────────────────────────────────────────────────────────

export const loadRecipe: LoadRecipeFn = (project, catalog, recipe, layout) => {
  const next = normalizeRecipe(recipe, catalog);
  const title = recipe.name ?? recipe.template?.name;
  const sameRecipe = canonicalJson(next) === canonicalJson(normalizeRecipe(project.recipe, catalog));
  if (sameRecipe && sameLayout(project.layout, layout)) {
    return noOp(project, `The sheet already holds ${title ?? "this recipe"}.`);
  }
  const copy: Project["layout"] = {};
  for (const name of Object.keys(layout)) {
    const entry = layout[name];
    if (entry !== undefined) copy[name] = { ...entry };
  }
  // Provenance is keyed by the old recipe's argument paths; none of them describe the new one.
  return done({ ...project, recipe: next, layout: copy, provenance: {} }, `Loaded ${title ?? "a recipe"}`);
};

function sameLayout(a: Project["layout"], b: Project["layout"]): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((name) => {
    const x = a[name];
    const y = b[name];
    return x !== undefined && y !== undefined && x.x === y.x && x.y === y.y && x.pins === y.pins
      && (x.expanded === true) === (y.expanded === true);
  });
}

export const setImmutable: SetImmutableFn = (project, immutable) => {
  const { recipe } = project;
  if ((recipe.immutable === true) === immutable) {
    return noOp(project, immutable ? "The diamond is already kept immutable." : "The diamond isn't marked immutable.");
  }
  const { immutable: _flag, ...rest } = recipe;
  const next: Recipe = immutable ? { ...rest, immutable: true } : rest;
  return done({ ...project, recipe: next }, immutable ? "Kept the diamond immutable" : "Cleared the immutable mark");
};

// ── Init ───────────────────────────────────────────────────────────────────────────────────────────────

/** The step an init path lives in, or why there isn't one. */
function stepAt(init: RecipeInit, path: InitPath): { spec: string; args: Record<string, Arg> } | string {
  if (path.root === "bundle") return init.kind === "bundle" ? init : "The init plan has no bundle.";
  const missing = `There's no step ${path.index + 1} in the init plan.`;
  if (init.kind !== "steps") return missing;
  return init.steps[path.index] ?? missing;
}

/** Why `fields` doesn't name a field of `spec`, or null when it does (or when the catalog doesn't know `spec`). */
function unknownField(catalog: Catalog, spec: string, fields: readonly string[]): string | null {
  const init = catalog.inits.find((candidate) => candidate.name === spec);
  if (init === undefined) return null;
  let params: readonly InitParam[] | undefined = init.params;
  for (const field of fields) {
    const param: InitParam | undefined = params?.find((candidate) => candidate.name === field);
    if (param === undefined) return `${spec} has no field ${fields.join(".")}.`;
    params = param.type === "tuple" ? param.components : undefined;
  }
  return null;
}

function isArgObject(value: Arg | undefined): value is { [field: string]: Arg } {
  return typeof value === "object" && !Array.isArray(value) && !Object.hasOwn(value, "$ref");
}

function readArg(args: Record<string, Arg>, fields: readonly string[]): Arg | undefined {
  let current: Arg | undefined = args;
  for (const field of fields) {
    if (!isArgObject(current)) return undefined;
    const object: { [field: string]: Arg } = current;
    current = object[field];
  }
  return current;
}

/** `args` with `value` written at `fields` (created as objects on the way), or the key deleted when undefined. */
function writeArg(args: Record<string, Arg>, fields: readonly string[], value: Arg | undefined): Record<string, Arg> {
  const [field, ...rest] = fields;
  if (field === undefined) return args;
  const out = { ...args };
  if (rest.length === 0) {
    if (value === undefined) delete out[field];
    else out[field] = value;
    return out;
  }
  const child = out[field];
  const inner = writeArg(isArgObject(child) ? child : {}, rest, value);
  // A tuple whose last field was cleared is as empty as an absent one; keep one spelling of it.
  if (Object.keys(inner).length === 0) delete out[field];
  else out[field] = inner;
  return out;
}

/**
 * A value as the summary shows it (spec L679-L681): references in words, addresses short, durations as
 * "5 minutes (300 s)", percentages with "%", wei and text as written.
 */
function showArg(value: Arg, param?: InitParam): string {
  if (typeof value === "boolean") return String(value);
  if (typeof value === "string") {
    if (value === "") return "an empty string";
    if (isAddress(value)) return formatAddress(value);
    if (/^[0-9]+$/.test(value)) {
      if (param?.unit === "seconds") return formatDuration(value);
      if (param?.unit === "percent") return `${value}%`;
    }
    return value;
  }
  if (!Array.isArray(value) && Object.hasOwn(value, "$ref")) {
    return value.$ref === "self" ? "this diamond" : "the deploying account";
  }
  return canonicalJson(value);
}

function withInit(init: RecipeInit, path: InitPath, args: Record<string, Arg>): RecipeInit {
  if (init.kind === "bundle") return { ...init, args };
  if (init.kind !== "steps" || path.root !== "steps") return init;
  const steps = init.steps.map((step, index) => (index === path.index ? { ...step, args } : step));
  return { ...init, steps };
}

export const setInitArg: SetInitArgFn = (project, catalog, path, value) => {
  const parsed = parseInitPath(path);
  if (parsed === null) return noOp(project, `\`${path}\` isn't an init field.`);
  if (parsed.fields.length === 0) {
    const which = parsed.root === "bundle" ? "The bundle" : `Step ${parsed.index + 1}`;
    return noOp(project, `${which} is a whole init step; name one of its fields.`);
  }
  const { recipe } = project;
  const step = stepAt(recipe.init, parsed);
  if (typeof step === "string") return noOp(project, step);
  const unknown = unknownField(catalog, step.spec, parsed.fields);
  if (unknown !== null) return noOp(project, unknown);

  const label = `${step.spec}.${parsed.fields.join(".")}`;
  const param = paramAt(catalog, step.spec, parsed.fields);
  const args = writeArg(step.args, parsed.fields, value);
  // Compare what would be stored: "004" for "4", or a stored address typed in lowercase, isn't an edit.
  const next = normalizeRecipe({ ...recipe, init: withInit(recipe.init, parsed, args) }, catalog);
  const stored = argAt(next.init, parsed);
  if (canonicalJson(next) === canonicalJson(normalizeRecipe(recipe, catalog))) {
    return noOp(project, stored === undefined ? `${label} is already empty.` : `${label} is already ${showArg(stored, param)}.`);
  }
  // A value set by hand no longer came from a link or a file (LINK-01, spec L465).
  const provenance = dropProvenance(project.provenance, path);
  const summary = stored === undefined ? `Cleared ${label}` : `Set ${label} to ${showArg(stored, param)}`;
  return done({ ...project, recipe: next, provenance }, summary);
};

/** The argument an init path addresses in `init`, if there is one. */
function argAt(init: RecipeInit, path: InitPath): Arg | undefined {
  const step = stepAt(init, path);
  return typeof step === "string" ? undefined : readArg(step.args, path.fields);
}

/** The parameter `fields` names in `spec`, through tuple components. */
function paramAt(catalog: Catalog, spec: string, fields: readonly string[]): InitParam | undefined {
  let params: readonly InitParam[] | undefined = catalog.inits.find((candidate) => candidate.name === spec)?.params;
  let param: InitParam | undefined;
  for (const field of fields) {
    param = params?.find((candidate) => candidate.name === field);
    params = param?.components;
  }
  return param;
}

export const addInitStep: AddInitStepFn = (project, catalog, spec, index) => {
  const init = catalog.inits.find((candidate) => candidate.name === spec);
  if (init === undefined) return noOp(project, `The catalog has no init named ${spec}.`);
  const { recipe } = project;
  const current = recipe.init;
  if (current.kind === "bundle") {
    if (current.spec === spec) return noOp(project, `${spec} is already in the init plan.`);
    return noOp(project, `The init plan is the ${current.spec} bundle, so it takes no other steps.`);
  }
  if (init.kind === "bundle") {
    if (current.kind === "steps" && current.steps.length > 0) {
      return noOp(project, `${spec} is a bundle, so it can't join other steps. Remove them first.`);
    }
    const next: Recipe = { ...recipe, init: { kind: "bundle", spec, args: {} } };
    return done(withRecipe(project, catalog, next), `Added ${spec} to the init plan`);
  }
  const steps = current.kind === "steps" ? current.steps : [];
  if (steps.some((step) => step.spec === spec)) return noOp(project, `${spec} is already in the init plan.`);
  const at = index === undefined || !Number.isFinite(index) ? steps.length : Math.min(Math.max(Math.trunc(index), 0), steps.length);
  const nextSteps = [...steps.slice(0, at), { spec, args: {} }, ...steps.slice(at)];
  const nextInit: RecipeInit = current.kind === "steps" ? { ...current, steps: nextSteps } : { kind: "steps", steps: nextSteps };
  const provenance = remapStepProvenance(project.provenance, (i) => (i >= at ? i + 1 : i));
  return done(withRecipe(project, catalog, { ...recipe, init: nextInit }, { provenance }), `Added ${spec} to the init plan`);
};

export const removeInitStep: RemoveInitStepFn = (project, catalog, path) => {
  const parsed = parseInitPath(path);
  if (parsed === null) return noOp(project, `\`${path}\` isn't an init step.`);
  const { recipe } = project;
  const step = stepAt(recipe.init, parsed);
  if (typeof step === "string") return noOp(project, step);
  const summary = `Removed ${step.spec} from the init plan`;
  if (parsed.root === "bundle" || recipe.init.kind !== "steps") {
    const provenance = dropProvenance(project.provenance, "bundle");
    return done(withRecipe(project, catalog, { ...recipe, init: EMPTY_INIT }, { provenance }), summary);
  }
  const removed = parsed.index;
  const steps = recipe.init.steps.filter((_, index) => index !== removed);
  const provenance = remapStepProvenance(project.provenance, (i) => (i === removed ? null : i > removed ? i - 1 : i));
  return done(withRecipe(project, catalog, { ...recipe, init: { ...recipe.init, steps } }, { provenance }), summary);
};

export const moveInitStep: MoveInitStepFn = (project, catalog, from, to) => {
  const { recipe } = project;
  const init = recipe.init;
  if (init.kind === "bundle") return noOp(project, `${init.spec} is a bundle: its order is fixed.`);
  if (init.kind !== "steps" || init.steps.length === 0) return noOp(project, "The init plan has no steps to move.");
  const inRange = (i: number): boolean => Number.isSafeInteger(i) && i >= 0 && i < init.steps.length;
  if (!inRange(from)) return noOp(project, `There's no step ${from + 1} in the init plan.`);
  if (!inRange(to)) return noOp(project, `There's no step ${to + 1} to move to: the plan has ${plural(init.steps.length, "step")}.`);
  const moving = init.steps[from];
  if (moving === undefined) return noOp(project, `There's no step ${from + 1} in the init plan.`);
  if (from === to) return noOp(project, `${moving.spec} is already step ${to + 1}.`);

  const order = init.steps.map((_, index) => index);
  order.splice(from, 1);
  order.splice(to, 0, from);
  const steps = order.map((index) => init.steps[index]).filter((step): step is InitStep => step !== undefined);
  const provenance = remapStepProvenance(project.provenance, (i) => order.indexOf(i));
  const before = to > 0 ? steps[to - 1]?.spec : undefined;
  const summary = before === undefined ? `Moved ${moving.spec} to step 1` : `Moved ${moving.spec} to step ${to + 1}, after ${before}`;
  return done(withRecipe(project, catalog, { ...recipe, init: { ...init, steps } }, { provenance }), summary);
};
