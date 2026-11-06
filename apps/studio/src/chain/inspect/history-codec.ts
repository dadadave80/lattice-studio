import { isAddress, isHexAnyCase, sameAddress, toChecksum, type Address, type Hex, type Hex4, type Result } from "@lattice-studio/core";
import { decodeEventLog, encodeEventTopics, parseAbiItem } from "viem";

export const DIAMOND_CUT_EVENT = parseAbiItem("event DiamondCut((address facetAddress, uint8 action, bytes4[] functionSelectors)[] _diamondCut, address _init, bytes _calldata)");
export const DIAMOND_CUT_TOPIC = encodeEventTopics({ abi: [DIAMOND_CUT_EVENT], eventName: "DiamondCut" })[0] as Hex;
export type DecodedDiamondCut = {
  cuts: { facetAddress: Address; action: number; functionSelectors: Hex4[] }[];
  init: Address;
  data: Hex;
};

/** Pure event decoder for history and receipt proofs. The caller still verifies receipt/block canonicality. */
export function decodeDiamondCutLog(log: { address: Address; data: Hex; topics: readonly Hex[] }, diamond: Address): Result<DecodedDiamondCut, string> {
  const topic = log.topics[0];
  if (!isAddress(log.address) || !isAddress(diamond) || !sameAddress(log.address, diamond) || !isHexAnyCase(log.data)
    || log.topics.length !== 1 || topic === undefined || topic.toLowerCase() !== DIAMOND_CUT_TOPIC.toLowerCase()) {
    return { ok: false, error: "This isn't a DiamondCut log for this diamond." };
  }
  try {
    const decoded = decodeEventLog({ abi: [DIAMOND_CUT_EVENT], data: log.data, topics: [topic], strict: true });
    if (decoded.args === undefined) return { ok: false, error: "The DiamondCut log has no event arguments." };
    return { ok: true, value: {
      cuts: decoded.args._diamondCut.map((cut) => ({ facetAddress: toChecksum(cut.facetAddress), action: cut.action, functionSelectors: cut.functionSelectors.map((selector) => selector.toLowerCase() as Hex4) })),
      init: toChecksum(decoded.args._init), data: decoded.args._calldata.toLowerCase() as Hex,
    } };
  } catch { return { ok: false, error: "DiamondCut event data couldn't be decoded." }; }
}
