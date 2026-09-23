import type { Check, CheckInput } from "../model/analysis";
import type { Facet } from "../model/catalog";
import type { Anchor, ParamsOf, Problem } from "../model/problems";
import { problem, problemId } from "../model/problems";
import { joinOr } from "../format/text";

/** The namespace AccessControl owns; its DEP-02 uses spec L323's own sentence when an init writes roles. */
const ACCESS_CONTROL_NAMESPACE = "lattice.storage.AccessControl";
const ROLES_SENTENCE = "Roles are written at init, but without AccessControl nobody can manage them later.";

function placedFacets({ recipe, catalog }: CheckInput): Facet[] {
  const names = new Set(recipe.facets);
  return catalog.facets.filter((f) => names.has(f.name));
}

/** The init specs the recipe calls: the bundle, or each step. Unknown names are skipped (C4a reports them). */
function placedInits({ recipe, catalog }: CheckInput): string[] {
  const init = recipe.init;
  const names = init.kind === "bundle" ? [init.spec] : init.kind === "steps" ? init.steps.map((s) => s.spec) : [];
  return names.filter((name) => catalog.inits.some((spec) => spec.name === name));
}

function placeFixes(anyOf: readonly string[]) {
  return anyOf.map((facet) => ({ id: "facet.place" as const, args: { facet } }));
}

/** DEP-01 (hard) and DEP-02 companion (convention): one per facet and unmet requirement, in catalog order. */
function checkRequirements(placed: readonly Facet[]): Problem[] {
  const names = new Set(placed.map((f) => f.name));
  const problems: Problem[] = [];
  for (const facet of placed) {
    for (const req of facet.requires) {
      const first = req.anyOf[0];
      if (first === undefined || req.anyOf.some((option) => names.has(option))) continue;
      const where: Anchor[] = [{ kind: "facet", facet: facet.name }];
      const id = { id: problemId(req.strength === "hard" ? "DEP-01" : "DEP-02", [facet.name, first]) };
      if (req.strength === "hard") {
        const fixes = placeFixes(req.anyOf);
        const compare = req.anyOf.length > 1 ? [{ id: "dependency.compare" as const, args: { options: [...req.anyOf] } }] : [];
        problems.push(problem("DEP-01", where, { facet: facet.name, anyOf: [...req.anyOf], reason: req.reason }, [...fixes, ...compare], id));
      } else {
        const params: ParamsOf<"DEP-02"> = { kind: "companion", facet: facet.name, anyOf: [...req.anyOf], reason: req.reason };
        problems.push(problem("DEP-02", where, params, placeFixes(req.anyOf), id));
      }
    }
  }
  return problems;
}

/**
 * DEP-02 namespace (contracts §4 "Overlay semantics"): a placed facet touches a namespace, or a placed init
 * writes one, and no placed facet owns it (`storage.id`). `anyOf` is every access-family catalog facet that
 * owns it: roles someone must manage after deploy. Any other namespace (EIP712, Nonces, a shared library's
 * `diamond.lib.storage`) is written once with nothing to manage later, or has nothing to place, and raises
 * nothing. A namespace whose owner a DEP-01 or companion DEP-02 already asks
 * for is skipped, so one gap is reported once.
 */
function checkNamespaces(input: CheckInput, placed: readonly Facet[], raised: readonly Problem[]): Problem[] {
  const { catalog } = input;
  const owned = new Set(placed.flatMap((f) => (f.storage ? [f.storage.id] : [])));
  // Only roles need managing after deploy: namespaces an access-family facet owns (contracts §4, ruling 2026-09-23).
  const ownersOf = (namespace: string) =>
    catalog.facets.filter((f) => f.storage?.id === namespace && f.family === "access").map((f) => f.name);
  const asked = new Set(raised.flatMap((p) => (Array.isArray(p.params.anyOf) ? p.params.anyOf.filter((x) => typeof x === "string") : [])));

  // Namespaces in first-seen order: facets in catalog order, then the inits in call order.
  const writers = new Map<string, { facets: string[]; init: boolean }>();
  const note = (namespace: string, facet?: string) => {
    const entry = writers.get(namespace) ?? { facets: [], init: false };
    if (facet === undefined) entry.init = true;
    else if (!entry.facets.includes(facet)) entry.facets.push(facet);
    writers.set(namespace, entry);
  };
  for (const facet of placed) for (const namespace of facet.touches) note(namespace, facet.name);
  for (const name of placedInits(input)) {
    const spec = catalog.inits.find((s) => s.name === name);
    for (const { module } of spec?.initializes ?? []) {
      const namespace = catalog.facets.find((f) => f.name === module)?.storage?.id;
      if (namespace !== undefined) note(namespace);
    }
  }

  const problems: Problem[] = [];
  for (const [namespace, { facets, init }] of writers) {
    if (owned.has(namespace)) continue;
    const anyOf = ownersOf(namespace);
    if (anyOf.length === 0 || anyOf.some((name) => asked.has(name))) continue;
    const first = facets[0];
    const params: Extract<ParamsOf<"DEP-02">, { kind: "namespace" }> = { kind: "namespace", namespace, anyOf };
    if (first !== undefined) params.facet = first;
    if (init && namespace === ACCESS_CONTROL_NAMESPACE) params.reason = ROLES_SENTENCE;
    // Only facets write it: C10's generic wording says "at init", so say what does write it instead.
    else if (!init && first !== undefined) {
      params.reason = `${first} writes \`${namespace}\`, but without ${joinOr(anyOf)} nobody can manage it later.`;
    }
    const where: Anchor[] = facets.length > 0 ? facets.map((facet) => ({ kind: "facet", facet })) : [{ kind: "diamond" }];
    problems.push(problem("DEP-02", where, params, placeFixes(anyOf), { id: problemId("DEP-02", ["diamond", namespace]) }));
  }
  return problems;
}

/** DEP-03: two placed members of the access or account family; one problem per pair, catalog order. */
function checkFamilies(placed: readonly Facet[]): Problem[] {
  const problems: Problem[] = [];
  for (const family of ["access", "account"] as const) {
    const members = placed.filter((f) => f.family === family).map((f) => f.name);
    for (const [i, a] of members.entries()) {
      for (const b of members.slice(i + 1)) {
        problems.push(
          problem(
            "DEP-03",
            [
              { kind: "facet", facet: a },
              { kind: "facet", facet: b },
            ],
            { facets: [a, b], family },
            [
              { id: "facet.remove", args: { facets: [a] } },
              { id: "facet.remove", args: { facets: [b] } },
            ],
            { id: problemId("DEP-03", [a, b]) },
          ),
        );
      }
    }
  }
  return problems;
}

/** DEP-01 to DEP-03 (spec L323-L325, Flow 5 at L443-L449). Owner: WP-C3. */
export const checkDep: Check = (input) => {
  const placed = placedFacets(input);
  const requirements = checkRequirements(placed);
  return [...requirements, ...checkNamespaces(input, placed, requirements), ...checkFamilies(placed)];
};
