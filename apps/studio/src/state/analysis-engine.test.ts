import { afterEach, describe, expect, test } from "bun:test";
import type { Analysis, LineDraft, NarrateCause, Project } from "@lattice-studio/core";
import { analyze, NotImplemented, placeFacet, recipeHash } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { doc, getAnalysis, setCatalogStatus, subscribeAnalysis } from "@/contracts";
import { buildContext } from "./context";
import { settle, setupKit, type Kit } from "./testing";

let kit: Kit | null = null;
afterEach(() => {
  kit?.dispose();
  kit = null;
});

const place = (name: string, x = 0) => (p: Project) => placeFacet(p, kitCatalog(), name, { x, y: 0 });
function kitCatalog() {
  if (!kit) throw new Error("no kit");
  return kit.catalog;
}

describe("memoized analysis", () => {
  test("the same object until the recipe, catalog or context changes", () => {
    kit = setupKit();
    doc.apply("Placed ERC20", place("ERC20"));
    const first = getAnalysis();
    expect(getAnalysis()).toBe(first);
    expect(first.recipeHash).toBe(recipeHash(doc.get().recipe, kit.catalog));
    // A layout-only change keeps the recipe: same analysis object.
    doc.apply("Moved", (p) => ({ project: { ...p, layout: { ...p.layout, ERC20: { x: 80, y: 0, pins: "right" } } }, changed: true, summary: "Moved" }));
    expect(getAnalysis()).toBe(first);
    doc.apply("Placed ERC4626", place("ERC4626", 400));
    expect(getAnalysis()).not.toBe(first);
    expect(getAnalysis().stats.facets).toBe(2);
  });

  test("an equal recipe in a new object hits the hash memo", () => {
    kit = setupKit();
    doc.apply("Placed ERC20", place("ERC20"));
    const first = getAnalysis();
    doc.apply("Copy", (p) => ({ project: { ...p, recipe: structuredClone(p.recipe) }, changed: true, summary: "Copy" }));
    expect(getAnalysis()).toBe(first);
  });

  test("subscribers hear a new analysis once per change", () => {
    kit = setupKit();
    const heard: Analysis[] = [];
    const stop = subscribeAnalysis((a) => heard.push(a));
    doc.apply("Placed ERC20", place("ERC20"));
    doc.apply("Moved", (p) => ({ project: { ...p, name: "N" }, changed: true, summary: "Renamed" }));
    stop();
    expect(heard).toHaveLength(1);
  });

  test("a stubbed core degrades to an empty analysis and says so once", async () => {
    kit = setupKit({ analyze: () => { throw new NotImplemented("C2", "analyze"); } });
    doc.apply("Placed ERC20", place("ERC20"));
    expect(getAnalysis().problems).toEqual([]);
    doc.apply("Placed ERC4626", place("ERC4626", 400));
    getAnalysis();
    await settle();
    expect(kit.texts().filter((t) => t === "Analysis not built yet · WP-C2")).toHaveLength(1);
  });

  test("without a catalog the analysis is empty", () => {
    kit = setupKit({ catalog: null });
    expect(getAnalysis().recipeHash).toBe("0x");
  });
});

describe("narration", () => {
  function spyKit(): { calls: { prev: Analysis | null; next: Analysis; cause?: NarrateCause }[] } {
    const calls: { prev: Analysis | null; next: Analysis; cause?: NarrateCause }[] = [];
    kit = setupKit({
      narrate: (prev, next, cause) => {
        calls.push(cause ? { prev, next, cause } : { prev, next });
        return [{ tag: "Note", text: `narrated ${next.problems.length}` } satisfies LineDraft];
      },
    });
    return { calls };
  }

  test("an edit narrates the difference against the previous analysis, stamped", async () => {
    const { calls } = spyKit();
    await settle();
    const before = getAnalysis();
    doc.apply("Placed ERC20", place("ERC20"));
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.prev).toBe(before);
    expect(calls[0]?.cause).toEqual({ kind: "edit", label: "Placed ERC20" });
    expect(kit?.lines().at(-1)).toMatchObject({ tag: "Note", text: expect.stringMatching(/^narrated /), at: "2026-01-01T00:00:00.000Z" });
  });

  test("undo and redo narrate with their cause", async () => {
    const { calls } = spyKit();
    doc.apply("Placed ERC20", place("ERC20"));
    await settle();
    doc.undo();
    await settle();
    doc.redo();
    await settle();
    expect(calls.map((c) => c.cause?.kind)).toEqual(["edit", "undo", "redo"]);
  });

  test("a load resets the baseline: nothing narrates against the old sheet", async () => {
    const { calls } = spyKit();
    doc.apply("Placed ERC20", place("ERC20"));
    await settle();
    doc.load(makeProject({ id: "other", recipe: makeRecipe({ facets: ["ERC4626", "ERC20"] }, kitCatalog()) }));
    await settle();
    expect(calls).toHaveLength(1);
    doc.apply("Placed Receive", place("Receive", 800));
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.prev?.stats.facets).toBe(2);
  });

  test("a new catalog resets the baseline", async () => {
    const { calls } = spyKit();
    doc.apply("Placed ERC20", place("ERC20"));
    await settle();
    const catalog = kitCatalog();
    setCatalogStatus({ status: "ready", id: "fixture", catalog: { ...catalog }, manifest: null });
    await settle();
    expect(calls).toHaveLength(1);
  });

  test("real narration names new problems after the edit", async () => {
    kit = setupKit();
    doc.apply("Placed VaultCore", place("VaultCore"));
    await settle();
    expect(kit.lines().some((l) => l.tag === "Missing" && l.text.startsWith("VaultCore requires ERC4626"))).toBe(true);
    kit.clearLines();
    doc.apply("Placed ERC4626", place("ERC4626", 400));
    await settle();
    expect(kit.texts()).toContain("Dependency met: VaultCore.");
    // The analysis agrees with core's own.
    expect(getAnalysis().problems.map((p) => p.id)).toEqual(analyze(doc.get().recipe, kitCatalog(), kit.state.analysis.context()).problems.map((p) => p.id));
  });
});

describe("buildContext", () => {
  const address = "0x4B20993Bc481177ec7E8f571ceCaE8A9e22C02db";
  const other = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";

  test("unconfirmed argument paths come from link and file provenance, in a stable order", () => {
    const ctx = buildContext({
      project: { predicted: [], provenance: { "steps[1].admin": "file", "bundle.p.asset": "link", "steps[0].x": "confirmed" } },
      prediction: { status: "none", reason: "x" },
      account: null,
      deployments: [],
    });
    expect(ctx).toEqual({
      known: [],
      unconfirmed: ["bundle.p.asset", "steps[1].admin"],
      unconfirmedFrom: { "bundle.p.asset": "link", "steps[1].admin": "file" },
    });
  });

  test("known holds earlier predictions and recorded deployments; a deployment wins over a prediction", () => {
    const ctx = buildContext({
      project: { predicted: [{ chainId: 1, address }, { chainId: 11155111, address: other }], provenance: {} },
      prediction: { status: "ready", address: other, chainId: 11155111, path: "factory", scope: "every-chain", from: address, salt: "0x" },
      account: { address },
      deployments: [{
        projectId: "p", chainId: 84532, address, path: "factory", deployer: other, salt: "0x", status: "confirmed",
        recipeHash: "0x", catalogHash: "0x", at: "", verification: "pending", revision: 1,
      }],
      chainName: (id) => (id === 84532 ? "Base Sepolia" : undefined),
    });
    expect(ctx.known).toEqual([address]);
    expect(ctx.knownFrom).toEqual({ [address.toLowerCase()]: { source: "deployment", chainId: 84532, chain: "Base Sepolia" } });
    expect(ctx.refs).toEqual({ self: other, deployer: address });
  });
});
