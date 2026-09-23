/**
 * The Facet view's derived rows (IR L118, board 06): selector counts, the Cut line, where its init runs, its
 * namespaces and who shares them, the seams it serves and its requirements' status. Pure, shared by the Facet
 * view and the Catalog preview.
 */
import type { Catalog, Facet, Hex4, InitPlan, Problem, Recipe, Routing, Seam } from "@lattice-studio/core";
import { formatCount, plural } from "@lattice-studio/core";

export type SelectorCounts = {
  exported: number;
  /** Its selectors in `recipe.exclude`. */
  excluded: number;
  /** Its selectors it owns in the routing. */
  cut: number;
  /** One of its selectors has two or more contenders and no owner. */
  contested: boolean;
};

export function selectorCounts(facet: Facet, routing: Routing, exclude: readonly string[]): SelectorCounts {
  const excludedSet = new Set(exclude.map((hex) => hex.toLowerCase()));
  let excluded = 0;
  let cut = 0;
  let contested = false;
  for (const selector of facet.selectors) {
    const hex = selector.hex.toLowerCase();
    if (excludedSet.has(hex)) {
      excluded += 1;
      continue;
    }
    const route = routing[hex as Hex4];
    if (route?.owner === facet.name) cut += 1;
    if (route && route.owner === undefined && route.contenders.length > 1) contested = true;
  }
  return { exported: facet.selectors.length, excluded, cut, contested };
}

/** "17 exported · 5 excluded · 12 cut" (board 06). */
export function selectorsText(counts: SelectorCounts): string {
  return `${counts.exported} exported · ${counts.excluded} excluded · ${counts.cut} cut`;
}

/** "ADD · 12 selectors"; "ADD · 0/2 selectors" while contested (the ⟂ is the view's); "none" when nothing is cut. */
export function cutText(counts: SelectorCounts): string {
  if (counts.contested) return `ADD · ${formatCount(counts.cut, counts.exported)}`;
  if (counts.cut > 0) return `ADD · ${plural(counts.cut, "selector")}`;
  return "none";
}

/** "lattice.storage.ERC4626 · reads lattice.storage.ERC20", "none · reads lattice.storage.Pausable". */
export function namespaceText(facet: Facet): string {
  const own = facet.storage?.id ?? "none";
  return facet.touches.length === 0 ? own : `${own} · reads ${facet.touches.join(" · ")}`;
}

/** Other placed facets that declare or touch a namespace this facet declares or touches, in recipe order. */
export function sharedWith(facet: Facet, catalog: Catalog, placed: readonly string[]): string[] {
  const mine = new Set([...(facet.storage ? [facet.storage.id] : []), ...facet.touches]);
  if (mine.size === 0) return [];
  return placed.filter((name) => {
    if (name === facet.name) return false;
    const other = catalog.facets.find((f) => f.name === name);
    if (!other) return false;
    return (other.storage !== undefined && mine.has(other.storage.id)) || other.touches.some((id) => mine.has(id));
  });
}

/** Active seams (every `when` facet placed) this facet is allowed to serve. */
export function servedSeams(facet: Facet, catalog: Catalog, placed: readonly string[]): Seam[] {
  return catalog.seams.filter((seam) => seam.anyOf.includes(facet.name) && seam.when.every((name) => placed.includes(name)));
}

/** A selector's signature from any catalog facet that exports it. */
export function signatureOf(catalog: Catalog, hex: string): string | undefined {
  const wanted = hex.toLowerCase();
  for (const facet of catalog.facets) {
    const found = facet.selectors.find((selector) => selector.hex.toLowerCase() === wanted);
    if (found) return found.signature;
  }
  return undefined;
}

export type RequirementStatus =
  | { status: "met"; by: string }
  | { status: "missing"; convention: boolean };

export function requirementStatus(requirement: Facet["requires"][number], placed: readonly string[]): RequirementStatus {
  const by = requirement.anyOf.find((name) => placed.includes(name));
  if (by !== undefined) return { status: "met", by };
  return { status: "missing", convention: requirement.strength === "convention" };
}

export type InitPlacement =
  /** A MultiInit step. `recipeIndex`/`recipeSteps` bound Move step up/down; `index`/`count` read "Step 3 of 5". */
  | { kind: "step"; spec: string; path: string; index: number; count: number; recipeIndex: number; recipeSteps: number; locked: boolean }
  /** Run inside a bundle, whose order is fixed. */
  | { kind: "bundle"; spec: string; path: string }
  /** Has an init contract the plan doesn't call. */
  | { kind: "absent"; spec: string }
  | { kind: "none" };

/** Where this facet's init runs in the recipe's plan. */
export function initPlacement(facet: Facet, recipe: Recipe, catalog: Catalog, plan: InitPlan): InitPlacement {
  const init = recipe.init;
  if (init.kind === "bundle") {
    const bundle = catalog.inits.find((spec) => spec.name === init.spec);
    const covers =
      bundle !== undefined &&
      (bundle.initializes.some((entry) => entry.module === facet.name) || (bundle.sequence ?? []).includes(facet.name));
    if (covers) return { kind: "bundle", spec: init.spec, path: "bundle" };
  }
  if (facet.init === undefined) return { kind: "none" };
  if (init.kind === "steps") {
    const recipeIndex = init.steps.findIndex((step) => step.spec === facet.init);
    const view = plan.steps.find((step) => step.path === `steps[${recipeIndex}]`) ?? plan.steps.find((step) => step.spec === facet.init);
    if (recipeIndex >= 0 && view) {
      return {
        kind: "step",
        spec: facet.init,
        path: `steps[${recipeIndex}]`,
        index: view.index,
        count: plan.steps.length,
        recipeIndex,
        recipeSteps: init.steps.length,
        locked: view.locked,
      };
    }
  }
  return { kind: "absent", spec: facet.init };
}

/** "ERC4626Init · Step 3 of 5", "In GovernedVaultInit (bundle)", "ERC4626Init", "none". */
export function initText(placement: InitPlacement): string {
  switch (placement.kind) {
    case "step":
      return `${placement.spec} · Step ${placement.index + 1} of ${placement.count}`;
    case "bundle":
      return `In ${placement.spec} (bundle)`;
    case "absent":
      return placement.spec;
    case "none":
      return "none";
  }
}

/** Drops the backticks a message or tooltip puts around code: "`transfer · 0xa9059cbb`" → "transfer · 0xa9059cbb". */
export function plainCode(text: string): string {
  return text.replaceAll("`", "");
}

/** Problems anchored to any of `facets` (a facet anchor, or a selector anchor naming the facet), each once. */
export function anchoredProblems(problems: readonly Problem[], facets: readonly string[]): Problem[] {
  const names = new Set(facets);
  return problems.filter((problem) =>
    problem.where.some((anchor) => (anchor.kind === "facet" || anchor.kind === "selector") && anchor.facet !== undefined && names.has(anchor.facet)),
  );
}
