/**
 * The overlay lint (spec L911) on a small synthetic overlay: each error and warning, its positive and negative case.
 */
import { describe, expect, test } from "bun:test";
import type { Hex4 } from "@lattice-studio/core";
import { buildOverlay, type Overlay, type OverlayFile } from "../../src/overlay";
import { formatLintSummary, type LintFacts, type LintIssue, lintCounts, lintOverlay, parseRule } from "../../src/overlay-lint";

function overlay(files: Partial<Record<`${"facets" | "inits"}/${string}`, string>>): Overlay {
  const list: OverlayFile[] = Object.entries(files).map(([key, text]) => {
    const [kind, area] = key.split("/") as [OverlayFile["kind"], string];
    return { kind, area, file: `overlay/${key}.yaml`, text: text ?? "" };
  });
  const r = buildOverlay(list);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

const S = (n: number) => `0x${n.toString(16).padStart(8, "0")}` as Hex4;
const FACTS: LintFacts = {
  facets: [
    { name: "ERC20", area: "tokens", selectors: [S(1), S(2)], summary: "Stateless Diamond facet for the ERC-20 token standard." },
    { name: "ERC4626", area: "tokens", selectors: [S(2), S(3)], summary: "Vault." },
    { name: "Solo", area: "utils", selectors: [S(9)] },
  ],
  inits: [
    {
      name: "ERC20Init",
      area: "tokens",
      params: [
        { name: "name_", type: "string", doc: "Token name." },
        { name: "symbol_", type: "string" },
      ],
      initializes: ["ERC20"],
      registersInterfaces: false,
    },
    {
      name: "BundleInit",
      area: "tokens",
      params: [{ name: "p", type: "tuple", components: [{ name: "delay", type: "uint48" }, { name: "who", type: "address" }] }],
      initializes: ["ERC20", "ERC4626"],
      registersInterfaces: true,
    },
  ],
};

const CLEAN = {
  "facets/tokens": `
ERC20:
  requires: []
  init: {name: ERC20Init, source: src/ERC20Init.sol#L1-L3}
  seamReview: Shares one selector with ERC4626; no seam.
ERC4626:
  requires:
    - {anyOf: [ERC20], strength: hard, reason: it extends ERC20's shares, source: src/ERC4626.sol#L1-L2}
  defaultOwnerOf:
    - {selectors: ["0x00000002"], source: src/ERC4626.sol#L1-L1}
  seamReview: Owns the shared selector by default.
`,
  "facets/utils": "Solo:\n  requires: []\n  summary: {text: A facet on its own., source: src/Solo.sol#L1-L1}\n",
  "inits/tokens": `
ERC20Init:
  kind: step
  source: src/ERC20Init.sol#L1-L3
  params:
    symbol_: {doc: Token symbol.}
BundleInit:
  kind: bundle
  source: src/BundleInit.sol#L1-L9
  registersInterfaces: true
  params:
    p:
      doc: Everything.
      components:
        delay: {doc: The delay., unit: seconds, rule: gt(0), source: src/BundleInit.sol#L2-L2}
        who: {doc: The admin., rule: nonzero, authority: true, role: DEFAULT_ADMIN_ROLE, source: src/BundleInit.sol#L3-L3}
  after:
    - {module: ERC20, source: src/BundleInit.sol#L4-L4}
  sequence: {modules: [ERC20, ERC4626], source: src/BundleInit.sol#L1-L9}
`,
};

const lines = (path: string) => (path.startsWith("src/") ? 10 : undefined);
const codes = (issues: LintIssue[]) => issues.map((i) => `${i.code} ${i.subject}${i.path ? ` ${i.path}` : ""}`);

function lint(files: Partial<typeof CLEAN> & Record<string, string>, facts: LintFacts = FACTS) {
  return lintOverlay(overlay({ ...CLEAN, ...files }), { ...facts, sourceLines: lines });
}

describe("the clean overlay", () => {
  test("has no errors and no warnings", () => {
    expect(lint({})).toEqual({ errors: [], warnings: [] });
  });
});

describe("errors", () => {
  test("a facet that isn't in the inventory", () => {
    expect(codes(lint({ "facets/utils": `${CLEAN["facets/utils"]}Ghost:\n  requires: []\n` }).errors)).toEqual(["facet-unknown Ghost"]);
  });

  test("a facet or init written under another area", () => {
    const r = lint({ "facets/utils": "", "facets/access": CLEAN["facets/utils"] });
    expect(codes(r.errors)).toEqual(["wrong-area Solo"]);
    expect(r.errors[0]?.message).toBe("Solo is in utils; move it to overlay/facets/utils.yaml.");
  });

  test("a requirement naming an unknown facet, or the facet itself", () => {
    const r = lint({
      "facets/utils": `Solo:\n  summary: {text: A facet., source: src/Solo.sol#L1-L1}\n  requires:\n    - {anyOf: [Solo, ERC20X], strength: convention, reason: why, source: src/a.sol#L1-L1}\n`,
    });
    expect(codes(r.errors)).toEqual(["requires-self Solo requires[0]", "requires-unknown Solo requires[0]"]);
  });

  test("a default owner of a selector the facet doesn't export, and two default owners of one selector", () => {
    const r = lint({
      "facets/tokens": CLEAN["facets/tokens"].replace(
        "  seamReview: Shares one selector with ERC4626; no seam.",
        '  defaultOwnerOf:\n    - {selectors: ["0x00000002", "0x00000009"], source: src/a.sol#L1-L1}\n  seamReview: x.',
      ),
    });
    expect(codes(r.errors)).toEqual(["selector-unknown ERC20 defaultOwnerOf[0]", "default-conflict ERC4626 defaultOwnerOf[0]"]);
  });

  test("a facet init or overlay init that isn't an init contract", () => {
    const r = lint({
      "facets/tokens": CLEAN["facets/tokens"].replace("name: ERC20Init", "name: ERC20Init2"),
      "inits/utils": "SoloInit:\n  kind: step\n  source: src/a.sol#L1-L1\n",
    });
    expect(codes(r.errors)).toEqual(["init-unknown ERC20 init", "init-unknown SoloInit"]);
  });

  test("without init facts, facet inits resolve against the overlay's own inits", () => {
    const { inits: _drop, ...facets } = FACTS;
    const r = lint({ "facets/tokens": CLEAN["facets/tokens"].replace("name: ERC20Init", "name: Nope") }, facets);
    expect(codes(r.errors)).toEqual(["init-unknown ERC20 init"]);
  });

  test("a param or component the init doesn't have, and components on a non-tuple", () => {
    const r = lint({
      "inits/tokens": CLEAN["inits/tokens"]
        .replace("symbol_: {doc: Token symbol.}", "symbol_: {doc: Token symbol.}\n    decimals_: {doc: Decimals.}\n    name_:\n      components:\n        x: {doc: X.}")
        .replace("who: {doc", "whom: {doc"),
    });
    expect(codes(r.errors)).toEqual([
      "param-unknown BundleInit params.p.components.whom",
      "param-unknown ERC20Init params.decimals_",
      "param-unknown ERC20Init params.name_.components",
    ]);
  });

  test("a bad rule, a rule or unit that doesn't fit the type", () => {
    const r = lint({
      "inits/tokens": CLEAN["inits/tokens"]
        .replace("rule: gt(0)", 'rule: "gt(0)&between(1,2)"')
        .replace("rule: nonzero, authority", 'rule: "nonzero&range(0,10)", unit: percent, authority')
        .replace("symbol_: {doc: Token symbol.}", "symbol_: {doc: Token symbol., rule: maxlen(11)&code(token), source: src/a.sol#L1-L1}"),
    });
    expect(codes(r.errors)).toEqual([
      "rule-invalid BundleInit params.p.components.delay.rule",
      "rule-type BundleInit params.p.components.who.rule",
      "rule-type BundleInit params.p.components.who.unit",
      "rule-type ERC20Init params.symbol_.rule",
    ]);
    expect(r.errors.map((e) => e.message)).toContain("code doesn't apply to string.");
  });

  test("after and sameCall must name a module some init initializes", () => {
    const r = lint({ "inits/tokens": CLEAN["inits/tokens"].replace("module: ERC20,", "module: ERC20Votes,") });
    expect(codes(r.errors)).toEqual(["module-unknown BundleInit after[0]"]);
    const withModules = lint({ "inits/tokens": CLEAN["inits/tokens"].replace("module: ERC20,", "module: ERC20Votes,") }, {
      ...FACTS,
      modules: ["ERC20Votes"],
    });
    expect(withModules.errors).toEqual([]);
  });

  test("a sequence on a step", () => {
    const r = lint({ "inits/tokens": CLEAN["inits/tokens"].replace("kind: bundle", "kind: step") });
    expect(codes(r.errors)).toEqual(["sequence-step BundleInit sequence"]);
  });

  test("registersInterfaces disagreeing with the source, either way", () => {
    const r = lint({
      "inits/tokens": CLEAN["inits/tokens"]
        .replace("  registersInterfaces: true\n", "")
        .replace("ERC20Init:\n  kind: step\n", "ERC20Init:\n  kind: step\n  registersInterfaces: true\n"),
    });
    expect(codes(r.errors)).toEqual(["registers-interfaces BundleInit registersInterfaces", "registers-interfaces ERC20Init registersInterfaces"]);
  });

  test("a citation to a missing file or past the end of one", () => {
    const r = lint({
      "facets/utils": "Solo:\n  requires: []\n  summary: {text: A facet on its own., source: lib/gone.sol#L1-L1}\n",
      "facets/tokens": CLEAN["facets/tokens"].replace("src/ERC4626.sol#L1-L2", "src/ERC4626.sol#L9-L11"),
    });
    expect(codes(r.errors)).toEqual(["source-range ERC4626 requires[0]", "source-missing Solo summary"]);
    expect(r.errors[0]?.message).toBe("cites lines 9-11 of src/ERC4626.sol, which has 10.");
  });

  test("copy that breaks the voice rules", () => {
    const r = lint({ "facets/utils": "Solo:\n  requires: []\n  summary: {text: Please add the colour picker!, source: src/Solo.sol#L1-L1}\n" });
    expect(r.errors.map((e) => e.code)).toEqual(["copy", "copy", "copy"]);
  });

  test("seams naming unknown facets or selectors a facet doesn't export", () => {
    const r = lint({}, { ...FACTS, seams: [{ selector: S(3), when: ["Ghost"], anyOf: ["ERC20", "ERC4626"] }] });
    expect(r.errors.map((e) => e.message)).toEqual(["ERC20 doesn't export 0x00000003.", "Ghost isn't in FacetInventory at the pin."]);
  });
});

describe("warnings", () => {
  test("a facet or init with no entry", () => {
    const r = lint({ "facets/utils": "", "inits/tokens": CLEAN["inits/tokens"].replace(/^ERC20Init:[\s\S]*?(?=BundleInit)/m, "") });
    expect(codes(r.warnings)).toEqual([
      "no-entry Solo",
      "summary-missing Solo",
      "init-docs ERC20Init params.symbol_",
      "no-entry ERC20Init",
    ]);
    expect(r.errors).toEqual([]);
  });

  test("no summary anywhere: NatSpec's counts, the overlay's overrides", () => {
    expect(codes(lint({ "facets/utils": "Solo:\n  requires: []\n" }).warnings)).toEqual(["summary-missing Solo"]);
  });

  test("requirements not reviewed", () => {
    const r = lint({ "facets/utils": "Solo:\n  summary: {text: A facet on its own., source: src/Solo.sol#L1-L1}\n" });
    expect(codes(r.warnings)).toEqual(["requires-unreviewed Solo"]);
  });

  test("seams not reviewed, only for a facet that shares a selector", () => {
    const r = lint({ "facets/tokens": CLEAN["facets/tokens"].replace("  seamReview: Shares one selector with ERC4626; no seam.\n", "") });
    expect(codes(r.warnings)).toEqual(["seams-unreviewed ERC20"]);
    expect(r.warnings[0]?.message).toBe("ERC20 shares 1 selector with ERC4626; write a seamReview.");
  });

  test("an init param or component with neither NatSpec nor an overlay doc", () => {
    const r = lint({ "inits/tokens": CLEAN["inits/tokens"].replace("doc: The delay., ", "") });
    expect(codes(r.warnings)).toEqual(["init-docs BundleInit params.p.components.delay"]);
  });
});

describe("the rule grammar (contracts §4)", () => {
  test.each([
    ["nonzero", [{ kind: "nonzero" }]],
    ["range(0,100)", [{ kind: "range", min: "0", max: "100" }]],
    ["gt(0)&maxlen(32)", [{ kind: "gt", n: "0" }, { kind: "maxlen", n: 32 }]],
    ["gte(1)", [{ kind: "gte", n: "1" }]],
    ["nonzero&code(safe)", [{ kind: "nonzero" }, { kind: "code", of: "safe" }]],
    ["enum(a|b|c)", [{ kind: "enum", values: ["a", "b", "c"] }]],
    ["range(0,115792089237316195423570985008687907853269984665640564039457584007913129639935)", [
      { kind: "range", min: "0", max: "115792089237316195423570985008687907853269984665640564039457584007913129639935" },
    ]],
  ])("%s parses", (rule, terms) => {
    expect(parseRule(rule)).toEqual({ ok: true, terms: terms as never });
  });

  test.each([
    ["between(1,2)", "isn't a rule term"],
    ["range(5,1)", "runs backwards"],
    ["range(1)", "needs two whole numbers"],
    ["gt(x)", "needs one whole number"],
    ["maxlen(0)", "needs a positive whole number"],
    ["code(eoa)", "takes safe, token or contract"],
    ["enum(a||b)", "needs values like"],
    ["enum(a|a)", "lists a value twice"],
    ["nonzero&nonzero", "repeats nonzero"],
    ["", "isn't a rule term"],
    ["nonzero & code(safe)", "has spaces"],
  ])("%s is refused", (rule, why) => {
    const r = parseRule(rule);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(why);
  });
});

describe("reporting", () => {
  test("counts per area and a summary that lists every error", () => {
    const r = lint({ "facets/utils": "Solo:\n  requires: []\n", "facets/access": "Ghost:\n  requires: []\n" });
    expect(lintCounts(r)["utils"]).toEqual({ errors: 0, warnings: 1 });
    expect(lintCounts(r)["access"]).toEqual({ errors: 1, warnings: 0 });
    expect(formatLintSummary(r)).toBe(
      [
        "Overlay lint: 1 error, 1 warning.",
        "  access: 1 error, 0 warnings",
        "  utils: 0 errors, 1 warning",
        "  error facet-unknown overlay/facets/access.yaml Ghost: Ghost isn't in FacetInventory at the pin.",
      ].join("\n"),
    );
  });

  test("the lint is deterministic: same input, same order", () => {
    const a = lint({ "facets/utils": "", "facets/access": "Ghost:\n  requires: []\n" });
    const b = lint({ "facets/access": "Ghost:\n  requires: []\n", "facets/utils": "" });
    expect(a).toEqual(b);
  });
});
