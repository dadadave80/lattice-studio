import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Analysis, ConsoleLine, Deployment } from "@lattice-studio/core";
import { makeCatalog, makeFacet, makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { emptyAnalysis, getAnalysis, provideAnalysis, subscribeAnalysis } from "./analysis";
import { loadCreationCode, loadFacetDetail, setCatalogStatus } from "./catalog";
import {
  deployController, deployState, provideDeployController, seedDeployState, type DeployController, type DeployState,
} from "./deploy";
import {
  announce, bufferedServices, chainService, closeDialog, createProject, hideBanner, isOnline, listDeployments, log,
  now, openDialog, openProblemDoc, provideServices, putDeployment, showBanner, subscribeDeployments, toast,
  type BannerProps,
} from "./services";
import { doc, session } from "./stores";
import { isolateContracts } from "./test-support";

let restore: () => void;
beforeEach(() => {
  restore = isolateContracts();
});
afterEach(() => restore());

describe("held and recorded output", () => {
  test("log stamps drafts with the injected clock", () => {
    provideServices({ now: () => Date.parse("2026-09-23T12:00:00.000Z") });
    log({ tag: "Placed", text: "Placed ERC20 · 9 selectors" });
    expect(bufferedServices().log).toEqual([{ tag: "Placed", text: "Placed ERC20 · 9 selectors", at: "2026-09-23T12:00:00.000Z" }]);
    expect(now()).toBe(Date.parse("2026-09-23T12:00:00.000Z"));
  });

  test("held lines, announcements, toasts and banners replay into the real implementation", () => {
    log({ tag: "Note", text: "one", at: "t" });
    announce("Placed ERC20", { merge: "place" });
    toast({ text: "Copied 0x1234…abcd" });
    showBanner("offline", { text: "Offline. Composing works; deploy needs a connection." });
    showBanner("gone", { text: "Hidden before anyone saw it." });
    hideBanner("gone");

    const lines: ConsoleLine[] = [];
    const said: string[] = [];
    const toasts: string[] = [];
    const banners: [string, BannerProps][] = [];
    provideServices({
      log: (l) => lines.push(l),
      announce: (t) => said.push(t),
      toast: (t) => toasts.push(t.text),
      showBanner: (id, props) => banners.push([id, props]),
    });
    expect(lines.map((l) => l.text)).toEqual(["one"]);
    expect(said).toEqual(["Placed ERC20"]);
    expect(toasts).toEqual(["Copied 0x1234…abcd"]);
    expect(banners).toEqual([["offline", { text: "Offline. Composing works; deploy needs a connection." }]]);
    log({ tag: "Note", text: "two", at: "t" });
    expect(lines.map((l) => l.text)).toEqual(["one", "two"]);
  });

  test("the records keep recording after real services register (a tee), without replaying twice", () => {
    const lines: string[] = [];
    provideServices({ log: (l) => lines.push(l.text), toast: () => {}, announce: () => {}, showBanner: () => {}, hideBanner: () => {} });
    log({ tag: "Note", text: "after" });
    toast({ text: "Saved to governed-vault.lattice.json" });
    announce("Tidied 14 facets.");
    showBanner("offline", { text: "Offline." });
    expect(lines).toEqual(["after"]);
    const recorded = bufferedServices();
    expect(recorded.log.map((l) => l.text)).toEqual(["after"]);
    expect(recorded.toast.map((t) => t.text)).toEqual(["Saved to governed-vault.lattice.json"]);
    expect(recorded.announce.map(([t]) => t)).toEqual(["Tidied 14 facets."]);
    expect([...recorded.banners.keys()]).toEqual(["offline"]);
  });

  test("a disposer restores only what it provided", () => {
    const a: string[] = [];
    const b: string[] = [];
    const disposeA = provideServices({ announce: (t) => a.push(t) });
    const disposeB = provideServices({ toast: (t) => b.push(t.text) });
    disposeA();
    announce("x");
    toast({ text: "y" });
    expect(a).toEqual([]);
    expect(b).toEqual(["y"]);
    disposeB();
  });

  test("the chain service isn't built yet", async () => {
    await expect(chainService()).rejects.toThrow("Not built yet · WP-S8a");
  });
});

describe("working defaults", () => {
  test("dialogs push onto and pop off the session's stack with typed props", () => {
    openDialog("settings");
    openDialog("keyboard-shortcuts", { query: "zoom" });
    openDialog("deploy-review", { at: "progress" });
    openDialog("missing-contracts", { chainId: 11155111 });
    openDialog("settings", { group: "keyboard" });
    closeDialog("settings");
    expect(session.get().dialogs.map((d) => [d.id, d.props] as unknown)).toEqual([
      ["settings", {}],
      ["keyboard-shortcuts", { query: "zoom" }],
      ["deploy-review", { at: "progress" }],
      ["missing-contracts", { chainId: 11155111 }],
    ]);
    expect(new Set(session.get().dialogs.map((d) => d.key)).size).toBe(4);
  });

  test("openProblemDoc shows the doc in the inspector", () => {
    openProblemDoc("SEL-01");
    expect(session.get().panes.inspector.view).toEqual({ kind: "doc", code: "SEL-01" });
  });

  test("createProject opens a new document with fresh entropy, a layout and provenance", async () => {
    provideServices({ randomBytes: (n) => new Uint8Array(n).fill(0xab) });
    const created = await createProject(makeRecipe(), "GovernedVault (shared)", {
      layout: { ERC20: { x: 0, y: 0, pins: "right" } },
      provenance: { "bundle.p.asset": "link" },
    });
    expect(created.ok).toBe(true);
    expect(doc.get()).toMatchObject({
      name: "GovernedVault (shared)",
      layout: { ERC20: { x: 0, y: 0, pins: "right" } },
      provenance: { "bundle.p.asset": "link" },
      deploy: { entropy: `0x${"ab".repeat(11)}` },
    });
  });

  test("deployment records round-trip in memory and notify subscribers", async () => {
    const record: Deployment = {
      projectId: "p1", chainId: 11155111, address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", path: "factory",
      deployer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", salt: "0x01", status: "confirmed", recipeHash: "0x02",
      catalogHash: "0x03", at: "2026-09-23T12:00:00.000Z", verification: "pending", revision: 1,
    };
    const changed: string[] = [];
    const stop = subscribeDeployments((id) => changed.push(id));
    await putDeployment(record);
    stop();
    expect(changed).toEqual(["p1"]);
    expect(await listDeployments("p1")).toEqual([record]);
    expect(await listDeployments("p2")).toEqual([]);
  });

  test("connection follows navigator.onLine where there is one", () => {
    expect(isOnline()).toBe(typeof navigator === "undefined" ? true : navigator.onLine);
  });
});

describe("catalog files outside React", () => {
  test("loadFacetDetail and loadCreationCode fetch from the loaded catalog's folder", async () => {
    const catalog = makeCatalog({ lattice: { tag: "fixture", commit: "0".repeat(40) }, facets: [makeFacet({ name: "ERC20" })] });
    setCatalogStatus({
      status: "ready", id: "fixture", catalog,
      manifest: { default: "fixture", catalogs: [{ id: "fixture", tag: "fixture", commit: "0", hash: "0x00", path: "fixture/index.json" }] },
    });
    const asked: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      asked.push(url);
      if (url.endsWith("shards/ERC20.json")) {
        return new Response(JSON.stringify({ name: "ERC20", abi: [], natspec: { functions: {} }, source: { path: "src/ERC20.sol", url: "https://example.com" } }));
      }
      if (url.endsWith("code/ERC20.creation.hex")) return new Response("6080\n");
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    try {
      const detail = await loadFacetDetail("ERC20");
      expect(detail.ok && detail.value.name).toBe("ERC20");
      expect(await loadCreationCode("ERC20")).toEqual({ ok: true, value: "0x6080" });
      expect(await loadCreationCode("Nope")).toEqual({ ok: false, error: "Nope has no creation code in this catalog." });
    } finally {
      globalThis.fetch = original;
    }
    expect(asked).toEqual(["/catalog/fixture/shards/ERC20.json", "/catalog/fixture/code/ERC20.creation.hex"]);
  });
});

describe("analysis", () => {
  test("the default recomputes when the recipe changes; a provider replaces it for existing subscribers", () => {
    const seen: Analysis[] = [];
    const stop = subscribeAnalysis((a) => seen.push(a));
    const mine = { ...emptyAnalysis(), recipeHash: "0x01" as const };
    let listener: () => void = () => {};
    const dispose = provideAnalysis({ getAnalysis: () => mine, subscribe: (l) => ((listener = l), () => {}) });
    expect(getAnalysis()).toBe(mine);
    expect(seen).toEqual([mine]);
    listener();
    expect(seen).toEqual([mine]); // same object: no change
    dispose();
    stop();
    doc.load(makeProject());
    expect(getAnalysis().recipeHash).toBe("0x");
  });
});

describe("deploy controller", () => {
  test("K2's default stays idle and logs Not built yet · WP-S8c", async () => {
    const controller = await deployController();
    expect(controller.state()).toEqual({ phase: "idle" });
    controller.open();
    await controller.sign();
    expect(bufferedServices().log.map((l) => l.text)).toEqual(["Not built yet · WP-S8c", "Not built yet · WP-S8c"]);
  });

  test("a provided controller loads once, its state is mirrored, and the disposer resets the mirror", async () => {
    let loads = 0;
    let emit: (s: DeployState) => void = () => {};
    const fake = {
      state: () => ({ phase: "review" }),
      subscribe: (fn: (s: DeployState) => void) => {
        emit = fn;
        return () => {
          emit = () => {};
        };
      },
    } as unknown as DeployController;
    const dispose = provideDeployController(async () => {
      loads += 1;
      return fake;
    });
    expect(deployState().phase).toBe("idle");
    expect(await deployController()).toBe(fake);
    expect(await deployController()).toBe(fake);
    expect(loads).toBe(1);
    expect(deployState().phase).toBe("review");
    emit({ phase: "proposed", safe: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F", chainId: 11155111 });
    expect(deployState()).toMatchObject({ phase: "proposed", safe: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" });
    dispose();
    expect(deployState().phase).toBe("idle");
    emit({ phase: "live" });
    expect(deployState().phase).toBe("idle");
  });

  test("a failed chunk load can be retried", async () => {
    let attempt = 0;
    provideDeployController(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("Failed to fetch dynamically imported module");
      return { state: () => ({ phase: "idle" }), subscribe: () => () => {} } as unknown as DeployController;
    });
    await expect(deployController()).rejects.toThrow("Failed to fetch");
    await expect(deployController()).resolves.toBeDefined();
    expect(attempt).toBe(2);
  });

  test("seedDeployState sets the mirror without a controller", () => {
    const reset = seedDeployState({ phase: "pending", tx: "0x12" });
    expect(deployState()).toEqual({ phase: "pending", tx: "0x12" });
    reset();
    expect(deployState()).toEqual({ phase: "idle" });
  });
});
