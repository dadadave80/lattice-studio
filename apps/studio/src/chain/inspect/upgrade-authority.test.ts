import { expect, test } from "bun:test";
import { encodeFunctionResult, parseAbi } from "viem";
import { makeCatalog, makeFacet } from "@lattice-studio/core/testing";
import type { Address, Hex } from "@lattice-studio/core";
import type { DiamondSnapshot } from "./snapshot";
import { readUpgradeAuthority, type UpgradeAuthorityCall } from "./upgrade-authority";

const diamond: Address = "0x00000000000000000000000000000000000000AA";
const alice: Address = "0x00000000000000000000000000000000000000bb";
const safe: Address = "0x00000000000000000000000000000000000000cc";
const hash: Hex = `0x${"ab".repeat(32)}`;
const ABI = parseAbi(["function owner() view returns(address)", "function safe() view returns(address)", "function hasRole(bytes32,address) view returns(bool)"]);
const cut = "diamondCut((address,uint8,bytes4[])[],address,bytes)";
function fixture(mechanism: string, getter = "AccessControl") {
  const facet = makeFacet({ name: mechanism, selectors: [cut, ...(mechanism === "SafeDiamondCut" ? ["safe()"] : [])] });
  const view = makeFacet({ name: getter, selectors: [getter.startsWith("Ownable") ? "owner()" : "hasRole(bytes32,address)"] });
  const catalog = makeCatalog({ facets: [facet, view] });
  const snapshot: DiamondSnapshot = { block: 1, blockHash: hash, code: "0x6000", facets: [facet, view].map((item) => ({ facetAddress: item.release.address, functionSelectors: item.selectors.map((selector) => selector.hex) })),
    codehashes: Object.fromEntries([facet, view].map((item) => [item.release.address.toLowerCase(), item.release.codehash])), ownerRouted: getter.startsWith("Ownable"), owner: safe };
  return { facet, view, catalog, snapshot };
}
const result = (name: "owner" | "safe" | "hasRole", value: Address | boolean) => encodeFunctionResult({ abi: ABI, functionName: name, result: value as never });

test("owner-gated cuts authenticate the getter and the actual candidate", async () => {
  const f = fixture("DiamondCutFacet", "OwnableFacet");
  const call: UpgradeAuthorityCall = async (_target, _data, options) => { expect(options.blockHash).toBe(hash); return { ok: true, value: result("owner", safe) }; };
  const owner = await readUpgradeAuthority({ chainId: 11155111, address: diamond }, f.snapshot, [f.catalog], safe, call);
  expect(owner.ok && owner.value.canSign).toBe(true);
  const stranger = await readUpgradeAuthority({ chainId: 11155111, address: diamond }, f.snapshot, [f.catalog], alice, call);
  expect(stranger.ok && stranger.value.canSign).toBe(false);
  expect(stranger.ok && stranger.value.kind).toBe("owner");
});

test("AccessControl uses DEFAULT_ADMIN_ROLE instead of an unrelated owner", async () => {
  const f = fixture("AccessControlDiamondCut"); let calldata = "";
  const authority = await readUpgradeAuthority({ chainId: 11155111, address: diamond }, f.snapshot, [f.catalog], alice, async (_target, data) => { calldata = data; return { ok: true, value: result("hasRole", true) }; });
  expect(authority.ok && authority.value.canSign).toBe(true); expect(authority.ok && authority.value.kind).toBe("role");
  expect(calldata.slice(10, 74)).toBe("0".repeat(64));
});

test("a legitimate governed executor may proceed and other callers get the governance explanation", async () => {
  const f = fixture("GovernedDiamondCut");
  for (const granted of [true, false]) {
    const authority = await readUpgradeAuthority({ chainId: 11155111, address: diamond }, f.snapshot, [f.catalog], alice, async () => ({ ok: true, value: result("hasRole", granted) }));
    expect(authority.ok && authority.value.canSign).toBe(granted);
    if (authority.ok && !granted) expect(authority.value.explanation).toContain("governance");
  }
});

test("Safe-gated cuts pin the Safe from the same authenticated mechanism", async () => {
  const f = fixture("SafeDiamondCut");
  for (const candidate of [alice, safe]) {
    const authority = await readUpgradeAuthority({ chainId: 11155111, address: diamond }, f.snapshot, [f.catalog], candidate, async () => ({ ok: true, value: result("safe", safe) }));
    expect(authority.ok && authority.value.canSign).toBe(candidate === safe);
    expect(authority.ok && authority.value.holder).toBe(safe);
  }
});

test("forged getter metadata cannot authenticate owner/role authority", async () => {
  const f = fixture("AccessControlDiamondCut");
  const snapshot = { ...f.snapshot, codehashes: { ...f.snapshot.codehashes, [f.view.release.address.toLowerCase()]: hash } };
  let calls = 0;
  const authority = await readUpgradeAuthority({ chainId: 11155111, address: diamond }, snapshot, [f.catalog], alice, async () => { calls++; return { ok: true, value: result("hasRole", true) }; });
  expect(authority.ok && authority.value.canSign).toBe(false); expect(calls).toBe(0);
});

test("custom cut authority stays explicitly unknown, and timelocked scheduling never becomes a direct cut", async () => {
  const f = fixture("CustomFacet");
  const custom = await readUpgradeAuthority({ chainId: 11155111, address: diamond }, f.snapshot, [f.catalog], alice, async () => { throw new Error("Not called"); });
  expect(custom.ok && custom.value.kind).toBe("custom"); expect(custom.ok && custom.value.authenticated).toBe(false);
  const delayed = makeFacet({ name: "GovernedSafeDiamondCut", selectors: ["scheduleCut((address,uint8,bytes4[])[],address,bytes,bytes32)"] });
  const snapshot = { ...f.snapshot, facets: [{ facetAddress: delayed.release.address, functionSelectors: delayed.selectors.map((item) => item.hex) }], codehashes: { [delayed.release.address.toLowerCase()]: delayed.release.codehash } };
  const blocked = await readUpgradeAuthority({ chainId: 11155111, address: diamond }, snapshot, [makeCatalog({ facets: [delayed] })], alice, async () => { throw new Error("Not called"); });
  expect(blocked.ok).toBe(false); if (!blocked.ok) expect(blocked.error).toContain("timelock");
});

test("unavailable or malformed authority reads fail without provider secret text", async () => {
  const f = fixture("SafeDiamondCut");
  for (const call of [async () => { throw new Error("https://private.example/secret"); }, async () => ({ ok: true as const, value: "0x1234" as Hex })]) {
    const failed = await readUpgradeAuthority({ chainId: 11155111, address: diamond }, f.snapshot, [f.catalog], alice, call);
    expect(failed.ok).toBe(false); expect(JSON.stringify(failed)).not.toContain("secret");
  }
});

test("authority getters from incompatible catalog versions don't authenticate a known mechanism", async () => {
  for (const [mechanism, getter] of [["DiamondCutFacet", "OwnableFacet"], ["AccessControlDiamondCut", "AccessControl"], ["GovernedDiamondCut", "AccessControl"]]) {
    const f = fixture(mechanism!, getter!);
    const cutOnly = makeCatalog({ facets: [f.facet] });
    const getterOnly = makeCatalog({ facets: [f.view] });
    let calls = 0;
    const authority = await readUpgradeAuthority({ chainId: 11155111, address: diamond }, f.snapshot, [cutOnly, getterOnly], alice, async () => { calls++; return { ok: true, value: result("hasRole", true) }; });
    expect(authority.ok && authority.value.authenticated).toBe(false);
    expect(authority.ok && authority.value.canSign).toBe(false); expect(calls).toBe(0);
  }
});
