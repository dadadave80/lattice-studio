import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { makeCatalog, makeProject } from "@lattice-studio/core/testing";
import type { ExportFile } from "@lattice-studio/core";
import { defineCommands, doc, history, provideServices, runCommand, session, setCatalogStatus } from "@/contracts";
import { bufferedServices } from "@/contracts/services";
import { isolateContracts } from "@/contracts/test-support";
import { setDownloader } from "@/panels/console/download";
import { fakeChainService } from "../../../test/harness/chain";
import { createInspectionApp, setInspectionApp } from "./app";
import { INSPECTION_COMMANDS } from "./commands";

const TARGET = { chainId: 11155111, address: "0x00000000000000000000000000000000000000AA" } as const;
const FACET = "0x00000000000000000000000000000000000000bb";
let restore: () => void;
let stopApp: () => void;
let stopDownload: () => void;
let files: ExportFile[];
let app: ReturnType<typeof createInspectionApp>;

beforeEach(() => {
  restore = isolateContracts();
  defineCommands(INSPECTION_COMMANDS);
  const catalog = makeCatalog();
  setCatalogStatus({ status: "ready", id: catalog.lattice.tag, catalog, manifest: null });
  doc.load(makeProject());
  const chain = fakeChainService({ catalog, facets: { [TARGET.address]: [{ facetAddress: FACET, functionSelectors: ["0x12345678"] }] } });
  provideServices({ chain: async () => chain, connection: { isOnline: () => true, subscribe: () => () => {} } });
  app = createInspectionApp({
    chains: chain.chains(), chain: async () => chain, catalogs: async () => ({ ok: true, value: [catalog] }),
    show: (target) => session.set((state) => ({ panes: { ...state.panes, inspector: { ...state.panes.inspector, view: { kind: "deployed", ...target } } } })),
  });
  stopApp = setInspectionApp(app);
  files = [];
  stopDownload = setDownloader((file) => { files.push(file); });
});

afterEach(() => { stopDownload(); stopApp(); restore(); });

describe("inspection commands", () => {
  test("opens and closes inspection without changing document or undo history", async () => {
    const project = doc.get();
    const before = [history.canUndo, history.canRedo];
    await runCommand({ id: "inspect.open", args: { target: `${TARGET.chainId}:${TARGET.address}` } }, "api");
    expect(session.get().panes.inspector.view).toEqual({ kind: "deployed", ...TARGET });
    expect(doc.get()).toBe(project);
    expect([history.canUndo, history.canRedo]).toEqual(before);
    await runCommand({ id: "inspect.close" }, "button");
    expect(session.get().panes.inspector.view).toEqual({ kind: "diamond" });
    expect(doc.get()).toBe(project);
    expect([history.canUndo, history.canRedo]).toEqual(before);
  });

  test("exports exact shared-passport JSON bytes and reports missing observations", async () => {
    await runCommand({ id: "inspect.exportPassport", args: TARGET }, "button");
    expect(files).toEqual([]);
    expect(bufferedServices().log.at(-1)?.text).toBe("Inspect the diamond before downloading its passport.");
    await app.engine.ensure(TARGET);
    const state = app.engine.get(TARGET);
    if (!("value" in state)) throw new Error("No observation.");
    await runCommand({ id: "inspect.exportPassport", args: TARGET }, "button");
    expect(files).toHaveLength(1);
    expect(files[0]?.mime).toBe("application/json");
    expect(files[0]?.text).toBe(`${JSON.stringify(state.value.passport, null, 2)}\n`);
  });

  test("reports unsupported input and refresh outcomes", async () => {
    await runCommand({ id: "inspect.open", args: { target: TARGET.address } }, "api");
    expect(bufferedServices().log.at(-1)?.text).toBe("Choose a chain, or use a diamond link with a chain id.");
    await runCommand({ id: "inspect.refresh", args: TARGET }, "button");
    expect(bufferedServices().log.at(-1)?.text).toBe("Refreshed inspection at block 1.");
  });

  test("facet selection retains the deployed target and composition selection", async () => {
    await app.engine.ensure(TARGET);
    session.set({ selection: ["Local composition facet"] });
    await runCommand({ id: "inspect.selectFacet", args: { ...TARGET, facetAddress: FACET } }, "button");
    expect(session.get().panes.inspector.view).toEqual({ kind: "deployed", ...TARGET, facetAddress: FACET });
    expect(session.get().selection).toEqual(["Local composition facet"]);
    const before = session.get().panes.inspector.view;
    await runCommand({ id: "inspect.selectFacet", args: { ...TARGET, facetAddress: TARGET.address } }, "api");
    expect(bufferedServices().log.at(-1)?.text).toBe("That facet isn't routed by this diamond.");
    expect(session.get().panes.inspector.view).toBe(before);
  });
});
