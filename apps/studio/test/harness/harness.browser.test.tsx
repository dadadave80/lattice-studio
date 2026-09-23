import { layoutSizes } from "@lattice-studio/tokens";
import { describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import {
  chainService, getCatalog, layoutMetrics, log, useCatalog, useDocument, useSession, useSettings,
} from "@/contracts";
import { bufferedServices, fakeChainService, fakeClock, fixtureCatalog, renderWithStudio } from ".";

function Probe() {
  const name = useDocument((s) => s.project.name);
  const tag = useCatalog()?.lattice.tag ?? "none";
  const wheel = useSettings((s) => s.wheel);
  const chainId = useSession((s) => s.chainId);
  return <p>{`${name} · ${tag} · ${wheel} · ${chainId ?? "no chain"}`}</p>;
}

describe("renderWithStudio", () => {
  test("seeds the document, catalog, settings, session and theme", async () => {
    await renderWithStudio(<Probe />, { settings: { wheel: "zoom" }, session: { chainId: 84532 }, theme: "draft" });
    await expect.element(page.getByText("Untitled · fixture · zoom · 84532")).toBeVisible();
    expect(getCatalog()).toBe(fixtureCatalog());
    expect(document.documentElement.dataset.theme).toBe("draft");
  });

  test("every test starts from fresh state", async () => {
    await renderWithStudio(<Probe />);
    await expect.element(page.getByText("Untitled · fixture · pan · no chain")).toBeVisible();
    expect(document.documentElement.dataset.theme).toBe("shop");
  });

  test("tokens are loaded: the theme's colors apply", async () => {
    await renderWithStudio(<Probe />, { theme: "shop" });
    const ground = getComputedStyle(document.documentElement).getPropertyValue("--lx-ground").trim();
    expect(ground.toLowerCase()).toBe("#0c0d0f");
  });
});

describe("fakes", () => {
  test("fakeChainService stands behind chainService() for one test", async () => {
    const chain = fakeChainService({ down: [84532] });
    await renderWithStudio(<Probe />, { chain });
    const service = await chainService();
    expect(await service.probe(11155111)).toMatchObject({ ok: true, value: { name: "Sepolia", online: true } });
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
});

describe("layout metrics", () => {
  test("tokens' layoutSizes is what the app passes as core's LayoutMetrics", () => {
    expect(layoutMetrics).toBe(layoutSizes);
    expect(layoutMetrics.cardWidth).toBe(232);
  });
});
