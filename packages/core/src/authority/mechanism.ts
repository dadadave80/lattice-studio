/**
 * Flow 17, Choose an upgrade mechanism (spec L640-L652): the five options and the change each one makes,
 * previewed as a list and applied as one recipe.
 */
import { canonicalJson } from "../canonical/json";
import { formatAddress, formatDuration, plural } from "../format/format";
import { joinAnd } from "../format/text";
import type { MechanismOptionsFn, PlanMechanismChangeFn } from "../model/api";
import type { Catalog, Facet, InitSpec } from "../model/catalog";
import type { Hex4 } from "../model/hex";
import type { ChangeLine, Mechanism, MechanismChange, MechanismInputs, MechanismOption, MechanismOptions } from "../model/init";
import type { Arg, InitStep, Recipe } from "../model/recipe";
import { err, ok, type Result } from "../model/result";
import {
  ADMIN_ROLE,
  authorityArgs,
  decidingBundle,
  facetNamed,
  GOVERNANCE_DISABLED,
  isAddressLike,
  MECHANISMS,
  mechanismByFacet,
  mechanismById,
  OWNER_ROLE,
  refOf,
  signature,
  specNamed,
  upgradeMembers,
  type MechanismDef,
} from "./semantics";

const AUTOMATIC_STEP = "the automatic ERC-165 step";

/** C4c `mechanismOptions` (spec L644-L651). */
export const mechanismOptions: MechanismOptionsFn = (recipe, catalog) => {
  const bundle = decidingBundle(recipe, catalog);
  const current = currentMechanism(recipe, catalog, bundle);
  const options = MECHANISMS.map((def) => optionFor(def, catalog, current, bundle));
  const out: MechanismOptions = { current, options };
  if (bundle) out.bundle = bundle.name;
  return out;
};

function currentMechanism(recipe: Recipe, catalog: Catalog, bundle: InitSpec | undefined): Mechanism | null {
  for (const member of upgradeMembers(recipe, catalog)) {
    const def = mechanismByFacet(member.name);
    if (def) return def.id;
  }
  if (bundle) {
    const def = MECHANISMS.find((m) => m.facet !== undefined && bundle.initializes.some((i) => i.module === m.facet));
    if (def) return def.id;
  }
  if (upgradeMembers(recipe, catalog).length === 0 && recipe.immutable) return "immutable";
  return null;
}

function bundleReason(bundle: string): string {
  return `${bundle} sets up the upgrade mechanism itself, so the bundle decides it.`;
}

function optionFor(def: MechanismDef, catalog: Catalog, current: Mechanism | null, bundle: InitSpec | undefined): MechanismOption {
  const out: MechanismOption = { id: def.id, label: def.label, summary: def.summary, enabled: true };
  if (def.facet) out.facet = def.facet;
  const disable = (reason: string): MechanismOption => ({ ...out, enabled: false, reason });
  if (bundle) return def.id === current ? out : disable(bundleReason(bundle.name));
  if (def.id === "governance") return disable(GOVERNANCE_DISABLED);
  if (def.facet && !facetNamed(catalog, def.facet)) return disable(`${def.facet} isn't in this catalog.`);
  return out;
}

/** C4c `planMechanismChange` (spec L650-L652). Never mutates `recipe`. */
export const planMechanismChange: PlanMechanismChangeFn = (recipe, catalog, choice, inputs) => {
  const options = mechanismOptions(recipe, catalog);
  if (options.bundle) return err(bundleReason(options.bundle));
  const option = options.options.find((o) => o.id === choice);
  const def = mechanismById(choice);
  if (!option?.enabled) return err(option?.reason ?? `${def.label} isn't available.`);
  if (recipe.init.kind === "bundle") {
    return err(`The init is a bundle, ${recipe.init.spec}, so Studio can't swap the upgrade mechanism's init steps.`);
  }
  if (choice === "admin" && inputs.keepMechanism) return handAdminToSafe(recipe, catalog, options.current, inputs);
  const missing = missingInput(choice, inputs);
  if (missing) return err(missing);
  return switchMechanism(recipe, catalog, def, inputs);
};

function missingInput(choice: Mechanism, inputs: MechanismInputs): string | undefined {
  if (choice !== "safe" && choice !== "safe-delay") return undefined;
  if (inputs.safe === undefined) return "Enter the Safe's address.";
  if (inputs.minThreshold === undefined || inputs.minThreshold === "") return "Enter the Safe's minimum threshold.";
  if (choice === "safe-delay" && (inputs.delay === undefined || inputs.delay === "")) return "Enter the delay.";
  return undefined;
}

// ── Switching mechanisms ────────────────────────────────────────────────────────────────────────────

type Located = { step: InitStep; index: number };

function switchMechanism(recipe: Recipe, catalog: Catalog, def: MechanismDef, inputs: MechanismInputs): Result<MechanismChange, string> {
  const newFacet = def.facet ? facetNamed(catalog, def.facet) : undefined;
  if (def.facet && !newFacet) return err(`${def.facet} isn't in this catalog.`);
  const newSpec = newFacet?.init ? specNamed(catalog, newFacet.init) : undefined;
  if (newFacet?.init && !newSpec) return err(`${newFacet.init} isn't in this catalog.`);

  // Facets: remove the old members, place the new one and its companions, drop companions nothing else needs.
  const members = upgradeMembers(recipe, catalog);
  const removedMembers = members.filter((m) => m.name !== def.facet).map((m) => m.name);
  const facets = new Set(recipe.facets.filter((f) => !removedMembers.includes(f)));
  const placed: string[] = [];
  // Companions come with a newly placed member only; re-choosing the current one leaves the sheet alone.
  if (newFacet && !facets.has(newFacet.name)) {
    placed.push(newFacet.name, ...companionsNeeded(newFacet, new Set([...facets, newFacet.name]), catalog));
  }
  for (const name of placed) facets.add(name);
  const removedCompanions = exclusiveCompanions(removedMembers, facets, catalog);
  for (const name of removedCompanions) facets.delete(name);
  const removedFacets = [...removedMembers, ...removedCompanions];

  // Init: drop the removed facets' inits and whatever the new init subsumes, place the new init, and put back
  // an init a remaining facet still needs (AccessControlInit when leaving SafeDiamondCut for Admin role).
  const steps = recipe.init.kind === "steps" ? recipe.init.steps : [];
  const remainingInits = new Set([...facets].map((f) => facetNamed(catalog, f)?.init).filter((i): i is string => i !== undefined));
  const removedInits = new Set(removedFacets.map((f) => facetNamed(catalog, f)?.init).filter((i): i is string => i !== undefined));
  const kept: Located[] = [];
  const dropped: Located[] = [];
  for (const [index, step] of steps.entries()) {
    const spec = specNamed(catalog, step.spec);
    const orphaned = removedInits.has(step.spec) && !remainingInits.has(step.spec);
    const subsumed = newSpec !== undefined && spec !== undefined && step.spec !== newSpec.name && subsumes(newSpec, spec);
    (orphaned || subsumed ? dropped : kept).push({ step, index });
  }

  const carried = (role: string): Arg | undefined =>
    firstArg(dropped.map((d) => d.step), catalog, role) ?? firstArg(steps, catalog, role);
  const admin = inputs.admin ?? carried(ADMIN_ROLE) ?? { $ref: "deployer" };
  const argsFor = (spec: InitSpec): Record<string, Arg> => initArgs(spec, def, inputs, admin, carried(OWNER_ROLE) ?? admin);

  const nextSteps: InitStep[] = kept.map((k) => ({ spec: k.step.spec, args: k.step.args }));
  const insertAt = dropped.length === 0 ? 0 : kept.filter((k) => k.index < (dropped[0]?.index ?? 0)).length;
  const added: InitSpec[] = [];
  const argLines: ChangeLine[] = [];
  if (newSpec) {
    const existing = nextSteps.findIndex((s) => s.spec === newSpec.name);
    if (existing === -1) {
      added.push(newSpec);
    } else {
      const step = nextSteps[existing];
      if (step) {
        const updated = { ...step.args, ...overrides(newSpec, def, inputs) };
        argLines.push(...argChanges(newSpec, step.args, updated));
        nextSteps[existing] = { spec: step.spec, args: updated };
      }
    }
  }
  const droppedModules = new Set(dropped.flatMap((d) => specNamed(catalog, d.step.spec)?.initializes.map((i) => i.module) ?? []));
  for (const name of catalogOrder([...facets], catalog)) {
    const init = facetNamed(catalog, name)?.init;
    const spec = init ? specNamed(catalog, init) : undefined;
    if (!spec || spec.initializes.length === 0) continue;
    if (added.some((a) => a.name === spec.name) || nextSteps.some((s) => s.spec === spec.name)) continue;
    const covered = new Set([...nextSteps.map((s) => s.spec), ...added.map((a) => a.name)].flatMap(
      (s) => specNamed(catalog, s)?.initializes.map((i) => i.module) ?? [],
    ));
    const needed = spec.initializes.some((i) => droppedModules.has(i.module));
    if (needed && !spec.initializes.every((i) => covered.has(i.module))) added.push(spec);
  }
  nextSteps.splice(insertAt, 0, ...added.map((spec) => ({ spec: spec.name, args: argsFor(spec) })));

  const nextFacets = catalogOrder([...facets], catalog);
  const next: Recipe = {
    ...withoutImmutable(recipe),
    facets: nextFacets,
    owners: keepOwners(recipe.owners, nextFacets),
    exclude: keepExcluded(recipe.exclude, nextFacets, catalog),
    init: nextSteps.length > 0 ? { kind: "steps", steps: nextSteps } : { kind: "none" },
  };
  if (def.id === "immutable") next.immutable = true;

  const changes: ChangeLine[] = [
    ...removedFacets.map((facet): ChangeLine => ({ kind: "remove", text: `Remove ${facet}`, facet })),
    ...placed.map((facet): ChangeLine => ({ kind: "place", text: `Place ${facet}`, facet })),
  ];
  const initLine = initChange(recipe, next, catalog, dropped, added, newSpec, def);
  if (initLine) changes.push(initLine);
  changes.push(...argLines);
  if (canonicalJson(next) === canonicalJson(recipe)) {
    return err(def.id === "immutable" ? "This diamond is already immutable." : `${def.facet ?? def.label} is already the upgrade mechanism.`);
  }
  const upgrade = upgradeLine(def, next, catalog, inputs);
  if (upgrade) changes.push(upgrade);
  if (def.id === "immutable") changes.push({ kind: "immutable", text: "Keep immutable: nothing can change this diamond after deploy" });
  else if (recipe.immutable) changes.push({ kind: "immutable", text: "Clear Keep immutable" });
  return ok({ changes, next });
}

/** Every module `inner` initializes, `outer` initializes too (SafeDiamondCutInit subsumes AccessControlInit). */
function subsumes(outer: InitSpec, inner: InitSpec): boolean {
  return inner.initializes.length > 0 && inner.initializes.every((i) => outer.initializes.some((o) => o.module === i.module));
}

/**
 * Facets the new member needs placed: the first option of each `requires` entry none of whose options is
 * placed, and the owner of each namespace it `touches` that no placed facet owns (DEP-02's two sources).
 */
function companionsNeeded(member: Facet, placed: ReadonlySet<string>, catalog: Catalog): string[] {
  const out = new Set<string>();
  for (const req of member.requires) {
    if (req.anyOf.some((n) => placed.has(n))) continue;
    const first = req.anyOf.find((n) => facetNamed(catalog, n));
    if (first) out.add(first);
  }
  for (const ns of member.touches) {
    const owners = catalog.facets.filter((f) => f.storage?.id === ns);
    if (owners.length === 0 || owners.some((f) => placed.has(f.name))) continue;
    const first = owners[0];
    if (first) out.add(first.name);
  }
  return catalogOrder([...out].filter((n) => !placed.has(n)), catalog);
}

/** Companions of the removed members that no remaining facet needs, removed until nothing else frees up. */
function exclusiveCompanions(removed: readonly string[], facets: ReadonlySet<string>, catalog: Catalog): string[] {
  const members = removed.map((n) => facetNamed(catalog, n)).filter((f): f is Facet => f !== undefined);
  const serves = (companion: Facet, user: Facet) =>
    user.requires.some((r) => r.anyOf.includes(companion.name)) || (companion.storage !== undefined && user.touches.includes(companion.storage.id));
  const candidates = catalog.facets.filter((f) => facets.has(f.name) && members.some((m) => serves(f, m)));
  const remaining = new Set(facets);
  const out: string[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of candidates) {
      if (!remaining.has(candidate.name)) continue;
      const needed = [...remaining].some((n) => {
        const user = n === candidate.name ? undefined : facetNamed(catalog, n);
        return user !== undefined && serves(candidate, user);
      });
      if (needed) continue;
      remaining.delete(candidate.name);
      out.push(candidate.name);
      changed = true;
    }
  }
  return catalogOrder(out, catalog);
}

function initArgs(spec: InitSpec, def: MechanismDef, inputs: MechanismInputs, admin: Arg, owner: Arg): Record<string, Arg> {
  const out: Record<string, Arg> = {};
  for (const p of spec.params) {
    if (p.authority && p.role === ADMIN_ROLE) out[p.name] = admin;
    else if (p.authority && p.role === OWNER_ROLE) out[p.name] = owner;
  }
  return { ...out, ...overrides(spec, def, inputs) };
}

/** What Fill in collects, routed to the init's params (spec L650). */
function overrides(spec: InitSpec, def: MechanismDef, inputs: MechanismInputs): Record<string, Arg> {
  const out: Record<string, Arg> = {};
  for (const p of spec.params) {
    if (p.authority && p.role === def.cutFn && inputs.safe !== undefined) out[p.name] = inputs.safe;
    else if (p.authority && p.role === ADMIN_ROLE && inputs.admin !== undefined) out[p.name] = inputs.admin;
    else if (p.name === "minThreshold" && inputs.minThreshold !== undefined) out[p.name] = inputs.minThreshold;
    else if (p.name === "minDelay" && inputs.delay !== undefined) out[p.name] = inputs.delay;
  }
  return out;
}

function argChanges(spec: InitSpec, before: Record<string, Arg>, after: Record<string, Arg>): ChangeLine[] {
  return spec.params
    .filter((p) => Object.hasOwn(after, p.name) && canonicalJson(before[p.name] ?? null) !== canonicalJson(after[p.name] ?? null))
    .map((p) => ({ kind: "init", text: `Init: ${spec.contract}(${p.name}) → ${argText(after[p.name], p.role === "diamondCut" || p.role === "scheduleCut")}` }));
}

function firstArg(steps: readonly InitStep[], catalog: Catalog, role: string): Arg | undefined {
  const recipe: Recipe = { schemaVersion: 1, catalog: { tag: "", hash: "0x" }, facets: [], owners: {}, exclude: [], init: { kind: "steps", steps: [...steps] } };
  return authorityArgs(recipe, catalog).find((a) => a.param.role === role && a.value !== undefined)?.value;
}

function initChange(
  before: Recipe,
  after: Recipe,
  catalog: Catalog,
  dropped: readonly Located[],
  added: readonly InitSpec[],
  newSpec: InitSpec | undefined,
  def: MechanismDef,
): ChangeLine | undefined {
  const removedTexts = dropped.map((d) => {
    const spec = specNamed(catalog, d.step.spec);
    return spec ? signature(spec) : d.step.spec;
  });
  const addedTexts = added.map(signature);
  const autoBefore = hasAutomaticStep(before, catalog);
  const autoAfter = hasAutomaticStep(after, catalog);
  if (autoBefore && !autoAfter) removedTexts.push(AUTOMATIC_STEP);
  if (!autoBefore && autoAfter) addedTexts.push(AUTOMATIC_STEP);
  if (addedTexts.length === 0 && removedTexts.length === 0) return undefined;
  if (removedTexts.length === 0) return { kind: "init", text: `Init: add ${joinAnd(addedTexts)}` };
  if (addedTexts.length === 0) return { kind: "init", text: `Init: remove ${joinAnd(removedTexts)}` };
  const verb = addedTexts.length === 1 ? "replaces" : "replace";
  let text = `Init: ${joinAnd(addedTexts)} ${verb} ${joinAnd(removedTexts)}`;
  if (newSpec && added.length === 1 && added[0] === newSpec && addedTexts.length === 1) {
    const sets = newSpec.initializes.map((i) => i.module).filter((m) => m !== def.facet);
    if (newSpec.registersInterfaces) sets.push("the flags");
    if (sets.length > 0) text += `, since it sets up ${joinAnd(sets)} itself`;
  }
  return { kind: "init", text };
}

/** Step inits get the ERC-165 step appended unless a step registers the interfaces itself (spec L468). */
function hasAutomaticStep(recipe: Recipe, catalog: Catalog): boolean {
  if (recipe.init.kind !== "steps" || recipe.init.steps.length === 0) return false;
  return !recipe.init.steps.some((s) => specNamed(catalog, s.spec)?.registersInterfaces === true);
}

function upgradeLine(def: MechanismDef, next: Recipe, catalog: Catalog, inputs: MechanismInputs): ChangeLine | undefined {
  if (def.id === "immutable") return undefined;
  if (def.id === "admin") {
    const holder = authorityArgs(next, catalog).find((a) => a.param.role === ADMIN_ROLE && a.value !== undefined)?.value;
    const who = holder === undefined ? "holders of `DEFAULT_ADMIN_ROLE`" : `${argText(holder, false)}, through \`DEFAULT_ADMIN_ROLE\``;
    return { kind: "authority", text: `Upgrade → ${who}` };
  }
  let text = `Upgrade → ${argText(inputs.safe, true)}`;
  if (inputs.minThreshold !== undefined) text += `, at least ${thresholdText(inputs.minThreshold)}`;
  if (def.id === "safe-delay" && inputs.delay !== undefined) text += `, after ${durationText(inputs.delay)}`;
  return { kind: "authority", text };
}

function thresholdText(value: string): string {
  return /^\d+$/.test(value) ? plural(BigInt(value), "signature") : `${value} signatures`;
}

function durationText(value: string): string {
  return /^\d+$/.test(value) ? formatDuration(value) : `${value} seconds`;
}

/** "Safe 0x71C7…976F", "this diamond", "Deploying account". */
export function argText(value: Arg | undefined, safe: boolean): string {
  const ref = refOf(value);
  if (ref === "self") return "this diamond";
  if (ref === "deployer") return "Deploying account";
  if (isAddressLike(value)) return `${safe ? "Safe " : ""}${formatAddress(value as `0x${string}`)}`;
  if (typeof value === "string") return value;
  return value === undefined ? "nobody" : canonicalJson(value);
}

// ── Admin role: Use a Safe… ─────────────────────────────────────────────────────────────────────────

/** Keeps AccessControlDiamondCut and hands `DEFAULT_ADMIN_ROLE` to the Safe (spec L650). */
function handAdminToSafe(recipe: Recipe, catalog: Catalog, current: Mechanism | null, inputs: MechanismInputs): Result<MechanismChange, string> {
  if (current !== "admin") return err("Keeping the mechanism needs AccessControlDiamondCut on the sheet.");
  if (inputs.safe === undefined) return err("Enter the Safe's address.");
  const safe = inputs.safe;
  const admins = authorityArgs(recipe, catalog).filter((a) => a.param.role === ADMIN_ROLE);
  if (admins.length === 0) return err("No init argument grants `DEFAULT_ADMIN_ROLE` yet, so there's nothing to hand to the Safe.");
  const changing = admins.filter((a) => canonicalJson(a.value ?? null) !== canonicalJson(safe));
  if (changing.length === 0) return err("`DEFAULT_ADMIN_ROLE` already goes to that address.");
  if (recipe.init.kind !== "steps") return err("No init argument grants `DEFAULT_ADMIN_ROLE` yet, so there's nothing to hand to the Safe.");
  const steps = recipe.init.steps.map((s) => ({ spec: s.spec, args: s.args }));
  for (const a of changing) {
    const step = steps[a.step];
    if (step) step.args = setAt(step.args, a.path.split(".").slice(1), safe);
  }
  const next: Recipe = { ...recipe, init: { kind: "steps", steps } };
  const holder = argText(safe, true);
  const changes: ChangeLine[] = [
    ...changing.map((a): ChangeLine => ({ kind: "init", text: `Init: ${a.spec.contract}(${a.param.name}) → ${holder}` })),
    { kind: "authority", text: `Upgrade → ${holder}, through \`DEFAULT_ADMIN_ROLE\`` },
  ];
  return ok({ changes, next });
}

function setAt(args: Record<string, Arg>, keys: readonly string[], value: Arg): Record<string, Arg> {
  const [head, ...rest] = keys;
  if (head === undefined) return args;
  if (rest.length === 0) return { ...args, [head]: value };
  const inner = args[head];
  const record = typeof inner === "object" && inner !== null && !Array.isArray(inner) && refOf(inner) === undefined ? (inner as Record<string, Arg>) : {};
  return { ...args, [head]: setAt(record, rest, value) };
}

// ── Recipe helpers ──────────────────────────────────────────────────────────────────────────────────

function catalogOrder(names: readonly string[], catalog: Catalog): string[] {
  const rank = new Map(catalog.facets.map((f, i) => [f.name, i]));
  return [...new Set(names)]
    .map((name, i) => ({ name, i }))
    .sort((a, b) => (rank.get(a.name) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.name) ?? Number.MAX_SAFE_INTEGER) || a.i - b.i)
    .map((x) => x.name);
}

function withoutImmutable(recipe: Recipe): Recipe {
  const { immutable: _immutable, ...rest } = recipe;
  return rest;
}

/** Removing a facet drops its owner entries (spec L281). */
function keepOwners(owners: Readonly<Record<Hex4, string>>, facets: readonly string[]): Record<Hex4, string> {
  const placed = new Set(facets);
  return Object.fromEntries(Object.entries(owners).filter(([, facet]) => placed.has(facet))) as Record<Hex4, string>;
}

/** Exclusions of selectors no placed facet exports any more go with the facet. */
function keepExcluded(exclude: readonly Hex4[], facets: readonly string[], catalog: Catalog): Hex4[] {
  const exported = new Set(facets.flatMap((f) => facetNamed(catalog, f)?.selectors.map((s) => s.hex) ?? []));
  return exclude.filter((s) => exported.has(s));
}
