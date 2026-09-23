import { describe, expect, test } from "bun:test";
import type { InitParam } from "../../model/catalog";
import type { ChainState } from "../../model/chain";
import type { FieldModel } from "../../model/init";
import { makeInit } from "../../testing/builders";
import { loadFixtureCatalog } from "../../testing/fixtures";
import { fieldModel, labelFor, validateArg } from "./fields";
import { parseRule } from "./rules";

const fixture = loadFixtureCatalog();
if (!fixture.ok) throw new Error(fixture.error);
const catalog = fixture.value;

function spec(name: string) {
  const found = catalog.inits.find((s) => s.name === name);
  if (!found) throw new Error(`${name} isn't in the fixture catalog`);
  return found;
}

function field(param: Partial<InitParam> & { name: string; type: string }, at = "steps[0]"): FieldModel {
  return fieldModel(makeInit({ name: "TestInit" }), { doc: "", ...param }, at);
}

const vault = spec("GovernedVaultInit");
const [p] = vault.params;
if (!p) throw new Error("GovernedVaultInit has no params");
const bundle = fieldModel(vault, p, "bundle");

function component(name: string): FieldModel {
  const found = bundle.components?.find((c) => c.name === name);
  if (!found) throw new Error(`no component ${name}`);
  return found;
}

function chain(codeAt: Record<string, `0x${string}`>): ChainState {
  return { chainId: 11155111, name: "Sepolia", online: true, probedAt: "2026-09-23T00:00:00Z", deployer: { present: true }, shared: {}, simulate: true, codeAt };
}

const SAFE = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";

describe("labelFor", () => {
  test("sentence case from camelCase and underscores; acronyms kept", () => {
    expect(labelFor("votingPeriod")).toBe("Voting period");
    expect(labelFor("decimalsOffset_")).toBe("Decimals offset");
    expect(labelFor("_owner")).toBe("Owner");
    expect(labelFor("minDelay")).toBe("Min delay");
    expect(labelFor("ensName")).toBe("Ens name");
    expect(labelFor("rootENSNode")).toBe("Root ENS node");
  });

  test("quorumNumerator reads Governor quorum, as spec L327 and L716 name it", () => {
    expect(labelFor("quorumNumerator")).toBe("Governor quorum");
  });
});

describe("parseRule", () => {
  test("every term of the grammar, joined with &", () => {
    expect(parseRule("range(0,100)&gt(1)&gte(2)&nonzero&maxlen(32)&code(safe)&enum(a|b|c)")).toEqual({
      range: { min: 0n, max: 100n },
      gt: 1n,
      gte: 2n,
      nonzero: true,
      maxlen: 32,
      code: "safe",
      options: ["a", "b", "c"],
    });
  });

  test("no rule, and malformed terms, are skipped", () => {
    expect(parseRule(undefined)).toEqual({});
    expect(parseRule("")).toEqual({});
    expect(parseRule("range(1)&code(wallet)&shiny&gt(x)")).toEqual({});
  });
});

describe("fieldModel", () => {
  test("GovernedVaultInit's struct is one tuple field whose nine components have dotted paths", () => {
    expect(bundle.kind).toBe("tuple");
    expect(bundle.path).toBe("bundle.p");
    expect(bundle.components?.map((c) => c.path)).toEqual([
      "bundle.p.asset",
      "bundle.p.name",
      "bundle.p.symbol",
      "bundle.p.decimalsOffset",
      "bundle.p.minDelay",
      "bundle.p.votingDelay",
      "bundle.p.votingPeriod",
      "bundle.p.proposalThreshold",
      "bundle.p.quorumNumerator",
    ]);
    expect(bundle.components?.map((c) => c.label)).toEqual([
      "Asset", "Name", "Symbol", "Decimals offset", "Min delay", "Voting delay", "Voting period", "Proposal threshold", "Governor quorum",
    ]);
  });

  test("kinds, units and bounds come from type, unit and rule", () => {
    expect(component("asset")).toMatchObject({ kind: "address", required: true, allowZero: false, needsCode: "token", rule: "nonzero&code(token)" });
    expect(component("name")).toMatchObject({ kind: "string", example: "Grant vault", exampleSource: "script/base/defi/GrantExample.s.sol#L26-L26" });
    expect(component("decimalsOffset")).toMatchObject({ kind: "integer", min: "0", max: "255", allowZero: true });
    expect(component("minDelay")).toMatchObject({ kind: "duration", unit: "seconds", min: "0" });
    expect(component("votingPeriod")).toMatchObject({ kind: "duration", unit: "seconds", min: "0", exclusiveMin: true, max: "4294967295", allowZero: false });
    expect(component("proposalThreshold")).toMatchObject({ kind: "amount", unit: "wei" });
    expect(component("quorumNumerator")).toMatchObject({ kind: "percent", unit: "percent", min: "0", max: "100", allowZero: true });
  });

  test("authority, role and the path prefix", () => {
    const [admin] = spec("AccessControlInit").params;
    if (!admin) throw new Error("no admin param");
    expect(fieldModel(spec("AccessControlInit"), admin, "steps[2]")).toMatchObject({
      path: "steps[2].admin",
      label: "Admin",
      kind: "address",
      authority: true,
      role: "DEFAULT_ADMIN_ROLE",
      allowZero: false,
    });
    expect(fieldModel(spec("AccessControlInit"), admin).path).toBe("admin");
  });

  test("the remaining kinds: bool, bytes, enum, array", () => {
    expect(field({ name: "paused", type: "bool" }).kind).toBe("bool");
    expect(field({ name: "data", type: "bytes", rule: "maxlen(4)" })).toMatchObject({ kind: "bytes", maxLength: 4 });
    expect(field({ name: "mode", type: "string", rule: "enum(open|closed)" })).toMatchObject({ kind: "enum", options: ["open", "closed"] });
    expect(field({ name: "tier", type: "uint8", rule: "enum(1|2|3)" })).toMatchObject({ kind: "enum", options: ["1", "2", "3"] });
    const list = field({ name: "guardians", type: "address[]", rule: "nonzero", example: [] });
    expect(list).toMatchObject({ kind: "array", path: "steps[0].guardians" });
    expect(list.element).toMatchObject({ kind: "address", path: "steps[0].guardians[]", allowZero: false });
    expect(list.element?.example).toBeUndefined();
    expect(field({ name: "count", type: "int8" })).toMatchObject({ kind: "integer", min: "-128", max: "127" });
    expect(field({ name: "floor", type: "uint256", rule: "gte(5)" })).toMatchObject({ min: "5", allowZero: false });
  });
});

describe("validateArg", () => {
  test("Quorum 140 → the spec's message (spec L327)", () => {
    expect(validateArg(component("quorumNumerator"), "140", {})).toEqual({ ok: false, error: "Governor quorum is 140; it must be 0-100 (percent of supply)." });
    expect(validateArg(component("quorumNumerator"), "4", {})).toEqual({ ok: true, value: "4" });
  });

  test("a missing required argument is a complete sentence", () => {
    expect(validateArg(component("asset"), undefined, {})).toEqual({ ok: false, error: "Asset is required. Fill it in before deploying." });
    expect(validateArg(component("asset"), "  ", {})).toEqual({ ok: false, error: "Asset is required. Fill it in before deploying." });
  });

  test("integers: whole numbers, type bounds and rules, stored canonically", () => {
    expect(validateArg(component("votingPeriod"), "0", {})).toEqual({ ok: false, error: "Voting period is 0; it must be greater than 0 (seconds)." });
    expect(validateArg(component("votingPeriod"), "0600", {})).toEqual({ ok: true, value: "600" });
    expect(validateArg(component("decimalsOffset"), "300", {})).toEqual({ ok: false, error: "Decimals offset is 300; it doesn't fit in a uint8 (at most 255)." });
    expect(validateArg(component("decimalsOffset"), "-1", {})).toEqual({ ok: false, error: "Decimals offset is -1; it can't be negative." });
    expect(validateArg(component("minDelay"), "5 minutes", {})).toEqual({ ok: false, error: "Min delay is 5 minutes; it must be a whole number." });
    expect(validateArg(field({ name: "count", type: "int8" }), "-200", {})).toEqual({ ok: false, error: "Count is -200; it doesn't fit in an int8 (at least -128)." });
    expect(validateArg(field({ name: "threshold", type: "uint256", rule: "gte(1)" }), "0", {})).toEqual({ ok: false, error: "Threshold is 0; it must be at least 1." });
    expect(validateArg(field({ name: "fee", type: "uint256", rule: "nonzero", unit: "wei" }), "0", {})).toEqual({ ok: false, error: "Fee is 0; it can't be 0 (wei)." });
    expect(validateArg(field({ name: "bps", type: "uint16", rule: "range(1,10000)" }), "10001", {})).toEqual({ ok: false, error: "Bps is 10001; it must be 1-10000." });
    expect(validateArg(field({ name: "share", type: "uint8", unit: "percent" }), "101", {})).toEqual({ ok: false, error: "Share is 101; it must be 0-100 (percent)." });
    expect(validateArg(field({ name: "tier", type: "uint8", rule: "enum(1|2|3)" }), "4", {})).toEqual({ ok: false, error: "Tier is 4; it must be one of 1, 2 or 3." });
  });

  test("addresses: checksummed on the way in; a mixed-case address with a wrong checksum is flagged (spec L462)", () => {
    const lower = SAFE.toLowerCase();
    expect(validateArg(component("asset"), lower, {})).toEqual({ ok: true, value: SAFE });
    expect(validateArg(component("asset"), `0x${lower.slice(2).toUpperCase()}`, {})).toEqual({ ok: true, value: SAFE });
    const wrong = `${SAFE.slice(0, -1)}f`;
    expect(validateArg(component("asset"), wrong, {})).toEqual({ ok: false, error: `Asset is ${wrong}; its checksum doesn't match, so it may have a typo.` });
    expect(validateArg(component("asset"), "0x1234", {})).toEqual({ ok: false, error: "Asset is 0x1234; it isn't an address." });
    expect(validateArg(component("asset"), `0x${"0".repeat(40)}`, {})).toEqual({ ok: false, error: `Asset is 0x${"0".repeat(40)}; it can't be the zero address.` });
    expect(validateArg(field({ name: "to", type: "address" }), `0x${"0".repeat(40)}`, {})).toEqual({ ok: true, value: `0x${"0".repeat(40)}` });
  });

  test("references are stored as references, and only address fields take them", () => {
    expect(validateArg(component("asset"), { $ref: "deployer" }, {})).toEqual({ ok: true, value: { $ref: "deployer" } });
    expect(validateArg(component("name"), { $ref: "self" }, {})).toEqual({ ok: false, error: 'Name is {"$ref":"self"}; only an address field can hold a reference.' });
  });

  test("chain rules apply only when codeAt has the address", () => {
    const safe = fieldModel(spec("SafeDiamondCutInit"), spec("SafeDiamondCutInit").params[1] as InitParam, "steps[0]");
    const sepolia = chain({ [SAFE.toLowerCase()]: "0x" });
    expect(validateArg(safe, SAFE, { chain: sepolia })).toEqual({ ok: false, error: "No Safe at this address on Sepolia yet. Deploy the Safe first." });
    expect(validateArg(safe, SAFE, { chain: chain({}) })).toEqual({ ok: true, value: SAFE });
    expect(validateArg(safe, SAFE, { chain: chain({ [SAFE.toLowerCase()]: "0x6080" }) })).toEqual({ ok: true, value: SAFE });
    expect(validateArg(safe, SAFE, {})).toEqual({ ok: true, value: SAFE });
    expect(validateArg(safe, { $ref: "deployer" }, { chain: sepolia, refs: { deployer: SAFE } })).toEqual({
      ok: false,
      error: "No Safe at this address on Sepolia yet. Deploy the Safe first.",
    });
    expect(validateArg(component("asset"), SAFE, { chain: sepolia, chainName: "Base Sepolia" })).toEqual({
      ok: false,
      error: "No token at this address on Base Sepolia. Use the token's address on Base Sepolia.",
    });
    expect(validateArg(field({ name: "target", type: "address", rule: "code(contract)" }), SAFE, { chain: sepolia })).toEqual({
      ok: false,
      error: "No contract at this address on Sepolia. Use an address that holds code on Sepolia.",
    });
  });

  test("strings, enums, booleans and bytes", () => {
    expect(validateArg(field({ name: "symbol", type: "string", rule: "maxlen(3)" }), "gVLTX", {})).toEqual({ ok: false, error: "Symbol is gVLTX; it must be at most 3 characters." });
    expect(validateArg(field({ name: "mode", type: "string", rule: "enum(open|closed)" }), "ajar", {})).toEqual({ ok: false, error: "Mode is ajar; it must be one of open or closed." });
    expect(validateArg(field({ name: "paused", type: "bool" }), "yes", {})).toEqual({ ok: false, error: "Paused is yes; it must be true or false." });
    expect(validateArg(field({ name: "paused", type: "bool" }), false, {})).toEqual({ ok: true, value: false });
    expect(validateArg(field({ name: "salt", type: "bytes32" }), "0xAB", {})).toEqual({ ok: false, error: "Salt is 0xAB; it must be exactly 32 bytes." });
    expect(validateArg(field({ name: "data", type: "bytes" }), "0xABcd", {})).toEqual({ ok: true, value: "0xabcd" });
    expect(validateArg(field({ name: "data", type: "bytes" }), "abcd", {})).toEqual({ ok: false, error: "Data is abcd; it must be hex bytes, starting 0x." });
  });

  test("tuples and arrays report the component or item that failed", () => {
    expect(validateArg(bundle, { asset: SAFE, name: "V", symbol: "V", decimalsOffset: "0", minDelay: "1", votingDelay: "1", votingPeriod: "1", proposalThreshold: "0", quorumNumerator: "140" }, {})).toEqual({
      ok: false,
      error: "Governor quorum is 140; it must be 0-100 (percent of supply).",
    });
    expect(validateArg(bundle, "p", {})).toEqual({ ok: false, error: "P is p; it must be a group of fields." });
    const list = field({ name: "guardians", type: "address[]", rule: "nonzero" });
    expect(validateArg(list, [SAFE.toLowerCase()], {})).toEqual({ ok: true, value: [SAFE] });
    expect(validateArg(list, [SAFE, "0x12"], {})).toEqual({ ok: false, error: "Guardians item 2 is 0x12; it isn't an address." });
    expect(validateArg(list, [], {})).toEqual({ ok: true, value: [] });
    expect(validateArg(list, SAFE, {})).toEqual({ ok: false, error: `Guardians is ${SAFE}; it must be a list.` });
    expect(validateArg(field({ name: "pair", type: "address[2]" }), [SAFE], {})).toEqual({ ok: false, error: `Pair is ["${SAFE}"]; it must have exactly 2 items.` });
  });
});
