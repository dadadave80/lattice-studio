import { activeSeam, EXPORT_SELECTORS, EXPORT_SELECTORS_SIGNATURE, inCatalogOrder, recipeView, type RecipeView, signatureOf } from "../analysis/view";
import type { Check, Routing } from "../model/analysis";
import type { CommandRef } from "../model/commands";
import type { Hex4 } from "../model/hex";
import { type Anchor, type Problem, problem, problemId, type ProblemParams } from "../model/problems";

/**
 * SEL-01 to SEL-05 (spec L311-L315, contracts §3.3). Per selector, never grouped: grouping a contender set into
 * one note is the sheet's job (S4c). Reads the routing it's given; seams, families and owners from the recipe.
 */
export const checkSel: Check = ({ recipe, catalog, routing }) => {
  const view = recipeView(recipe, catalog);
  return [...ownerProblems(view), ...collisions(view, routing), ...facetProblems(view, routing)];
};

/** SEL-04 (an owner for 0x0ef22643) and SEL-05 (an owner that isn't placed or doesn't export its selector). */
function ownerProblems(view: RecipeView): Problem[] {
  const out: Problem[] = [];
  for (const [selector, facet] of view.owners) {
    const placed = view.placedNames.has(facet);
    const where: Anchor[] = [placed ? { kind: "selector", selector, facet } : { kind: "selector", selector }];
    const fixes: CommandRef[] = [{ id: "selector.clearOwner", args: { selector } }];
    const id = problemId(selector === EXPORT_SELECTORS ? "SEL-04" : "SEL-05", selector);
    if (selector === EXPORT_SELECTORS) {
      out.push(problem("SEL-04", where, { selector, signature: EXPORT_SELECTORS_SIGNATURE, facet }, fixes, { id }));
      continue;
    }
    const exports = view.contenders.get(selector)?.includes(facet) ?? false;
    if (placed && exports) continue;
    const params: ProblemParams["SEL-05"] = { selector, facet, reason: placed ? "not-exported" : "not-placed" };
    const signature = signatureOf(view.catalog, selector);
    if (signature !== undefined) params.signature = signature;
    out.push(problem("SEL-05", where, params, fixes, { id }));
  }
  return out;
}

/**
 * SEL-01: a selector two or more placed facets export, with no owner, seam or default. The more specific rule
 * wins (spec L345): not when an active seam governs it (SEM-01), nor when every contender belongs to one
 * `family` (CORE-03 for upgrade mechanisms, DEP-03 for access and account models).
 */
function collisions(view: RecipeView, routing: Routing): Problem[] {
  const out: Problem[] = [];
  for (const selector of Object.keys(routing).sort() as Hex4[]) {
    const route = routing[selector];
    if (route === undefined || route.owner !== undefined || route.contenders.length < 2) continue;
    if (activeSeam(view, selector) !== undefined || oneFamily(view, route.contenders)) continue;
    const contenders = inCatalogOrder(view, route.contenders);
    const signature = signatureOf(view.catalog, selector) ?? selector;
    out.push(
      problem(
        "SEL-01",
        contenders.map((facet) => ({ kind: "selector", selector, facet })),
        { selector, signature, contenders },
        routeFixes(selector, contenders),
        { id: problemId("SEL-01", selector) },
      ),
    );
  }
  return out;
}

/** Two contenders: Keep {A} · Route to {B}. Three or more: one route per contender, the owner menu (spec L436). */
function routeFixes(selector: Hex4, contenders: readonly string[]): CommandRef[] {
  if (contenders.length === 2) {
    const [keep, other] = contenders;
    return [
      { id: "selector.route", args: { selector, facet: keep ?? "", verb: "keep" } },
      { id: "selector.route", args: { selector, facet: other ?? "" } },
    ];
  }
  return contenders.map((facet) => ({ id: "selector.route", args: { selector, facet } }));
}

function oneFamily(view: RecipeView, names: readonly string[]): boolean {
  const families = names.map((name) => view.placed.find((facet) => facet.name === name)?.family);
  const first = families[0];
  return first !== undefined && families.every((family) => family === first);
}

/**
 * SEL-03: a placed facet routes nothing because every selector it exports is excluded or served elsewhere.
 * A selector still waiting for a choice (SEL-01) or with no allowed server (SEM-01) holds it back: the choice
 * may land here. SEL-02: a facet that still routes something gives selectors to other owners. A facet raises
 * one or the other, never both.
 */
function facetProblems(view: RecipeView, routing: Routing): Problem[] {
  const out: Problem[] = [];
  for (const facet of view.placed) {
    const selectors = facet.selectors.map((s) => s.hex.toLowerCase() as Hex4).filter((s) => s !== EXPORT_SELECTORS);
    if (selectors.length === 0) continue;
    const where: Anchor[] = [{ kind: "facet", facet: facet.name }];
    const routedHere = selectors.filter((s) => routing[s]?.owner === facet.name);
    const given = selectors.filter((s) => !view.exclude.has(s) && ownerOf(routing, s) !== undefined && ownerOf(routing, s) !== facet.name);
    const owners = inCatalogOrder(view, given.map((s) => ownerOf(routing, s) ?? ""));
    if (routedHere.length > 0) {
      if (given.length === 0) continue;
      out.push(
        problem("SEL-02", where, { facet: facet.name, count: given.length, selectors: given, to: owners }, [
          { id: "inspector.focusSelectors", args: { facet: facet.name } },
        ]),
      );
      continue;
    }
    const pending = selectors.some((s) => !view.exclude.has(s) && ownerOf(routing, s) === undefined);
    if (pending) continue;
    const excluded = selectors.filter((s) => view.exclude.has(s));
    const seams = given.filter((s) => routing[s]?.via === "seam");
    const why: ProblemParams["SEL-03"]["why"] =
      excluded.length === selectors.length ? "excluded" : seams.length === selectors.length ? "seams" : given.length === selectors.length && seams.length === 0 ? "owned" : "mixed";
    const movable = selectors.filter((s) => view.exclude.has(s) || (routing[s] !== undefined && routing[s]?.via !== "seam"));
    const fixes: CommandRef[] = [{ id: "facet.remove", args: { facets: [facet.name] } }];
    if (movable.length > 0) fixes.push({ id: "inspector.focusSelectors", args: { facet: facet.name } });
    out.push(problem("SEL-03", where, { facet: facet.name, count: selectors.length, why, servedBy: owners, movable }, fixes));
  }
  return out;
}

function ownerOf(routing: Routing, selector: Hex4): string | undefined {
  return routing[selector]?.owner;
}
