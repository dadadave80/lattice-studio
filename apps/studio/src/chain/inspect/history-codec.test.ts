import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { decodeDiamondCutLog, DIAMOND_CUT_EVENT } from "./history-codec";

const DIAMOND = "0x00000000000000000000000000000000000000AA";
const FACET = "0x00000000000000000000000000000000000000bb";
test("cut-log decoding preserves actual cut and initializer calldata bytes", () => {
  const cuts = [{ facetAddress: FACET, action: 1, functionSelectors: ["0x12345678"] }] as const;
  const topics = encodeEventTopics({ abi: [DIAMOND_CUT_EVENT], eventName: "DiamondCut" });
  const data = encodeAbiParameters(DIAMOND_CUT_EVENT.inputs, [cuts, FACET, "0xdeadbeef"]);
  expect(decodeDiamondCutLog({ address: DIAMOND, topics: topics as readonly `0x${string}`[], data }, DIAMOND)).toEqual({ ok: true, value: { cuts: cuts.map((cut) => ({ ...cut, functionSelectors: [...cut.functionSelectors] })), init: FACET, data: "0xdeadbeef" } });
});
describe("unrelated or malformed cut logs", () => {
  test("rejects another emitter and malformed ABI bytes", () => {
    expect(decodeDiamondCutLog({ address: FACET, data: "0x", topics: [] }, DIAMOND).ok).toBe(false);
    const topics = encodeEventTopics({ abi: [DIAMOND_CUT_EVENT], eventName: "DiamondCut" });
    expect(decodeDiamondCutLog({ address: DIAMOND, data: "0x1234", topics: topics as readonly `0x${string}`[] }, DIAMOND).ok).toBe(false);
  });
});
