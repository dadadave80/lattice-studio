/**
 * The Migrate review (spec L290): what moving a project to another catalog changes, for what the project uses:
 * its facets (selectors added or removed, new code), its init contracts, and the proxy, factory and registry.
 * Pure. With the old catalog it lists every selector added or removed and every codehash that changed; without
 * it (a catalog this build no longer ships) it can only compare the recipe with the target, and says so.
 */
import type { Catalog, Hex, Hex4, Recipe } from "@lattice-studio/core";
import { normalizeRecipe } from "@lattice-studio/core";

export type SelectorChange = { hex: Hex4; signature: string };

export type ContractChange = {
  name: string;
  kind: "facet" | "init" | "shared";
  added: SelectorChange[];
  removed: SelectorChange[];
  /** New code: the runtime codehash (the proxy's init code hash) before and after. */
  code: { from: Hex; to: Hex } | null;
  /** The target catalog has no such contract: a facet leaves the sheet. */
  missing: boolean;
};

export type MigrationReview = {
  fromTag: string;
  toTag: string;
  /** False when the old catalog isn't available: code changes can't be listed. */
  complete: boolean;
  /** Only contracts that change, in recipe order: facets, then inits, then shared contracts. */
  changes: ContractChange[];
  /** The recipe on the target catalog. */
  recipe: Recipe;
  /** What the migrated recipe drops: facets the target lacks, routings and exclusions of selectors gone. */
  dropped: { facets: string[]; owners: Hex4[]; exclude: Hex4[] };
};

type Code = { name: string; kind: ContractChange["kind"]; hash: Hex; selectors?: SelectorChange[] };

function facetCode(catalog: Catalog, name: string): Code | undefined {
  const facet = catalog.facets.find((f) => f.name === name);
  return facet && { name, kind: "facet", hash: facet.release.codehash, selectors: facet.selectors };
}

function initNames(recipe: Recipe): string[] {
  const { init } = recipe;
  if (init.kind === "bundle") return [init.spec];
  if (init.kind === "steps") return [...new Set(init.steps.map((s) => s.spec))];
  return [];
}

function initCode(catalog: Catalog, spec: string): Code | undefined {
  const init = catalog.inits.find((i) => i.name === spec);
  return init?.release && { name: init.contract, kind: "init", hash: init.release.codehash };
}

function sharedCode(catalog: Catalog): Code[] {
  return [
    { name: "Lattice", kind: "shared", hash: catalog.proxy.initCodeHash },
    { name: "LatticeFactory", kind: "shared", hash: catalog.factory.codehash },
    { name: "LatticeRegistry", kind: "shared", hash: catalog.registry.codehash },
  ];
}

function same(a: Hex, b: Hex): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function compare(before: Code | undefined, after: Code | undefined, name: string, kind: ContractChange["kind"]): ContractChange {
  if (!after) return { name, kind, added: [], removed: before?.selectors ?? [], code: null, missing: true };
  if (!before) return { name, kind, added: [], removed: [], code: null, missing: false };
  const had = new Set((before.selectors ?? []).map((s) => s.hex.toLowerCase()));
  const has = new Set((after.selectors ?? []).map((s) => s.hex.toLowerCase()));
  return {
    name,
    kind,
    added: (after.selectors ?? []).filter((s) => !had.has(s.hex.toLowerCase())),
    removed: (before.selectors ?? []).filter((s) => !has.has(s.hex.toLowerCase())),
    code: same(before.hash, after.hash) ? null : { from: before.hash, to: after.hash },
    missing: false,
  };
}

function changed(c: ContractChange): boolean {
  return c.missing || c.added.length > 0 || c.removed.length > 0 || c.code !== null;
}

/** The recipe on `to`: its catalog pin, and what no longer exists there left out. */
function migrateRecipe(recipe: Recipe, to: Catalog): { recipe: Recipe; dropped: MigrationReview["dropped"] } {
  const facets = recipe.facets.filter((name) => to.facets.some((f) => f.name === name));
  const exports = new Map(facets.map((name) => [name, new Set(facetCode(to, name)?.selectors?.map((s) => s.hex.toLowerCase()))]));
  const served = (hex: string) => [...exports.values()].some((set) => set.has(hex.toLowerCase()));
  const owners: Record<Hex4, string> = {};
  const droppedOwners: Hex4[] = [];
  for (const [hex, owner] of Object.entries(recipe.owners) as [Hex4, string][]) {
    if (exports.get(owner)?.has(hex.toLowerCase())) owners[hex] = owner;
    else droppedOwners.push(hex);
  }
  const exclude = recipe.exclude.filter((hex) => served(hex));
  const next: Recipe = { ...recipe, catalog: { tag: to.lattice.tag, hash: to.hash }, facets, owners, exclude };
  return {
    recipe: normalizeRecipe(next, to),
    dropped: {
      facets: recipe.facets.filter((name) => !facets.includes(name)),
      owners: droppedOwners,
      exclude: recipe.exclude.filter((hex) => !served(hex)),
    },
  };
}

/** Everything a person reviews before Migrate to `to`; `from` is null when this build no longer has it. */
export function reviewMigration(recipe: Recipe, from: Catalog | null, to: Catalog): MigrationReview {
  const migrated = migrateRecipe(recipe, to);
  const changes: ContractChange[] = [];
  if (from) {
    for (const name of recipe.facets) changes.push(compare(facetCode(from, name), facetCode(to, name), name, "facet"));
    for (const spec of initNames(recipe)) {
      const before = initCode(from, spec);
      const after = initCode(to, spec);
      changes.push(compare(before, after, after?.name ?? before?.name ?? spec, "init"));
    }
    const after = sharedCode(to);
    for (const before of sharedCode(from)) changes.push(compare(before, after.find((c) => c.name === before.name), before.name, "shared"));
  } else {
    // Without the old catalog: the facets the target lacks, and the routings whose selector their owner lost.
    for (const name of recipe.facets) {
      const after = facetCode(to, name);
      const lost = migrated.dropped.owners.filter((hex) => recipe.owners[hex] === name);
      changes.push({
        name,
        kind: "facet",
        added: [],
        removed: lost.map((hex) => ({ hex, signature: "" })),
        code: null,
        missing: after === undefined,
      });
    }
  }
  const fromTag = recipe.catalog.tag;
  return {
    fromTag,
    toTag: to.lattice.tag,
    complete: from !== null,
    changes: dedupe(changes.filter(changed)),
    recipe: migrated.recipe,
    dropped: migrated.dropped,
  };
}

/** Two init specs of one contract (DiamondIntrospectionInit) are one contract. */
function dedupe(changes: ContractChange[]): ContractChange[] {
  const seen = new Set<string>();
  return changes.filter((c) => {
    const key = `${c.kind}:${c.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Totals for the summary. */
export function reviewCounts(review: MigrationReview): { added: number; removed: number; code: number; missing: number } {
  let added = 0;
  let removed = 0;
  let code = 0;
  let missing = 0;
  for (const c of review.changes) {
    added += c.added.length;
    removed += c.removed.length;
    if (c.code) code += 1;
    if (c.missing) missing += 1;
  }
  return { added, removed, code, missing };
}
