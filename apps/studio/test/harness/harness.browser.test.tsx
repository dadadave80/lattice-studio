import type { Analysis } from "@lattice-studio/core";
import { layoutSizes } from "@lattice-studio/tokens";
import { describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { createStore } from "zustand/vanilla";
import {
  applyMotion, chainService, command, DEFAULT_SETTINGS, deployState, doc, emptyAnalysis, getCatalog, layoutMetrics,
  log, provideAnalysis, provideServices, provideStores, putDeployment, session, settings, useAnalysis, useCatalog,
  useCommandState, useDeployments, useDocument, useOnline, useSession, useSettings, type SettingsState,
} from "@/contracts";
import {
  bufferedServices, fakeChainService, fakeClock, fixtureCatalog, MULTICALL3_CODEHASH, onCleanup, overrideCommands,
  renderWithStudio, seedDeployState,
} from ".";

function Probe() {
  const name = useDocument((s) => s.project.name);
  const tag = useCatalog()?.lattice.tag ?? "none";
  const wheel = useSettings((s) => s.wheel);
  const chainId = useSession((s) => s.chainId);
  return <p>{`${name} · ${tag} · ${wheel} · ${chainId ?? "no chain"}`}</p>;
}

describe("renderWithStudio", () => {
  test("seeds the document, the fixture catalog, settings, session and theme", async () => {
    await renderWithStudio(<Probe />, { settings: { wheel: "zoom" }, session: { chainId: 84532 }, theme: "draft" });
    await expect.element(page.getByText("Untitled · fixture · zoom · 84532")).toBeVisible();
    expect(getCatalog()).toBe(fixtureCatalog());
    expect(getCatalog()?.facets.length).toBe(100);
    expect(document.documentElement.dataset.theme).toBe("draft");
  });

  test("every test starts from fresh state", async () => {
    await renderWithStudio(<Probe />);
    await expect.element(page.getByText("Untitled · fixture · pan · no chain")).toBeVisible();
    expect(document.documentElement.dataset.theme).toBe("shop");
    expect(deployState()).toEqual({ phase: "idle" });
  });

  test("tokens are loaded: the theme's colors apply", async () => {
    await renderWithStudio(<Probe />, { theme: "shop" });
    const ground = getComputedStyle(document.documentElement).getPropertyValue("--lx-ground").trim();
    expect(ground.toLowerCase()).toBe("#0c0d0f");
  });

  test("mounted hooks follow stores provided after they subscribed", async () => {
    await renderWithStudio(<Probe />);
    await expect.element(page.getByText("Untitled · fixture · pan · no chain")).toBeVisible();
    const replacement = createStore<SettingsState>(() => ({ ...structuredClone(DEFAULT_SETTINGS), wheel: "zoom" }));
    const dispose = provideStores({ settings: replacement });
    await expect.element(page.getByText("Untitled · fixture · zoom · no chain")).toBeVisible();
    replacement.setState({ wheel: "pan" });
    await expect.element(page.getByText("Untitled · fixture · pan · no chain")).toBeVisible();
    dispose();
  });
});

describe("reactive reads", () => {
  function TidyButton() {
    const state = useCommandState({ id: "layout.tidy" });
    return (
      <button type="button" aria-disabled={!state.ok} title={state.ok ? undefined : state.reason}>
        {state.title}
      </button>
    );
  }

  test("useCommandState re-renders when enablement changes", async () => {
    overrideCommands([
      command({
        id: "layout.tidy",
        title: () => "Tidy",
        category: "Sheet",
        enabled: (ctx) => (ctx.session.readOnly ? { ok: false, reason: ctx.session.readOnly } : { ok: true }),
        run: () => {},
      }),
    ]);
    await renderWithStudio(<TidyButton />);
    const button = page.getByRole("button", { name: "Tidy" });
    await expect.element(button).toHaveAttribute("aria-disabled", "false");
    session.set({ readOnly: "Read-only: another tab is editing this project." });
    await expect.element(button).toHaveAttribute("aria-disabled", "true");
    await expect.element(button).toHaveAttribute("title", "Read-only: another tab is editing this project.");
  });

  test("useAnalysis(selector) re-renders only when its selection changes", async () => {
    const renders: string[] = [];
    function Hash() {
      const hash = useAnalysis((a) => a.recipeHash);
      renders.push(hash);
      return <p>{hash}</p>;
    }
    let current: Analysis = { ...emptyAnalysis(), recipeHash: "0x01" };
    let notify: () => void = () => {};
    onCleanup(provideAnalysis({ getAnalysis: () => current, subscribe: (l) => ((notify = l), () => {}) }));
    await renderWithStudio(<Hash />);
    await expect.element(page.getByText("0x01")).toBeVisible();
    const before = renders.length;
    current = { ...current, stats: { ...current.stats, facets: 3 } }; // same hash
    notify();
    current = { ...current, recipeHash: "0x02" };
    notify();
    await expect.element(page.getByText("0x02")).toBeVisible();
    expect(renders.slice(before)).toEqual(["0x02"]);
  });

  test("mounted service hooks follow a service provided after they subscribed", async () => {
    function Online() {
      return <p>{useOnline() ? "Online" : "Offline"}</p>;
    }
    await renderWithStudio(<Online />);
    await expect.element(page.getByText("Online")).toBeVisible();
    let emit: (online: boolean) => void = () => {};
    onCleanup(provideServices({ connection: { isOnline: () => true, subscribe: (l) => ((emit = l), () => {}) } }));
    const offline = { isOnline: () => false, subscribe: (l: (online: boolean) => void) => ((emit = l), () => {}) };
    onCleanup(provideServices({ connection: offline }));
    await expect.element(page.getByText("Offline")).toBeVisible();
    emit(false);
  });

  test("useDeployments reads again on mount, so records written while nothing watched show", async () => {
    await putDeployment({
      projectId: "p1", chainId: 11155111, address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", path: "factory",
      deployer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", salt: "0x01", status: "confirmed", recipeHash: "0x02",
      catalogHash: "0x03", at: "2026-09-23T12:00:00.000Z", verification: "pending", revision: 1,
    });
    function Records() {
      const records = useDeployments("p1");
      return <p>{records.status === "ready" ? `${records.deployments.length} records` : "Checking"}</p>;
    }
    await renderWithStudio(<Records />);
    await expect.element(page.getByText("1 records")).toBeVisible();
  });

  test("renderWithStudio sets data-motion from the Reduce motion setting", async () => {
    await renderWithStudio(<Probe />, { settings: { reduceMotion: "on" } });
    expect(document.documentElement.dataset.motion).toBe("reduce");
  });

  test("seedDeployState sets what deployState() reads, and it's reset after the test", () => {
    seedDeployState({ phase: "proposed", safe: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F", chainId: 11155111 });
    expect(deployState().phase).toBe("proposed");
  });

  test("reduced motion follows the setting, not only the system", () => {
    applyMotion("on");
    expect(document.documentElement.dataset.motion).toBe("reduce");
    applyMotion("off");
    expect(document.documentElement.dataset.motion).toBeUndefined();
    expect(settings.get().reduceMotion).toBe("system");
  });
});

describe("fakes", () => {
  test("fakeChainService stands behind chainService() for one test, healthy for the fixture catalog", async () => {
    const chain = fakeChainService({ down: [84532] });
    await renderWithStudio(<Probe />, { chain });
    const service = await chainService();
    const probe = await service.probe(11155111);
    if (!probe.ok) throw new Error(probe.error);
    const catalog = fixtureCatalog();
    const erc20 = catalog.facets.find((f) => f.name === "ERC20");
    expect(probe.value).toMatchObject({ name: "Sepolia", online: true, simulate: true, gasCap: "16777216" });
    expect(probe.value.multicall3?.codehash).toBe(MULTICALL3_CODEHASH);
    expect(probe.value.shared.ERC20?.codehash).toBe(erc20?.release.codehash);
    expect(probe.value.registry?.records[`ERC20@${erc20?.release.version}`]?.facet).toBe(erc20?.release.address);
    expect(service.readiness(11155111).status).toBe("ready");
    expect(await service.probe(84532)).toEqual({ ok: false, error: "Base Sepolia's public RPC isn't answering." });
    expect(await service.connect()).toEqual({ ok: false, error: "No wallet found in this browser." });
    expect(chain.calls.map((c) => c.method)).toEqual(["probe", "probe", "connect"]);
  });

  test("after the test, chainService() is back to its default", async () => {
    await expect(chainService()).rejects.toThrow("Not built yet · WP-S8a");
  });

  test("fakeClock stamps console lines and moves fake timers", async () => {
    vi.useFakeTimers();
    try {
      const clock = fakeClock({ at: "2026-09-23T12:00:00.000Z", timers: vi });
      let fired = false;
      setTimeout(() => {
        fired = true;
      }, 750);
      clock.advance(750);
      expect(fired).toBe(true);
      log({ tag: "Note", text: "Saved." });
      expect(bufferedServices().log.at(-1)?.at).toBe("2026-09-23T12:00:00.750Z");
    } finally {
      vi.useRealTimers();
    }
  });

  test("doc.subscribe sees what the harness loads", () => {
    const kinds: string[] = [];
    const stop = doc.subscribe((s) => kinds.push(s.lastChange?.kind ?? "none"));
    doc.load(doc.get());
    stop();
    expect(kinds).toEqual(["load"]);
  });
});

describe("layout metrics", () => {
  test("tokens' layoutSizes is what the app passes as core's LayoutMetrics", () => {
    expect(layoutMetrics).toBe(layoutSizes);
    expect(layoutMetrics.cardWidth).toBe(232);
  });
});
