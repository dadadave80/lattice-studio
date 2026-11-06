import { expect, test } from "bun:test";
import { encodeFunctionResult, keccak256, parseAbi, stringToHex } from "viem";
import { makeCatalog, makeFacet, makeInit, makeProject } from "@lattice-studio/core/testing";
import { reconstructUpgrade, type Address, type Project } from "@lattice-studio/core";
import type { DiamondSnapshot } from "./snapshot";
import { prepareUpgrade, type UpgradePreflightPorts } from "./upgrade-preflight";

const from: Address = "0x00000000000000000000000000000000000000AA";
const diamond: Address = "0x00000000000000000000000000000000000000bb";
const cut = makeFacet({ name: "DiamondCutFacet", family: "upgrade", selectors: ["diamondCut((address,uint8,bytes4[])[],address,bytes)"] });
const owner = makeFacet({ name: "OwnableFacet", selectors: ["owner()"] });
const added = makeFacet({ name: "Added", selectors: ["added()"] });
const init = makeInit({ name: "AddedInit", fn: "init(address)", params: [{ name: "admin", type: "address", authority: true }], initializes: [{ module: "Added" }] });
const catalog = makeCatalog({ facets: [cut, owner, added], inits: [init] });
const snapshot: DiamondSnapshot = { block: 12, blockHash: `0x${"ab".repeat(32)}`, code: "0x6000", facets: [cut, owner].map((facet) => ({ facetAddress: facet.release.address, functionSelectors: facet.selectors.map((selector) => selector.hex) })), codehashes: Object.fromEntries([cut, owner].map((facet) => [facet.release.address.toLowerCase(), facet.release.codehash])), ownerRouted: true, owner: from };
function fixture() {
  const origin = { chainId: 11155111, address: diamond, block: snapshot.block, blockHash: snapshot.blockHash, facets: snapshot.facets!, codehashes: { ...snapshot.codehashes, [diamond.toLowerCase()]: keccak256(snapshot.code) }, owner: from };
  const reconstructed = reconstructUpgrade(origin, catalog); if (!reconstructed.ok) throw new Error(reconstructed.error);
  const project = makeProject({ recipe: { ...reconstructed.value, facets: [...reconstructed.value.facets, added.name], init: { kind: "steps", steps: [{ spec: init.name, args: { admin: { $ref: "self" } } }] } }, upgrade: origin });
  const reads: string[] = [];
  const ports: UpgradePreflightPorts = { inspect: async () => ({ ok: true, value: snapshot }), catalogs: async () => ({ ok: true, value: [catalog] }), chainName: () => "Sepolia",
    call: async (_target, _data, options) => { expect(options.blockHash).toBe(snapshot.blockHash); return { ok: true, value: encodeFunctionResult({ abi: parseAbi(["function owner() view returns(address)"]), functionName: "owner", result: from }) }; },
    codeAt: async (_chainId, address, blockHash) => { expect(blockHash).toBe(snapshot.blockHash); reads.push(address); const release = [...catalog.facets, ...catalog.inits].find((item) => item.release?.address === address); return { ok: true, value: release ? stringToHex(`test:codehash:${release.name}`) : "0x" }; },
  };
  return { project, ports, reads };
}

test("prepares exact diamond cuts and only explicit new init, with actual sender/self references", async () => {
  const f = fixture(); const prepared = await prepareUpgrade({ project: f.project, catalog, from }, f.ports);
  expect(prepared.ok).toBe(true); if (!prepared.ok) throw new Error(prepared.error);
  expect(prepared.value.tx.to).toBe(diamond); expect(prepared.value.tx.data.slice(0, 10)).toBe("0x1f931c1c");
  expect(prepared.value.details.init.steps).toEqual([init.name]);
  expect(prepared.value.details.authority.canSign).toBe(true);
  expect(f.reads.sort()).toEqual([added.release.address, init.release!.address].sort());
  expect(prepared.value.plan.expectedCodehashes[diamond.toLowerCase()]).toBe(keccak256(snapshot.code));
});

test("changed baseline code/routing/owner blocks preparation before simulation or records", async () => {
  for (const patch of [{ code: "0x6001" as const }, { facets: [] }, { owner: diamond }]) {
    const f = fixture(); f.ports.inspect = async () => ({ ok: true, value: { ...snapshot, ...patch } });
    const failed = await prepareUpgrade({ project: f.project, catalog, from }, f.ports); expect(failed.ok).toBe(false); expect(f.reads).toEqual([]);
  }
});

test("missing/wrong new facet or initializer runtime code is a hard failure", async () => {
  for (const code of ["0x", "0x6001"] as const) {
    const f = fixture(); f.ports.codeAt = async () => ({ ok: true, value: code });
    expect((await prepareUpgrade({ project: f.project, catalog, from }, f.ports)).ok).toBe(false);
  }
});

test("typed init and unconfirmed authority safety survives preparation, and a pure no-op is refused", async () => {
  const f = fixture();
  const bad: Project = { ...f.project, recipe: { ...f.project.recipe, init: { kind: "steps", steps: [{ spec: init.name, args: { admin: "bad" } }] } } };
  expect((await prepareUpgrade({ project: bad, catalog, from }, f.ports)).ok).toBe(false);
  const linked: Project = { ...f.project, provenance: { "steps[0].admin": "file" }, recipe: { ...f.project.recipe, init: { kind: "steps", steps: [{ spec: init.name, args: { admin: from } }] } } };
  expect((await prepareUpgrade({ project: linked, catalog, from, context: { known: [], unconfirmed: ["steps[0].admin"] } }, f.ports)).ok).toBe(false);
  const origin = f.project.upgrade!; const rebuilt = reconstructUpgrade(origin, catalog); if (!rebuilt.ok) throw new Error(rebuilt.error);
  expect((await prepareUpgrade({ project: { ...f.project, recipe: rebuilt.value }, catalog, from }, f.ports)).ok).toBe(false);
});

test("retained foreign/self coverage is explicit when adding known facets or requested init", async () => {
  const f = fixture(); const raw = { facetAddress: diamond, functionSelectors: ["0x12345678" as const] };
  const observed = { ...snapshot, facets: [...snapshot.facets!, raw] };
  const origin = { ...f.project.upgrade!, facets: observed.facets };
  const rebuilt = reconstructUpgrade(origin, catalog); if (!rebuilt.ok) throw new Error(rebuilt.error);
  const project = { ...f.project, upgrade: origin, recipe: { ...f.project.recipe, facets: [...rebuilt.value.facets, added.name], owners: rebuilt.value.owners, facetInstances: rebuilt.value.facetInstances! } };
  f.ports.inspect = async () => ({ ok: true, value: observed });
  const prepared = await prepareUpgrade({ project, catalog, from }, f.ports);
  expect(prepared.ok).toBe(true); if (!prepared.ok) throw new Error(prepared.error);
  expect(prepared.value.details.requiresOpaqueAcknowledgement).toBe(true); expect(prepared.value.details.opaque[0]?.kind).toBe("self");
});
