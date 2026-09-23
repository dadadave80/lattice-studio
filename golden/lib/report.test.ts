import { describe, expect, test } from "bun:test";
import { type Cut, HarnessError, applyCuts, buildRoutingFile, parseReports, serialize } from "./report.ts";

const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";
const Z = "0x0000000000000000000000000000000000000000";
const H = "0x" + "11".repeat(32);

const sigs: Record<string, Record<string, string>> = {
  "A.sol:A": { "0xa9059cbb": "transfer(address,uint256)", "0x06fdde03": "name()" },
  "B.sol:B": { "0xa9059cbb": "transfer(address,uint256)", "0x70a08231": "balanceOf(address)" },
  "AInit.sol:AInit": { "0x7029144c": "init(string,string)" },
  "Intro.sol:Intro": { "0xd1a4dbd8": "initImmutable()" },
};
const lookup = (artifact: string, selector: string) => sigs[artifact]?.[selector];

const lines = [
  "unrelated console output",
  "STUDIO_GOLDEN recipe Token script/Token.s.sol buildCuts(string,string)",
  `STUDIO_GOLDEN cut 0 Add ${A} ${H} A A.sol:A 0xa9059cbb,0x06fdde03`,
  `STUDIO_GOLDEN cut 1 Add ${B} ${H} B B.sol:B 0x70a08231`,
  `STUDIO_GOLDEN cut 2 Replace ${B} ${H} B B.sol:B 0xa9059cbb`,
  `STUDIO_GOLDEN init MultiInit ${A} ${H} MultiInit MultiInit.sol:MultiInit`,
  `STUDIO_GOLDEN step 0 ${A} ${H} AInit AInit.sol:AInit 0x7029144c`,
  `STUDIO_GOLDEN step 1 ${B} ${H} Intro Intro.sol:Intro 0xd1a4dbd8`,
];

function cut(index: number, action: Cut["action"], address: string, name: string, selectors: string[]): Cut {
  return { index, action, facet: { address, codehash: H, name, artifact: `${name}.sol:${name}` }, selectors };
}

describe("parseReports", () => {
  test("groups STUDIO_GOLDEN lines by recipe and ignores other logs", () => {
    const [r, ...rest] = parseReports(lines);
    expect(rest).toHaveLength(0);
    expect(r?.recipe).toBe("Token");
    expect(r?.script).toBe("script/Token.s.sol");
    expect(r?.cuts.map((c) => `${c.action} ${c.facet.name} ${c.selectors.join(",")}`)).toEqual([
      "Add A 0xa9059cbb,0x06fdde03",
      "Add B 0x70a08231",
      "Replace B 0xa9059cbb",
    ]);
    expect(r?.init.kind).toBe("MultiInit");
    expect(r?.init.steps.map((s) => s.contract.name)).toEqual(["AInit", "Intro"]);
  });

  test("rejects malformed lines instead of skipping them", () => {
    expect(() => parseReports([`STUDIO_GOLDEN cut 0 Add ${A} ${H} A A.sol:A 0xa9059cbb`])).toThrow(HarnessError);
    expect(() => parseReports(["STUDIO_GOLDEN recipe T s b", `STUDIO_GOLDEN cut 0 Move ${A} ${H} A A.sol:A 0xa9059cbb`])).toThrow(
      /Unknown cut action/,
    );
    expect(() => parseReports(["STUDIO_GOLDEN recipe T s b", `STUDIO_GOLDEN cut 0 Add ${A} ${H} A A.sol:A 0xA9059CBB`])).toThrow(
      /selector/,
    );
    expect(() => parseReports(["STUDIO_GOLDEN recipe T s"])).toThrow(/Expected 3 fields/);
    expect(() => parseReports(["STUDIO_GOLDEN recipe T s b", "STUDIO_GOLDEN bogus 1"])).toThrow(/Unknown record/);
  });
});

describe("applyCuts", () => {
  test("Add then Replace leaves the replacing facet as owner, and Remove deletes", () => {
    const { routing, order } = applyCuts([
      cut(0, "Add", A, "A", ["0xa9059cbb", "0x06fdde03"]),
      cut(1, "Add", B, "B", ["0x70a08231"]),
      cut(2, "Replace", B, "B", ["0xa9059cbb"]),
      cut(3, "Remove", Z, "-", ["0x06fdde03"]),
    ]);
    expect(Object.fromEntries([...routing].map(([s, c]) => [s, c.name]))).toEqual({
      "0xa9059cbb": "B",
      "0x70a08231": "B",
    });
    expect(order).toEqual(["A", "B"]);
  });

  test("fails where the diamond would revert", () => {
    expect(() => applyCuts([cut(0, "Add", A, "A", ["0x01"]), cut(1, "Add", B, "B", ["0x01"])])).toThrow(
      /0x01 is already served by A/,
    );
    expect(() => applyCuts([cut(0, "Replace", A, "A", ["0x01"])])).toThrow(/isn't in the diamond yet/);
    expect(() => applyCuts([cut(0, "Add", A, "A", ["0x01"]), cut(1, "Replace", A, "A", ["0x01"])])).toThrow(
      /already served by that facet/,
    );
    expect(() => applyCuts([cut(0, "Remove", Z, "-", ["0x01"])])).toThrow(/isn't in the diamond/);
    expect(() => applyCuts([cut(0, "Remove", A, "A", ["0x01"])])).toThrow(/zero address/);
    expect(() => applyCuts([cut(0, "Add", Z, "A", ["0x01"])])).toThrow(/needs a facet address/);
    expect(() => applyCuts([cut(0, "Add", A, "A", [])])).toThrow(/no selectors/);
    expect(() => applyCuts([cut(0, "Add", A, "?", ["0x01"])])).toThrow(/no FacetInventory facet/);
  });
});

describe("buildRoutingFile", () => {
  test("normalizes the sequence into sorted routing, signatures and init steps", () => {
    const [report] = parseReports(lines);
    const file = buildRoutingFile(report!, lookup);
    expect(file.routing).toEqual({ "0x06fdde03": "A", "0x70a08231": "B", "0xa9059cbb": "B" });
    expect(Object.keys(file.routing)).toEqual(["0x06fdde03", "0x70a08231", "0xa9059cbb"]);
    expect(file.signatures["0xa9059cbb"]).toBe("transfer(address,uint256)");
    expect(file.facets).toEqual(["A", "B"]);
    expect(file.init).toEqual({
      kind: "MultiInit",
      steps: [
        { init: "AInit", selector: "0x7029144c", signature: "init(string,string)" },
        { init: "Intro", selector: "0xd1a4dbd8", signature: "initImmutable()" },
      ],
    });
    expect(serialize(file).endsWith("}\n")).toBe(true);
  });

  test("drops facets whose every selector was replaced away", () => {
    const report = parseReports([
      "STUDIO_GOLDEN recipe T s b",
      `STUDIO_GOLDEN cut 0 Add ${A} ${H} A A.sol:A 0xa9059cbb`,
      `STUDIO_GOLDEN cut 1 Replace ${B} ${H} B B.sol:B 0xa9059cbb`,
      "STUDIO_GOLDEN init none - - - -",
    ])[0]!;
    const file = buildRoutingFile(report, lookup);
    expect(file.facets).toEqual(["B"]);
    expect(file.init).toEqual({ kind: "none", steps: [] });
  });

  test("names Receive's zero selector and refuses unknown signatures and inits", () => {
    const zero = parseReports([
      "STUDIO_GOLDEN recipe T s b",
      `STUDIO_GOLDEN cut 0 Add ${A} ${H} Receive Receive.sol:Receive 0x00000000`,
      "STUDIO_GOLDEN init none - - - -",
    ])[0]!;
    expect(buildRoutingFile(zero, lookup).signatures["0x00000000"]).toBe("receive()");

    const unknownSig = parseReports(["STUDIO_GOLDEN recipe T s b", `STUDIO_GOLDEN cut 0 Add ${A} ${H} A A.sol:A 0x12345678`])[0]!;
    expect(() => buildRoutingFile(unknownSig, lookup)).toThrow(/no function with selector 0x12345678/);

    const unknownInit = parseReports([
      "STUDIO_GOLDEN recipe T s b",
      `STUDIO_GOLDEN cut 0 Add ${A} ${H} A A.sol:A 0x06fdde03`,
      `STUDIO_GOLDEN init direct ${B} ${H} ? ?`,
      `STUDIO_GOLDEN step 0 ${B} ${H} ? ? 0x7029144c`,
    ])[0]!;
    expect(() => buildRoutingFile(unknownInit, lookup)).toThrow(/_initArtifacts/);
  });
});
