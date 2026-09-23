import type { Check, CheckInput } from "../model/analysis";
import type { Facet } from "../model/catalog";
import type { Hex4 } from "../model/hex";
import type { Problem } from "../model/problems";
import { problem, problemId } from "../model/problems";

/** The four loupe selectors, in R2's order (spec L54): the first missing one names CORE-01. */
export const LOUPE_SELECTORS: readonly { hex: Hex4; signature: string }[] = [
  { hex: "0x7a0ed627", signature: "facets()" },
  { hex: "0xadfca15e", signature: "facetFunctionSelectors(address)" },
  { hex: "0x52ef6b2c", signature: "facetAddresses()" },
  { hex: "0xcdffacc6", signature: "facetAddress(bytes4)" },
];

/** Receive's selector (R12, spec L64). */
export const RECEIVE_SELECTOR: Hex4 = "0x00000000";
/** `supportsInterface(bytes4)`, the IERC165 id. */
export const SUPPORTS_INTERFACE_SELECTOR: Hex4 = "0x01ffc9a7";

/**
 * Who holds each upgrade mechanism and what guards it, from the mechanisms' NatSpec at the pin
 * (`src/governance/*DiamondCut.sol`, diamond-lib's `DiamondCutFacet`). `rank` orders them from least to most
 * guarded, so CORE-03 names the weaker one as the way around the stronger one's guard.
 */
const MECHANISMS: Readonly<Record<string, { rank: number; authority: string; guard: string }>> = {
  DiamondCutFacet: { rank: 0, authority: "the owner", guard: "owner check" },
  AccessControlDiamondCut: { rank: 1, authority: "the admin", guard: "admin role" },
  SafeDiamondCut: { rank: 2, authority: "the Safe", guard: "multisig" },
  GovernedDiamondCut: { rank: 3, authority: "the upgrade executor", guard: "upgrade executor role" },
  GovernedSafeDiamondCut: { rank: 4, authority: "the Safe", guard: "delay" },
};

/**
 * CORE-03's consequence clause (spec L319): "AccessControlDiamondCut would let the admin skip
 * GovernedSafeDiamondCut's delay". `a` and `b` are in catalog order.
 */
export function upgradeConflictReason(a: string, b: string): string {
  const ma = MECHANISMS[a];
  const mb = MECHANISMS[b];
  if (!ma || !mb) return `${a} and ${b} could each upgrade it without the other`;
  const [weak, strong] = ma.rank <= mb.rank ? [a, b] : [b, a];
  const weakInfo = weak === a ? ma : mb;
  const strongInfo = weak === a ? mb : ma;
  return `${weak} would let ${weakInfo.authority} skip ${strong}'s ${strongInfo.guard}`;
}

/** Placed facets, in catalog order. */
function placedFacets({ recipe, catalog }: CheckInput): Facet[] {
  const names = new Set(recipe.facets);
  return catalog.facets.filter((f) => names.has(f.name));
}

/**
 * A selector is served when it isn't excluded and some placed facet exports it. A contested selector with no
 * owner yet is SEL-01's problem, not a missing one.
 */
function served({ recipe, routing }: CheckInput, selector: Hex4): boolean {
  if (recipe.exclude.includes(selector)) return false;
  const route = routing[selector];
  return route !== undefined && (route.owner !== undefined || route.contenders.length > 0);
}

/** The catalog facet to offer for `selector`: `preferred` when it exports it, else the first that does. */
function providerOf(input: CheckInput, selector: Hex4, preferred: string): string {
  const facets = input.catalog.facets;
  const exports = (f: Facet) => f.selectors.some((s) => s.hex === selector);
  const named = facets.find((f) => f.name === preferred);
  if (named && exports(named)) return preferred;
  return facets.find(exports)?.name ?? preferred;
}

function checkLoupe(input: CheckInput, placed: readonly Facet[]): Problem[] {
  const missing = LOUPE_SELECTORS.filter((s) => !served(input, s.hex));
  const first = missing[0];
  if (!first) return [];
  const signature =
    input.catalog.facets.flatMap((f) => f.selectors).find((s) => s.hex === first.hex)?.signature ?? first.signature;
  const missingHex = missing.map((s) => s.hex);
  // Placed but excluded: including the selector again is the fix, and the note sits on that facet's row.
  const exporter = placed.find((f) => f.selectors.some((s) => s.hex === first.hex));
  if (exporter && input.recipe.exclude.includes(first.hex)) {
    return [
      problem(
        "CORE-01",
        [{ kind: "selector", selector: first.hex, facet: exporter.name }],
        { selector: first.hex, signature, missing: missingHex, facet: exporter.name, excluded: true },
        [{ id: "selector.include", args: { selector: first.hex } }],
      ),
    ];
  }
  const facet = providerOf(input, first.hex, "DiamondLoupeFacet");
  return [
    problem(
      "CORE-01",
      [{ kind: "selector", selector: first.hex }],
      { selector: first.hex, signature, missing: missingHex, facet, excluded: false },
      [{ id: "facet.place", args: { facet } }],
    ),
  ];
}

function checkMechanisms(input: CheckInput, placed: readonly Facet[]): Problem[] {
  const members = placed.filter((f) => f.family === "upgrade").map((f) => f.name);
  if (members.length === 0) {
    if (input.recipe.immutable === true) return [];
    return [
      problem("CORE-02", [{ kind: "diamond" }], {}, [
        { id: "authority.chooseMechanism", args: {} },
        { id: "recipe.keepImmutable" },
      ]),
    ];
  }
  const problems: Problem[] = [];
  for (const [i, a] of members.entries()) {
    for (const b of members.slice(i + 1)) {
      problems.push(
        problem(
          "CORE-03",
          [
            { kind: "facet", facet: a },
            { kind: "facet", facet: b },
          ],
          { facets: [a, b], reason: upgradeConflictReason(a, b) },
          [
            { id: "facet.remove", args: { facets: [a] } },
            { id: "facet.remove", args: { facets: [b] } },
          ],
          { id: problemId("CORE-03", [a, b]) },
        ),
      );
    }
  }
  return problems;
}

/**
 * CORE-04 and CORE-05: `selector` isn't served. Place the facet that provides it; when it's placed but the
 * selector is excluded, placing does nothing, so no fix is offered (SEL-03 already offers to remove it).
 */
function checkPresence(
  input: CheckInput,
  placed: readonly Facet[],
  code: "CORE-04" | "CORE-05",
  selector: Hex4,
  preferred: string,
): Problem[] {
  if (served(input, selector)) return [];
  const facet = providerOf(input, selector, preferred);
  const isPlaced = placed.some((f) => f.name === facet);
  return [problem(code, [{ kind: "diamond" }], { facet }, isPlaced ? [] : [{ id: "facet.place", args: { facet } }])];
}

/**
 * CORE-01 to CORE-05 (spec L318-L322). Owner: WP-C3.
 * CORE-05 checks only that `supportsInterface` routes: no Lattice init registers IERC165's own id at the pin.
 */
export const checkCore: Check = (input) => {
  const placed = placedFacets(input);
  return [
    ...checkLoupe(input, placed),
    ...checkMechanisms(input, placed),
    ...checkPresence(input, placed, "CORE-04", RECEIVE_SELECTOR, "Receive"),
    ...checkPresence(input, placed, "CORE-05", SUPPORTS_INTERFACE_SELECTOR, "ERC165Facet"),
  ];
};
