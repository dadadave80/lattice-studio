import { describe, expect, test } from "bun:test";
import { encodeFunctionData, parseAbi } from "viem";
import type { Analysis } from "../model/analysis";
import type { Address, Hex } from "../model/hex";
import type { UpgradeOrigin } from "../model/project";
import type { Recipe } from "../model/recipe";
import { makeCatalog, makeFacet, makeInit } from "../testing/builders";
import { analyzeUpgrade, planUpgrade } from "./analyze";
import { reconstructUpgrade } from "./reconstruct";

const a: Address = "0x0000000000000000000000000000000000000011";
const b: Address = "0x0000000000000000000000000000000000000022";
const diamond: Address = "0x0000000000000000000000000000000000000033";
const hash: Hex = `0x${"ab".repeat(32)}`;
const id = (address: Address) => `onchain:${address}`;
const known = makeFacet({ name: "Known", selectors: ["one()"], init: "KnownInit" });
const selector = known.selectors[0]!.hex;
const origin: UpgradeOrigin = { chainId: 1, address: diamond, owner: null, block: 1, blockHash: hash,
  facets: [{ facetAddress: a, functionSelectors: [selector] }], codehashes: { [a]: known.release.codehash, [diamond]: hash } };
const catalog = makeCatalog({ facets: [known], inits: [makeInit({ name: "KnownInit", initializes: [{ module: "Known" }] })] });
const recipe = (): Recipe => {
  const reconstructed = reconstructUpgrade(origin, catalog);
  if (!reconstructed.ok) throw new Error(reconstructed.error);
  return reconstructed.value;
};
const unwrap = (result: ReturnType<typeof analyzeUpgrade>): Analysis => {
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

describe("upgrade-aware analysis", () => {
  test("baseline presence/init omissions are information and no-op has zero cuts and no init replay", () => {
    const plan = planUpgrade(recipe(), catalog, origin);
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.value.cuts).toEqual([]);
    expect(plan.value.expectedCodehashes[diamond]).toBe(hash);
    expect(plan.value.analysis.init).toBeNull();
    expect(plan.value.analysis.problems.filter((problem) => problem.code.startsWith("CORE-") || problem.code === "INIT-04").every((problem) => problem.severity === "info")).toBe(true);
  });

  test("imported explicit owners win ahead of active seams and the deviation stays visible", () => {
    const other = makeFacet({ name: "Other", selectors: ["one()"] });
    const cat = { ...catalog, facets: [...catalog.facets, other], seams: [{ selector, when: ["Known"], anyOf: ["Other"], reason: "updates checkpoints" }] };
    const input = { ...recipe(), facets: [...recipe().facets, "Other"] };
    const analysis = unwrap(analyzeUpgrade(input, cat, origin));
    expect(analysis.routing[selector]?.owner).toBe(id(a));
    expect(analysis.problems.some((problem) => problem.code === "SEM-01" && problem.severity === "blocker")).toBe(true);
  });

  test("actual known aliases satisfy dependencies while repeated storage claims stay distinct", () => {
    const storage = { id: "test.Known", slot: hash };
    const first = { ...known, storage };
    const second = makeFacet({ name: "NeedsKnown", selectors: ["two()"], requires: [{ anyOf: ["Known"], strength: "hard", reason: "uses its state" }], storage });
    const cat = { ...catalog, facets: [first, second] };
    const input = { ...recipe(), facets: [...recipe().facets, second.name] };
    const analysis = unwrap(analyzeUpgrade(input, cat, origin));
    expect(analysis.problems.some((problem) => problem.code === "DEP-01")).toBe(false);
    expect(analysis.problems.some((problem) => problem.code === "STO-01" && problem.severity === "blocker")).toBe(true);
    const duplicate = { ...origin, facets: [...origin.facets, { facetAddress: b, functionSelectors: ["0x12345678" as Hex] }], codehashes: { ...origin.codehashes, [b]: known.release.codehash } };
    const rebuilt = reconstructUpgrade(duplicate, cat);
    if (!rebuilt.ok) throw new Error(rebuilt.error);
    expect(unwrap(analyzeUpgrade(rebuilt.value, cat, duplicate)).problems.some((problem) => problem.code === "STO-01")).toBe(true);
  });

  test("requested new init retains typed arguments, link and init coverage checks without automatic introspection", () => {
    const init = makeInit({ name: "NewInit", params: [{ name: "admin", type: "address", authority: true }], initializes: [{ module: "New" }] });
    const added = makeFacet({ name: "New", selectors: ["newFunction()"], init: init.name });
    const cat = { ...catalog, facets: [...catalog.facets, added], inits: [...catalog.inits, init] };
    const input: Recipe = { ...recipe(), facets: [...recipe().facets, added.name], init: { kind: "steps", steps: [{ spec: init.name, args: { admin: "bad" } }] } };
    const invalid = unwrap(analyzeUpgrade(input, cat, origin));
    expect(invalid.problems.some((problem) => problem.code === "INIT-01" && problem.severity === "blocker")).toBe(true);
    const linked: Recipe = { ...input, init: { kind: "steps", steps: [{ spec: init.name, args: { admin: a } }] } };
    const result = unwrap(analyzeUpgrade(linked, cat, origin, { known: [], unconfirmed: ["steps[0].admin"] }));
    expect(result.problems.some((problem) => problem.code === "LINK-01")).toBe(true);
    expect(result.init?.target).toBe(init.release?.address);
    const missing = unwrap(analyzeUpgrade({ ...input, init: { kind: "none" } }, cat, origin));
    expect(missing.problems.some((problem) => problem.code === "INIT-04" && problem.severity === "blocker" && problem.params.facet === added.name)).toBe(true);
  });

  test("existing raw exportSelectors is preserved without a fresh-helper blocker or edit fix", () => {
    const facts = { ...origin, facets: [{ facetAddress: diamond, functionSelectors: ["0x0ef22643" as Hex] }], codehashes: { [diamond]: hash } };
    const rebuilt = reconstructUpgrade(facts, catalog);
    if (!rebuilt.ok) throw new Error(rebuilt.error);
    const analysis = unwrap(analyzeUpgrade(rebuilt.value, catalog, facts));
    const helper = analysis.problems.find((problem) => problem.code === "SEL-04");
    expect(helper?.severity).toBe("info");
    expect(helper?.fixes).toEqual([]);
    expect(planUpgrade(rebuilt.value, catalog, facts).ok).toBe(true);
  });

  test("forged or partially changed raw instances fail without returning a partial plan", () => {
    const facts = { ...origin, facets: [{ facetAddress: a, functionSelectors: ["0x12345678" as Hex, "0x87654321" as Hex] }], codehashes: { [a]: hash, [diamond]: hash } };
    const rebuilt = reconstructUpgrade(facts, catalog);
    if (!rebuilt.ok) throw new Error(rebuilt.error);
    expect(analyzeUpgrade({ ...rebuilt.value, exclude: ["0x12345678"] }, catalog, facts).ok).toBe(false);
    expect(analyzeUpgrade(recipe(), catalog, { ...origin, codehashes: {} }).ok).toBe(false);
  });

  test("a newly missing baseline loupe selector remains a blocker", () => {
    const loupe = makeFacet({ name: "DiamondLoupeFacet", selectors: ["facets()", "facetFunctionSelectors(address)", "facetAddresses()", "facetAddress(bytes4)"] });
    const cat = { ...catalog, facets: [loupe] };
    const facts = { ...origin, facets: [{ facetAddress: a, functionSelectors: loupe.selectors.map((selector) => selector.hex) }], codehashes: { [a]: loupe.release.codehash, [diamond]: hash } };
    const baseline = reconstructUpgrade(facts, cat);
    if (!baseline.ok) throw new Error(baseline.error);
    const changed = { ...baseline.value, exclude: [loupe.selectors[0]!.hex] };
    expect(unwrap(analyzeUpgrade(changed, cat, facts)).problems.find((problem) => problem.code === "CORE-01")?.severity).toBe("blocker");
  });

  test("self references in explicit cut init always resolve to the pinned diamond", () => {
    const init = makeInit({ name: "OwnerInit", fn: "init(address)", params: [{ name: "admin", type: "address", authority: true }] });
    const cat = { ...catalog, inits: [...catalog.inits, init] };
    const input: Recipe = { ...recipe(), init: { kind: "steps", steps: [{ spec: init.name, args: { admin: { $ref: "self" } } }] } };
    const result = unwrap(analyzeUpgrade(input, cat, origin, { known: [], unconfirmed: [], refs: { self: b }, deploy: { chainId: 1, path: "factory" } }));
    expect(result.init?.data).toBe(encodeFunctionData({ abi: parseAbi(["function init(address)"]), functionName: "init", args: [diamond] }));
  });

  test("raw extra descriptors cannot be extended and existing addresses cannot claim a new runtime", () => {
    const facts = { ...origin, facets: [{ facetAddress: a, functionSelectors: [selector, "0x12345678" as Hex] }] };
    const baseline = reconstructUpgrade(facts, catalog);
    if (!baseline.ok) throw new Error(baseline.error);
    const previous = baseline.value.facetInstances![id(a)]!;
    if (previous.kind !== "known") throw new Error("fixture");
    expect(analyzeUpgrade({ ...baseline.value, facetInstances: { [id(a)]: { ...previous, extraSelectors: [...previous.extraSelectors, "0x87654321"] } } }, catalog, facts).ok).toBe(false);
    const replacement = makeFacet({ name: "Replacement", selectors: ["newCode()"], release: { ...known.release, address: a, codehash: hash } });
    const cat = { ...catalog, facets: [...catalog.facets, replacement] };
    const input: Recipe = { ...baseline.value, facets: [replacement.name], facetInstances: {}, owners: {} };
    expect(analyzeUpgrade(input, cat, facts).ok).toBe(false);
  });
});
