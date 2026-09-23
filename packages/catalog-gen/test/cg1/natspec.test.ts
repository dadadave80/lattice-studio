import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type Artifact, checkSelectors, findArtifact, type SolcMetadata } from "../../src/artifacts";
import { cleanDoc, facetNatspec, firstSentence, natspecSummary } from "../../src/natspec";

const OUT = join(import.meta.dir, "fixtures", "lattice", "out");

async function load(file: string, contract: string): Promise<Artifact> {
  const result = await findArtifact(OUT, { file, contract });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function docs(userdoc: SolcMetadata["output"]["userdoc"], devdoc: SolcMetadata["output"]["devdoc"]) {
  return { output: { abi: [], userdoc, devdoc } };
}

describe("cleanDoc and firstSentence", () => {
  test("collapse solc's kept indentation and drop empty text", () => {
    expect(cleanDoc("a the         diamond\n  b ")).toBe("a the diamond b");
    expect(cleanDoc("   ")).toBeUndefined();
    expect(cleanDoc(undefined)).toBeUndefined();
  });

  test("the first sentence ends at a stop followed by a capital, a backtick, a brace or the end", () => {
    expect(firstSentence("One thing. Two things.")).toBe("One thing.");
    expect(firstSentence("Cut it. `bytes4(0)` routes.")).toBe("Cut it.");
    expect(firstSentence("Uses v5.1.0 of it. Then more.")).toBe("Uses v5.1.0 of it.");
    expect(firstSentence("e.g. lowercase continues. Next.")).toBe("e.g. lowercase continues.");
    expect(firstSentence("No stop at all")).toBe("No stop at all");
    expect(firstSentence(undefined)).toBeUndefined();
  });
});

describe("facetNatspec", () => {
  test("contract notice and dev note, and each routed selector's notice keyed by selector", async () => {
    const a = await load("ERC20.sol", "ERC20");
    const { selectors } = checkSelectors("ERC20", ["0xa9059cbb", "0x70a08231"], a);
    expect(facetNatspec(a.metadata, selectors)).toEqual({
      notice: "Stateless Diamond facet for the ERC-20 token standard.",
      dev: "All logic lives in ERC20Lib. This contract is a pure delegator. Subclasses (Burnable, Capped, Permit) override `virtual` methods.",
      functions: {
        "0xa9059cbb": { notice: "Transfers `value` tokens from the caller to `to`." },
        "0x70a08231": { notice: "Returns the token balance of `account`." },
      },
    });
  });

  test("parameter docs come from devdoc, cleaned", async () => {
    const a = await load("DiamondCutFacet.sol", "DiamondCutFacet");
    const { selectors } = checkSelectors("DiamondCutFacet", ["0x1f931c1c"], a);
    expect(facetNatspec(a.metadata, selectors).functions["0x1f931c1c"]).toEqual({
      notice: "Add/replace/remove any number of functions and optionally execute a function with delegatecall",
      params: {
        _calldata: "A function call, including function selector and arguments _calldata is executed with delegatecall on _init",
        _diamondCut: "Contains the facet addresses and function selectors",
        _init: "The address of the contract or facet to execute _calldata",
      },
    });
  });

  test("functions without docs are left out; so is exportSelectors(), which isn't routed", async () => {
    const a = await load("Receive.sol", "Receive");
    const { selectors } = checkSelectors("Receive", ["0x00000000"], a);
    const natspec = facetNatspec(a.metadata, selectors);
    expect(natspec.functions).toEqual({});
    expect(natspec.notice?.startsWith("Bare-ETH acceptance as a facet: cut this under the ZERO selector")).toBe(true);
  });

  test("dev notes and params on a synthetic facet; empty docs vanish", () => {
    const natspec = facetNatspec(
      docs(
        { methods: { "f(uint256)": { notice: "  " } } },
        { details: "", methods: { "f(uint256)": { details: "Does f.", params: { x: " the   x ", y: "" } } } },
      ),
      [{ hex: "0xb3de648b", signature: "f(uint256)" }],
    );
    expect(natspec).toEqual({ functions: { "0xb3de648b": { dev: "Does f.", params: { x: "the x" } } } });
  });
});

describe("natspecSummary", () => {
  test("is the contract notice's first sentence", async () => {
    expect(natspecSummary((await load("ERC20.sol", "ERC20")).metadata)).toBe(
      "Stateless Diamond facet for the ERC-20 token standard.",
    );
    expect(natspecSummary((await load("Receive.sol", "Receive")).metadata)).toBe(
      "Bare-ETH acceptance as a facet: cut this under the ZERO selector (`bytes4(0)`) and the diamond accepts plain ETH sends.",
    );
  });

  test("is absent without a notice", () => {
    expect(natspecSummary(docs({}, {}))).toBeUndefined();
  });
});
