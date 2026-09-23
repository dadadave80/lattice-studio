import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Deployment } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import { doc, provideServices, provideStores, putDeployment, type DeploymentsService } from "@/contracts";
import { isolateContracts } from "@/contracts/test-support";
import { createDeploymentsMirror } from "./deployments-mirror";
import { createDocumentStore } from "./document-store";
import { settle } from "./testing";

let restore: () => void;
beforeEach(() => {
  restore = isolateContracts();
});
afterEach(() => restore());

const record: Deployment = {
  projectId: "p1", chainId: 11155111, address: "0x4B20993Bc481177ec7E8f571ceCaE8A9e22C02db", path: "factory",
  deployer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", salt: "0x", status: "confirmed", recipeHash: "0x",
  catalogHash: "0x", at: "2026-01-01T00:00:00.000Z", verification: "pending", revision: 1,
};

test("reads nothing until a project loads, then the open project's records, again after each write", async () => {
  const disposeStores = provideStores({ document: createDocumentStore() });
  const asked: string[] = [];
  const memory: Deployment[] = [];
  const listeners = new Set<(id: string) => void>();
  const service: DeploymentsService = {
    listDeployments: async (id) => {
      asked.push(id);
      return memory.filter((d) => d.projectId === id);
    },
    putDeployment: async (d) => {
      memory.push(d);
      for (const l of listeners) l(d.projectId);
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  const disposeService = provideServices({ deployments: service });
  const mirror = createDeploymentsMirror();
  const stop = mirror.start();
  await settle();
  expect(asked).toEqual([]);

  doc.load(makeProject({ id: "p1" }));
  await settle();
  expect(asked).toEqual(["p1"]);
  expect(mirror.list()).toEqual([]);

  await putDeployment(record);
  await settle();
  expect(mirror.list()).toEqual([record]);

  await putDeployment({ ...record, projectId: "p2" });
  await settle();
  expect(asked).toEqual(["p1", "p1"]);
  stop();
  disposeService();
  disposeStores();
});
