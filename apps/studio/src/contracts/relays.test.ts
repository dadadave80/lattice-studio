import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Deployment } from "@lattice-studio/core";
import { loadFixtureCatalog } from "@lattice-studio/core/testing";
import { commandRef } from "./command-args";
import { loadCreationCode, loadFacetDetail, setCatalogStatus, subscribeCatalog } from "./catalog";
import { onCommandRun } from "./commands";
import { deployController, deployState, provideDeployController, seedDeployState, type DeployController, type DeployState } from "./deploy";
import { isE2EFlag } from "./e2e-flag";
import {
  provideServices, putDeployment, registerDropTarget, startCatalogDrag, subscribeCatalogDrag, subscribeDeployments,
  subscribeOnline, subscribeSaveStatus, type CatalogDrag, type DeploymentsService, type DndService, type DropTarget,
  type SaveStatus,
} from "./services";
import { session } from "./stores";
import { isolateContracts } from "./test-support";

// A consumer's module-level subscriber, attached when this file loads, before any test isolates.
const heardAtModuleLevel: (number | null)[] = [];
session.subscribe((s) => heardAtModuleLevel.push(s.chainId));

let restore: () => void;
beforeEach(() => {
  restore = isolateContracts();
});
afterEach(() => restore());

const record = (projectId: string): Deployment => ({
  projectId, chainId: 11155111, address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", path: "factory",
  deployer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", salt: "0x01", status: "confirmed", recipeHash: "0x02",
  catalogHash: "0x03", at: "2026-09-23T12:00:00.000Z", verification: "pending", revision: 1,
});

describe("service subscriptions survive provideServices", () => {
  test("deployments, save status, connection and drags: subscribe first, hear the real service after", async () => {
    const writes: string[] = [];
    const statuses: string[] = [];
    const online: boolean[] = [];
    const drags: (string | null)[] = [];
    subscribeDeployments((id) => writes.push(id));
    subscribeSaveStatus((s) => statuses.push(s.text));
    subscribeOnline((o) => online.push(o));
    subscribeCatalogDrag((d) => drags.push(d?.facet ?? null));

    let emitWrite: (id: string) => void = () => {};
    let emitStatus: (s: SaveStatus) => void = () => {};
    let emitOnline: (o: boolean) => void = () => {};
    let emitDrag: (d: CatalogDrag | null) => void = () => {};
    const records: DeploymentsService = {
      listDeployments: async () => [],
      putDeployment: async (d) => emitWrite(d.projectId),
      subscribe: (l) => ((emitWrite = l), () => (emitWrite = () => {})),
    };
    const dropped: string[] = [];
    const dnd: DndService = {
      startCatalogDrag: (facet) => emitDrag({ facet, pointerId: 1, clientX: 0, clientY: 0 }),
      registerDropTarget: (t) => ((dropTarget = t), () => (dropTarget = null)),
      subscribeDrag: (l) => ((emitDrag = l), () => (emitDrag = () => {})),
    };
    let dropTarget: DropTarget | null = null;
    // Registered before S5a's dnd lands: it must move to the real service.
    const target: DropTarget = { element: {} as Element, drop: (d) => dropped.push(d.facet) };
    registerDropTarget(target);

    const dispose = provideServices({
      deployments: records,
      projects: {
        createProject: async () => ({ ok: false, error: "no" }),
        openProject: async () => ({ ok: false, error: "no" }),
        saveStatus: () => ({ state: "saved", text: "Saved" }),
        subscribeSaveStatus: (l) => ((emitStatus = l), () => (emitStatus = () => {})),
        loadViewport: async () => null,
        saveViewport: () => {},
      },
      connection: { isOnline: () => false, subscribe: (l) => ((emitOnline = l), () => (emitOnline = () => {})) },
      dnd,
    });
    // On the switch, the current values are re-announced.
    expect(statuses).toEqual(["Saved"]);
    expect(online).toEqual([false]);

    await putDeployment(record("p1"));
    emitStatus({ state: "saving", text: "Saving…" });
    emitOnline(true);
    startCatalogDrag("ERC20", { pointerId: 1, clientX: 0, clientY: 0 });
    (dropTarget as DropTarget | null)?.drop({ facet: "ERC20", pointerId: 1, clientX: 0, clientY: 0 });
    expect(writes).toEqual(["p1"]);
    expect(statuses).toEqual(["Saved", "Saving…"]);
    expect(online).toEqual([false, true]);
    expect(drags).toContain("ERC20");
    expect(dropped).toEqual(["ERC20"]);

    // Back to K2's defaults: the same subscriptions hear the memory service again.
    dispose();
    await putDeployment(record("p2"));
    expect(writes).toEqual(["p1", "p2"]);
  });
});

describe("isolation", () => {
  test("a module-level subscriber doesn't hear a contract test's events", () => {
    const before = heardAtModuleLevel.length;
    session.set({ chainId: 84532 });
    expect(heardAtModuleLevel.length).toBe(before);
  });

  test("listeners attached in a test don't outlive it (catalog, commands)", () => {
    // Attached here and never removed: the next test's isolation sets them aside.
    subscribeCatalog(() => {
      throw new Error("leaked catalog listener");
    });
    onCommandRun(() => {
      throw new Error("leaked run listener");
    });
    expect(true).toBe(true);
  });

  test("…so this test's catalog change reaches nobody from the last one", () => {
    setCatalogStatus({ status: "error", reason: "offline" });
  });
});

describe("deploy controller loads that lose a race", () => {
  test("a load that finishes after a reset leaves the mirror alone", async () => {
    let finish: (c: DeployController) => void = () => {};
    let emit: (s: DeployState) => void = () => {};
    const late = {
      state: () => ({ phase: "live" }),
      subscribe: (fn: (s: DeployState) => void) => ((emit = fn), () => {}),
    } as unknown as DeployController;
    provideDeployController(() => new Promise((resolve) => (finish = resolve)));
    const loading = deployController();
    seedDeployState({ phase: "proposed" }); // the harness, or a test, resets while it loads
    finish(late);
    await loading;
    expect(deployState().phase).toBe("proposed");
    emit({ phase: "failed" });
    expect(deployState().phase).toBe("proposed");
  });

  test("a load that finishes after a new controller registered leaves the mirror alone", async () => {
    let finish: (c: DeployController) => void = () => {};
    const stale = { state: () => ({ phase: "live" }), subscribe: () => () => {} } as unknown as DeployController;
    provideDeployController(() => new Promise((resolve) => (finish = resolve)));
    const loading = deployController();
    provideDeployController(async () => ({ state: () => ({ phase: "idle" }), subscribe: () => () => {} }) as unknown as DeployController);
    finish(stale);
    await loading;
    expect(deployState().phase).toBe("idle");
  });
});

describe("catalog names resolve as core's missing-contract deploys do", () => {
  const fixture = loadFixtureCatalog();
  test.skipIf(!fixture.ok)("a library (PoseidonT3) and an init by contract (DiamondIntrospectionInit)", async () => {
    if (!fixture.ok) return;
    setCatalogStatus({ status: "ready", id: "fixture", catalog: fixture.value, manifest: null });
    const asked: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      asked.push(url);
      return new Response("0x6080");
    }) as unknown as typeof fetch;
    try {
      expect(await loadCreationCode("PoseidonT3")).toEqual({ ok: true, value: "0x6080" });
      expect(await loadCreationCode("DiamondIntrospectionInit")).toEqual({ ok: true, value: "0x6080" });
      expect(await loadCreationCode("DiamondIntrospectionInit.initImmutable")).toEqual({ ok: true, value: "0x6080" });
      expect(await loadFacetDetail("PoseidonT3")).toEqual({ ok: false, error: "PoseidonT3 has no ABI shard in this catalog." });
    } finally {
      globalThis.fetch = original;
    }
    expect(asked).toEqual([
      "/catalog/fixture/code/PoseidonT3.creation.hex",
      "/catalog/fixture/code/DiamondIntrospectionInit.creation.hex",
      "/catalog/fixture/code/DiamondIntrospectionInit.creation.hex",
    ]);
  });
});

describe("typed command refs and the E2E flag", () => {
  test("commandRef builds refs the command-args table checks", () => {
    expect(commandRef("region.focus", { region: "inspector" })).toEqual({ id: "region.focus", args: { region: "inspector" } });
    expect(commandRef("history.undo")).toEqual({ id: "history.undo" });
  });

  test("any non-empty VITE_STUDIO_E2E is E2E, the same rule the build guard uses", () => {
    expect([isE2EFlag("1"), isE2EFlag("true"), isE2EFlag("0"), isE2EFlag(""), isE2EFlag(undefined)]).toEqual([
      true, true, true, false, false,
    ]);
  });
});
