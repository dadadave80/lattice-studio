import type { Check, CheckInput } from "../model/analysis";
import type { Facet } from "../model/catalog";
import type { Problem } from "../model/problems";
import { problem, problemId } from "../model/problems";

type Owning = Facet & { storage: NonNullable<Facet["storage"]> };

function placedFacets({ recipe, catalog }: CheckInput): Facet[] {
  const names = new Set(recipe.facets);
  return catalog.facets.filter((f) => names.has(f.name));
}

/**
 * STO-01: placed facets that declare one ERC-7201 id or one slot (R13, spec L65). Facets linked by either
 * share a group; each group of two or more is one problem, named by its first member's id. Only `storage`
 * counts: a shared library's storage sits in `touches` (contracts §4).
 */
function checkClaims(owning: readonly Owning[]): Problem[] {
  // Groups of indexes into `owning`; merging keeps each group sorted, so members stay in catalog order.
  let groups: number[][] = [];
  for (const [i, facet] of owning.entries()) {
    const slot = facet.storage.slot.toLowerCase();
    const claims = (j: number) => {
      const other = owning[j]?.storage;
      return other !== undefined && (other.id === facet.storage.id || other.slot.toLowerCase() === slot);
    };
    const linked = groups.filter((g) => g.some(claims));
    groups = [...groups.filter((g) => !linked.includes(g)), [...linked.flat(), i].sort((a, b) => a - b)];
  }
  return groups
    .filter((g) => g.length > 1)
    .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0))
    .map((g) => {
      const members = g.flatMap((i) => owning[i] ?? []);
      const [first] = members as [Owning, ...Owning[]];
      const facets = members.map((f) => f.name);
      return problem(
        "STO-01",
        facets.map((facet) => ({ kind: "facet", facet })),
        { id: first.storage.id, slot: first.storage.slot, facets },
        facets.map((facet) => ({ id: "facet.remove", args: { facets: [facet] } })),
        { id: problemId("STO-01", first.storage.id) },
      );
    });
}

/**
 * STO-02 (info): a placed facet touches a namespace another placed facet owns ("ERC20Votes shares
 * `lattice.storage.ERC20` with ERC20"). One per facet and shared namespace, in the facet's `touches` order
 * (contracts §4, ruling 2026-09-23).
 */
function checkShared(placed: readonly Facet[], owning: readonly Owning[]): Problem[] {
  const problems: Problem[] = [];
  for (const facet of placed) {
    for (const namespace of facet.touches) {
      const owner = owning.find((f) => f.storage.id === namespace && f.name !== facet.name);
      if (!owner) continue;
      problems.push(
        problem("STO-02", [{ kind: "facet", facet: facet.name }], { facet: facet.name, namespace, owner: owner.name }, [], {
          id: problemId("STO-02", [facet.name, namespace]),
        }),
      );
    }
  }
  return problems;
}

/** STO-01 and STO-02 (spec L326-L327). Owner: WP-C3. */
export const checkSto: Check = (input) => {
  const placed = placedFacets(input);
  const owning = placed.filter((f): f is Owning => f.storage !== undefined);
  return [...checkClaims(owning), ...checkShared(placed, owning)];
};
