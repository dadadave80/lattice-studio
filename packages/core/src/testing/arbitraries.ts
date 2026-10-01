/**
 * fast-check arbitraries for recipes, projects and deployment records over a catalog (the fixture catalog in
 * tests, and the real one when it's built). Everything they generate is in-catalog and well-typed, so parsing
 * accepts it; the hostile parts are the text (names and `string` arguments) and the presentation (facet order,
 * key order, hex case), which must never matter.
 */
import fc from "fast-check";
import type { Catalog, InitParam, InitSpec } from "../model/catalog";
import { CORE_FACETS } from "../model/diamond";
import { toChecksum, type Address, type Hex, type Hex4 } from "../model/hex";
import type { Layout } from "../model/layout";
import type { Deployment, Project } from "../model/project";
import type { Arg, InitStep, Recipe } from "../model/recipe";
import { hostileWellFormedString } from "./hostile";

/** `exportSelectors()`: never cut, never a contender (R3). */
const EXPORT_SELECTORS = "0x0ef22643";

const ARRAY_SUFFIX = /\[([0-9]*)\]$/;
const INTEGER_TYPE = /^(u?)int([0-9]*)$/;
const FIXED_BYTES = /^bytes([0-9]+)$/;

/** What the recipe arbitraries generate text with, and how big they get. */
export type RecipeArbOptions = {
  /** The recipe's display name; absent names are generated too. Default: hostile, well-formed text. */
  names?: fc.Arbitrary<string>;
  /** `string` init arguments. Default: hostile, well-formed text. */
  strings?: fc.Arbitrary<string>;
  /** Most facets a random (non-template) sheet places. Default 12. */
  maxFacets?: number;
};

function hexOf(bytes: readonly number[]): Hex {
  return `0x${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** `n` random bytes as lowercase hex. */
export function hexBytes(n: number): fc.Arbitrary<Hex> {
  return fc.array(fc.integer({ min: 0, max: 255 }), { minLength: n, maxLength: n }).map(hexOf);
}

/** A nonzero EIP-55 address. */
export function address(): fc.Arbitrary<Address> {
  return hexBytes(20)
    .filter((hex) => /[1-9a-f]/.test(hex.slice(2)))
    .map((hex) => toChecksum(hex));
}

/** An address as a person might paste it: checksummed, all lowercase or all uppercase. */
function addressAsWritten(): fc.Arbitrary<string> {
  return fc.tuple(address(), fc.constantFrom("checksum", "lower", "upper")).map(([a, how]) =>
    how === "checksum" ? a : how === "lower" ? a.toLowerCase() : `0x${a.slice(2).toUpperCase()}`,
  );
}

/** A value for one init parameter, by its ABI type; `string` parameters take `strings`. */
export function argFor(param: Pick<InitParam, "type" | "components">, strings: fc.Arbitrary<string>): fc.Arbitrary<Arg> {
  const array = ARRAY_SUFFIX.exec(param.type);
  if (array !== null) {
    const element: Pick<InitParam, "type" | "components"> = { type: param.type.replace(ARRAY_SUFFIX, "") };
    if (param.components !== undefined) element.components = param.components;
    const fixed = array[1] === "" ? undefined : Number(array[1]);
    const length = fixed === undefined ? { minLength: 0, maxLength: 3 } : { minLength: fixed, maxLength: fixed };
    return fc.array(argFor(element, strings), length);
  }
  if (param.type === "tuple") {
    const components = param.components ?? [];
    const fields: Record<string, fc.Arbitrary<Arg>> = {};
    for (const component of components) fields[component.name] = argFor(component, strings);
    return fc.record(fields) as fc.Arbitrary<Arg>;
  }
  if (param.type === "address") {
    return fc.oneof(
      { weight: 3, arbitrary: addressAsWritten() },
      { weight: 1, arbitrary: fc.constantFrom<Arg>({ $ref: "self" }, { $ref: "deployer" }) },
    );
  }
  if (param.type === "bool") return fc.boolean();
  if (param.type === "string") return strings;
  const integer = INTEGER_TYPE.exec(param.type);
  if (integer !== null) {
    const bits = BigInt(integer[2] === "" ? 256 : Number(integer[2]));
    const signed = integer[1] === "";
    const min = signed ? -(2n ** (bits - 1n)) : 0n;
    const max = signed ? 2n ** (bits - 1n) - 1n : 2n ** bits - 1n;
    return fc.tuple(fc.bigInt({ min, max }), fc.constantFrom("", "0", "00")).map(([n, pad]) =>
      n < 0n ? n.toString() : `${pad}${n.toString()}`,
    );
  }
  const fixedBytes = FIXED_BYTES.exec(param.type);
  if (fixedBytes !== null) return hexBytes(Number(fixedBytes[1]));
  if (param.type === "bytes") return fc.integer({ min: 0, max: 8 }).chain(hexBytes);
  return strings;
}

/** Arguments for `spec`: every parameter, or (when `partial`) some left out for INIT-01 to find. */
function argsFor(spec: InitSpec, strings: fc.Arbitrary<string>, partial: boolean): fc.Arbitrary<Record<string, Arg>> {
  const fields: Record<string, fc.Arbitrary<Arg>> = {};
  for (const param of spec.params) fields[param.name] = argFor(param, strings);
  return (partial ? fc.record(fields, { requiredKeys: [] }) : fc.record(fields)) as fc.Arbitrary<Record<string, Arg>>;
}

/** Inits a recipe can name: released (not deployed per use) and not MultiInit itself, which Studio adds. */
export function usableInits(catalog: Catalog): InitSpec[] {
  return catalog.inits.filter((init) => init.release !== undefined && init.ctorArgs === undefined && init.contract !== "MultiInit");
}

/** An init: none, a bundle, or up to three steps, with generated arguments. */
export function initArb(catalog: Catalog, strings: fc.Arbitrary<string>): fc.Arbitrary<Recipe["init"]> {
  const inits = usableInits(catalog);
  const steps = inits.filter((init) => init.kind === "step");
  const bundles = inits.filter((init) => init.kind === "bundle");
  const options: fc.Arbitrary<Recipe["init"]>[] = [fc.constant({ kind: "none" as const })];
  if (steps.length > 0) {
    const step = fc
      .constantFrom(...steps)
      .chain((spec) => fc.tuple(fc.constant(spec.name), argsFor(spec, strings, true)))
      .map(([spec, args]): InitStep => ({ spec, args }));
    options.push(fc.array(step, { minLength: 1, maxLength: 3 }).map((list) => ({ kind: "steps" as const, steps: list })));
  }
  if (bundles.length > 0) {
    options.push(
      fc
        .constantFrom(...bundles)
        .chain((spec) => argsFor(spec, strings, true).map((args) => ({ kind: "bundle" as const, spec: spec.name, args }))),
    );
  }
  return fc.oneof(...options);
}

/** Every selector a placed facet exports (never 0x0ef22643) → its contenders, in catalog order. */
export function contendersOf(catalog: Catalog, facets: readonly string[]): Map<Hex4, string[]> {
  const placed = new Set(facets);
  const out = new Map<Hex4, string[]>();
  for (const facet of catalog.facets) {
    if (!placed.has(facet.name)) continue;
    for (const { hex } of facet.selectors) {
      const selector = hex.toLowerCase() as Hex4;
      if (selector === EXPORT_SELECTORS) continue;
      const list = out.get(selector) ?? [];
      if (!list.includes(facet.name)) list.push(facet.name);
      out.set(selector, list);
    }
  }
  return out;
}

/** The core's facets the catalog has: every generated recipe carries them, as every parsed one does. */
function coreOf(catalog: Catalog): string[] {
  const names = new Set(catalog.facets.map((facet) => facet.name));
  return CORE_FACETS.filter((name) => names.has(name));
}

/**
 * A sheet's facets in the order someone placed them: a random pick, or a template's with a few changes. The
 * core's facets are always among them (the recipe repair puts them back on every parse), somewhere in the list.
 */
export function facetsArb(catalog: Catalog, maxFacets = 12): fc.Arbitrary<string[]> {
  const core = coreOf(catalog);
  const names = catalog.facets.map((facet) => facet.name).filter((name) => !core.includes(name));
  const shuffled = (list: readonly string[]): fc.Arbitrary<string[]> =>
    fc.shuffledSubarray([...list], { minLength: list.length, maxLength: list.length });
  const withCore = (cards: fc.Arbitrary<string[]>): fc.Arbitrary<string[]> => cards.chain((list) => shuffled([...new Set([...list, ...core])]));
  const random = withCore(fc.shuffledSubarray(names, { minLength: 0, maxLength: Math.min(maxFacets, names.length) }));
  const templates = catalog.recipes.map((template) => template.recipe.facets.filter((name) => names.includes(name)));
  if (templates.length === 0) return random;
  const fromTemplate = fc.constantFrom(...templates).chain((base) =>
    withCore(
      fc
        .tuple(
          fc.subarray(base, { minLength: Math.max(0, base.length - 2) }),
          fc.shuffledSubarray(names, { maxLength: Math.min(3, names.length) }),
        )
        .map(([kept, extra]) => [...new Set([...kept, ...extra])]),
    ),
  );
  return fc.oneof(random, fromTemplate);
}

/**
 * Owners for some contested selectors (two or more placed contenders), each a placed contender, and a few
 * exclusions from the placed facets' selectors. Keys lowercase.
 */
export function routingArb(catalog: Catalog, facets: readonly string[]): fc.Arbitrary<Pick<Recipe, "owners" | "exclude">> {
  const contenders = contendersOf(catalog, facets);
  const contested = [...contenders].filter(([, list]) => list.length >= 2);
  const owners = fc
    .subarray(contested)
    .chain((picked) => fc.tuple(...picked.map(([selector, list]) => fc.constantFrom(...list).map((owner) => [selector, owner] as const))))
    .map((pairs) => Object.fromEntries(pairs) as Record<Hex4, string>);
  const exclude = fc.subarray([...contenders.keys()], { maxLength: Math.min(3, contenders.size) });
  return fc.record({ owners, exclude });
}

/** A recipe over `catalog`: placed facets in placement order, owners, exclusions, init, name, immutable. */
export function recipeArb(catalog: Catalog, options: RecipeArbOptions = {}): fc.Arbitrary<Recipe> {
  const strings = options.strings ?? hostileWellFormedString();
  const names = options.names ?? hostileWellFormedString();
  return facetsArb(catalog, options.maxFacets).chain((facets) =>
    fc
      .record(
        {
          routing: routingArb(catalog, facets),
          init: initArb(catalog, strings),
          name: names,
          immutable: fc.constant(true as const),
        },
        { requiredKeys: ["routing", "init"] },
      )
      .map(({ routing, init, name, immutable }): Recipe => {
        const recipe: Recipe = {
          schemaVersion: 1,
          catalog: { tag: catalog.lattice.tag, hash: catalog.hash },
          facets,
          owners: routing.owners,
          exclude: routing.exclude,
          init,
        };
        if (name !== undefined) recipe.name = name;
        if (immutable !== undefined) recipe.immutable = immutable;
        return recipe;
      }),
  );
}

/** A layout for `facets`: integer positions, either pin side, some cards expanded. */
export function layoutArb(facets: readonly string[]): fc.Arbitrary<Layout> {
  const card = fc
    .record(
      {
        x: fc.integer({ min: -4000, max: 4000 }),
        y: fc.integer({ min: -4000, max: 4000 }),
        pins: fc.constantFrom("left" as const, "right" as const),
        expanded: fc.constant(true as const),
      },
      { requiredKeys: ["x", "y", "pins"] },
    )
    .map((entry): Layout[string] => {
      const out: Layout[string] = { x: entry.x, y: entry.y, pins: entry.pins };
      if (entry.expanded !== undefined) out.expanded = entry.expanded;
      return out;
    });
  return fc.tuple(...facets.map(() => card)).map((cards) => Object.fromEntries(facets.map((name, i) => [name, cards[i]])) as Layout);
}

/**
 * A project around a generated recipe: hostile name, a layout entry for every card (never for the core, which
 * isn't on the sheet), deploy settings, predictions.
 */
export function projectArb(catalog: Catalog, options: RecipeArbOptions = {}): fc.Arbitrary<Project> {
  const names = options.names ?? hostileWellFormedString();
  const core: readonly string[] = CORE_FACETS;
  return recipeArb(catalog, options).chain((recipe) =>
    fc
      .record({
        id: fc.uuid(),
        name: names,
        layout: layoutArb([...new Set(recipe.facets)].filter((name) => !core.includes(name))),
        path: fc.constantFrom("factory" as const, "createx" as const),
        entropy: hexBytes(11),
        scope: fc.constantFrom("every-chain" as const, "this-chain" as const),
        predicted: fc.array(fc.record({ chainId: fc.integer({ min: 1, max: 2 ** 31 - 1 }), address: address() }), { maxLength: 3 }),
      })
      .map(
        (p): Project => ({
          id: p.id,
          name: p.name,
          recipe,
          layout: p.layout,
          deploy: { path: p.path, entropy: p.entropy, scope: p.scope },
          provenance: {},
          predicted: p.predicted,
        }),
      ),
  );
}

/** A deployment record for `projectId`: every field well-formed; timestamps come from the generator, not a clock. */
export function deploymentArb(projectId: string): fc.Arbitrary<Deployment> {
  return fc
    .record(
      {
        chainId: fc.integer({ min: 1, max: 2 ** 31 - 1 }),
        address: address(),
        path: fc.constantFrom("factory" as const, "createx" as const),
        deployer: address(),
        salt: hexBytes(32),
        status: fc.constantFrom("pending" as const, "proposed" as const, "confirmed" as const, "mismatch" as const, "failed" as const),
        tx: hexBytes(32),
        block: fc.integer({ min: 0, max: 2 ** 40 }),
        recipeHash: hexBytes(32),
        catalogHash: hexBytes(32),
        at: fc.integer({ min: 1_600_000_000_000, max: 2_000_000_000_000 }).map((ms) => new Date(ms).toISOString()),
        verification: fc.constantFrom("pending" as const, "match" as const, "exact_match" as const, "failed" as const),
        revision: fc.integer({ min: 1, max: 9 }),
      },
      { requiredKeys: ["chainId", "address", "path", "deployer", "salt", "status", "recipeHash", "catalogHash", "at", "verification", "revision"] },
    )
    .map((d): Deployment => {
      const record: Deployment = {
        projectId,
        chainId: d.chainId,
        address: d.address,
        path: d.path,
        deployer: d.deployer,
        salt: d.salt,
        status: d.status,
        recipeHash: d.recipeHash,
        catalogHash: d.catalogHash,
        at: d.at,
        verification: d.verification,
        revision: d.revision,
      };
      if (d.tx !== undefined) record.tx = d.tx;
      if (d.block !== undefined) record.block = d.block;
      return record;
    });
}

/** A permutation of `items`. */
export function permutation<T>(items: readonly T[]): fc.Arbitrary<T[]> {
  return fc.shuffledSubarray([...items], { minLength: items.length, maxLength: items.length });
}

/**
 * The same recipe as someone else might have written it: facets in another order (some twice), owners' keys in
 * another order and hex case, exclusions shuffled and re-cased. Never reorders init steps, which is meaningful.
 */
export function presentationArb(recipe: Recipe): fc.Arbitrary<Recipe> {
  const ownerKeys = Object.keys(recipe.owners) as Hex4[];
  return fc
    .record({
      facets: permutation(recipe.facets),
      twice: fc.subarray(recipe.facets, { maxLength: Math.min(2, recipe.facets.length) }),
      ownerOrder: permutation(ownerKeys),
      exclude: permutation(recipe.exclude),
      upper: fc.boolean(),
    })
    .map(({ facets, twice, ownerOrder, exclude, upper }): Recipe => {
      const recase = (hex: Hex4): Hex4 => (upper ? (`0x${hex.slice(2).toUpperCase()}` as Hex4) : hex);
      const owners: Record<Hex4, string> = {};
      for (const key of ownerOrder) owners[recase(key)] = recipe.owners[key] ?? "";
      return { ...recipe, facets: [...facets, ...twice], owners, exclude: exclude.map(recase) };
    });
}
