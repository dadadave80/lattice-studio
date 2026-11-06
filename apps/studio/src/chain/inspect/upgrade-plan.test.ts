import { expect, test } from "bun:test";
import { keccak256 } from "viem";
import { makeCatalog, makeFacet, makeProject } from "@lattice-studio/core/testing";
import type { Catalog, Project } from "@lattice-studio/core";
import type { DiamondSnapshot } from "./snapshot";
import { createUpgradePlan, selectUpgradeCatalog, type UpgradePlanPorts } from "./upgrade-plan";

const target = { chainId: 11155111, address: "0x00000000000000000000000000000000000000AA" } as const;
const known = makeFacet({ name: "Known", selectors: ["one()"] });
const catalog = makeCatalog({ facets: [known] });
const snapshot: DiamondSnapshot = { block: 12, blockHash: `0x${"ab".repeat(32)}`, code: "0x6000", facets: [{ facetAddress: known.release.address, functionSelectors: known.selectors.map((selector) => selector.hex) }], codehashes: { [known.release.address.toLowerCase()]: known.release.codehash }, ownerRouted: false, owner: null };
function rig(overrides: Partial<UpgradePlanPorts> = {}) {
  let current = makeProject(); const prior = current; const activated: Catalog[] = []; const created: Project[] = [];
  const ports: UpgradePlanPorts = { chains: [{ id: target.chainId, testnet: true }], current: () => current,
    inspect: async () => ({ ok: true, value: snapshot }), catalogs: async () => ({ ok: true, value: [catalog] }),
    layout: () => ({}), create: async (recipe, name, options) => { current = makeProject({ id: "new-upgrade", recipe, name, upgrade: options.upgrade }); created.push(current); return { ok: true, value: current }; },
    activate: (_project, selected) => { activated.push(selected); }, ...overrides };
  return { ports, prior, created, activated, current: () => current, switchProject: () => { current = makeProject({ id: "later-project" }); } };
}

test("chooses most matching verified catalog deterministically, preserving default-first ties", () => {
  const empty = makeCatalog();
  expect(selectUpgradeCatalog(snapshot, target.address, [empty, catalog])).toBe(catalog);
  expect(selectUpgradeCatalog(snapshot, target.address, [catalog, { ...catalog }])).toBe(catalog);
  expect(selectUpgradeCatalog({ ...snapshot, codehashes: {} }, target.address, [empty, catalog])).toBe(empty);
});

test("creates an observed upgrade project with proxy hash before activating catalog/chain/navigation", async () => {
  const r = rig(); const result = await createUpgradePlan(target, r.ports);
  expect(result.ok).toBe(true); expect(r.created).toHaveLength(1); expect(r.activated).toEqual([catalog]);
  expect(r.current().upgrade?.codehashes[target.address.toLowerCase()]).toBe(keccak256(snapshot.code));
  expect(r.current().recipe.init).toEqual({ kind: "none" }); expect(r.prior.recipe.mode).toBeUndefined();
});

test("a failed save, missing code/loupe, or unavailable catalog never activates or replaces work", async () => {
  for (const patch of [
    { create: async () => ({ ok: false as const, error: "Pending save failed." }) },
    { inspect: async () => ({ ok: true as const, value: { ...snapshot, code: "0x" as const } }) },
    { inspect: async () => ({ ok: true as const, value: { ...snapshot, facets: null } }) },
    { catalogs: async () => ({ ok: false as const, error: "Catalog unavailable." }) },
  ]) {
    const r = rig(patch); expect((await createUpgradePlan(target, r.ports)).ok).toBe(false); expect(r.activated).toEqual([]); expect(r.current()).toBe(r.prior);
  }
});

test("unsupported networks, canceled work and a superseding document never create a plan", async () => {
  const r = rig(); expect((await createUpgradePlan({ ...target, chainId: 1 }, r.ports)).ok).toBe(false);
  const controller = new AbortController(); controller.abort(); expect((await createUpgradePlan(target, r.ports, controller.signal)).ok).toBe(false);
  const late = rig({ catalogs: async () => { late.switchProject(); return { ok: true, value: [catalog] }; } });
  expect((await createUpgradePlan(target, late.ports)).ok).toBe(false); expect(late.created).toEqual([]); expect(late.activated).toEqual([]);
});
