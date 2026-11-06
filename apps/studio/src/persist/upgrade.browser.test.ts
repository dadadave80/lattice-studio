import { afterEach, expect, test, vi } from "vitest";
import { prepareUpgradeRecord, recipeHash, settleUpgradeRecord, type CreatedDeployment, type PendingUpgrade, type Recipe, type UpgradeOrigin } from "@lattice-studio/core";
import { makeRecipe } from "@lattice-studio/core/testing";
import { createProject, doc, projectDeployments, updateDeployment } from "@/contracts";
import { testPersistence } from "./testing";

const address = "0x0000000000000000000000000000000000000011";
const hash = `0x${"ab".repeat(32)}` as const;
const id = `onchain:${address}`;
const upgrade: UpgradeOrigin = { chainId: 11155111, address, block: 100, blockHash: hash,
  facets: [{ facetAddress: address, functionSelectors: ["0x12345678"] }], codehashes: { [address]: hash }, owner: null };
const recipe: Recipe = makeRecipe({ mode: "upgrade", facets: [id], owners: { "0x12345678": id },
  facetInstances: { [id]: { kind: "self", address, codehash: hash, selectors: ["0x12345678"] } } });

afterEach(() => vi.restoreAllMocks());

test("an upgrade project and honest observed record are stored before switching", async () => {
  const store = testPersistence();
  const previous = await createProject(makeRecipe(), "Existing work");
  if (!previous.ok) throw new Error(previous.error);
  const created = await createProject(recipe, "Upgrade plan", { upgrade });
  if (!created.ok) throw new Error(created.error);
  expect(created.value.upgrade).toEqual(upgrade);
  const saved = (await store.listProjects()).find((row) => row.id === created.value.id)?.project;
  expect(saved?.upgrade).toEqual(upgrade);
  expect(saved?.recipe.facets).toEqual([id]);
  expect((await store.listProjects()).some((row) => row.id === previous.value.id)).toBe(true);
  const records = await store.deployments.listDeployments(created.value.id);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ kind: "imported", status: "confirmed", recipeHash: recipeHash(recipe), block: 100 });
  expect(records[0]).not.toHaveProperty("salt");
  expect(records[0]).not.toHaveProperty("deployer");
  expect(records[0]).not.toHaveProperty("fromFile");
});

test("creating an upgrade preserves an address record owned by the earlier project", async () => {
  const store = testPersistence();
  const previous = await createProject(makeRecipe(), "Original deployment");
  if (!previous.ok) throw new Error(previous.error);
  const original: CreatedDeployment = { projectId: previous.value.id, chainId: upgrade.chainId, address, path: "factory",
    deployer: address, salt: hash, status: "confirmed", recipeHash: hash, catalogHash: hash,
    at: "2026-11-06T00:00:00Z", verification: "match", revision: 4 };
  await store.deployments.putDeployment(original);
  expect((await createProject(recipe, "Upgrade plan", { upgrade })).ok).toBe(true);
  expect(await store.deployments.listDeployments(previous.value.id)).toEqual([original]);
  expect(await projectDeployments(doc.get())).toEqual([original]);
  const exported = await store.exportProject(doc.get().id);
  expect(exported && JSON.parse(exported.text).deployments).toEqual([original]);
  expect((await store.deleteProject(previous.value.id)).ok).toBe(true);
  expect(await projectDeployments(doc.get())).toEqual([original]);
});

test("a failed observed-record insert rolls back the whole new project", async () => {
  const store = testPersistence();
  const previous = await createProject(makeRecipe(), "Current work");
  if (!previous.ok) throw new Error(previous.error);
  const before = doc.get();
  const add = IDBObjectStore.prototype.add;
  const spy = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["add"]>) {
    if (this.name === "deployments") throw new DOMException("Injected record failure", "QuotaExceededError");
    return add.apply(this, args);
  });
  expect((await createProject(recipe, "Upgrade plan", { upgrade })).ok).toBe(false);
  expect(doc.get()).toBe(before);
  spy.mockRestore();
  expect((await store.listProjects()).map((row) => row.id)).toEqual([previous.value.id]);
});

test("concurrent upgrade completions advance the shared record exactly once", async () => {
  const store = testPersistence();
  const created = await createProject(recipe, "Upgrade plan", { upgrade });
  if (!created.ok) throw new Error(created.error);
  const tx = `0x${"cd".repeat(32)}` as const;
  const nextHash = `0x${"ef".repeat(32)}` as const;
  const pending: PendingUpgrade = { phase: "pending", desiredRecipeHash: nextHash, catalogHash: hash, baseline: upgrade,
    expectedFacets: upgrade.facets, expectedCodehashes: upgrade.codehashes, from: address, since: "2026-11-06T00:00:00Z", tx };
  const started = await updateDeployment(upgrade.chainId, address, (record) => record ? prepareUpgradeRecord(record, pending) : { ok: false, error: "Missing record" });
  expect(started.ok).toBe(true);
  const baseline = (await store.deployments.listDeployments(created.value.id))[0]!;
  const { pendingUpgrade: _reservation, ...stale } = baseline;
  await store.deployments.putDeployment(stale);
  expect((await store.deployments.getDeployment(upgrade.chainId, address))?.pendingUpgrade).toEqual(pending);
  await expect(store.deployments.deleteDeployment(upgrade.chainId, address)).rejects.toThrow("unresolved upgrade");
  const finish = () => updateDeployment(upgrade.chainId, address, (record) => record ? settleUpgradeRecord(record, { hash: tx, block: 101, status: "success" }, { ...upgrade, block: 101 }) : { ok: false, error: "Missing record" });
  expect((await Promise.all([finish(), finish()])).every((result) => result.ok)).toBe(true);
  expect(await store.deployments.getDeployment(upgrade.chainId, address)).toMatchObject({ projectId: created.value.id, recipeHash: nextHash, revision: 2 });
  expect(await store.deployments.getDeployment(upgrade.chainId, address)).not.toHaveProperty("pendingUpgrade");
  await store.deployments.putDeployment(stale);
  expect((await store.deployments.getDeployment(upgrade.chainId, address))?.revision).toBe(2);
  const wrongOwner = await updateDeployment(upgrade.chainId, address, (record) => record ? { ok: true, value: { ...record, projectId: "stolen" } } : { ok: false, error: "Missing record" });
  expect(wrongOwner.ok).toBe(false);
  expect((await store.deployments.getDeployment(upgrade.chainId, address))?.projectId).toBe(created.value.id);
});

test("a failed atomic upgrade write leaves the current document and project list intact", async () => {
  const store = testPersistence();
  const previous = await createProject(makeRecipe(), "Current work");
  if (!previous.ok) throw new Error(previous.error);
  const before = doc.get();
  const put = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
    if (this.name === "projects") throw new DOMException("Injected write failure", "QuotaExceededError");
    return put.apply(this, args);
  });
  const result = await createProject(recipe, "Upgrade plan", { upgrade });
  expect(result.ok).toBe(false);
  expect(doc.get()).toBe(before);
  spy.mockRestore();
  expect((await store.listProjects()).map((row) => row.id)).toEqual([previous.value.id]);
});
