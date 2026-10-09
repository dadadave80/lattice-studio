import type { CommandRef } from "@lattice-studio/core";
import { isCoreFacet } from "@lattice-studio/core";
import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { doc, layoutMetrics, runCommand, session, settings, useAnalysis, useCommandState, useDocument } from "@/contracts";
import { bufferedServices, fakeChainService, renderWithStudio } from "../../test/harness";
import { NEEDS_WALLET, usePrediction } from ".";
import { createSettingsStore, SETTINGS_KEY } from "./settings-store";

function CommandButton({ command }: { command: CommandRef }) {
  const state = useCommandState(command);
  return (
    <button
      type="button"
      aria-disabled={!state.ok}
      title={state.ok ? undefined : state.reason}
      onClick={() => {
        void runCommand(command, "button");
      }}
    >
      {state.title}
    </button>
  );
}

function Sheet() {
  // Cards: the recipe's facets without the core's two, as every count in the app reads.
  const facets = useDocument((s) => s.project.recipe.facets.filter((name) => !isCoreFacet(name)).length);
  const undoLabel = useDocument((s) => s.undoLabel);
  const routed = useAnalysis((a) => a.stats.routed);
  return (
    <div>
      <p>{`${facets} facets · ${routed} routed · undo: ${undoLabel ?? "none"}`}</p>
      <CommandButton command={{ id: "facet.place", args: { facet: "ERC20" } }} />
      <CommandButton command={{ id: "history.undo" }} />
      <CommandButton command={{ id: "history.redo" }} />
    </div>
  );
}

function Address() {
  const prediction = usePrediction();
  return <p>{prediction.status === "ready" ? `Address ${prediction.address}` : prediction.reason}</p>;
}

function ChainChecks() {
  const codes = useAnalysis((a) => a.problems.filter((p) => p.code.startsWith("NET-")).map((p) => p.code).join(" "));
  return <p>{`Chain checks: ${codes || "none"}`}</p>;
}

describe("S1 in the browser", () => {
  test("placing and undoing with buttons: one step each, re-rendered through selectors", async () => {
    await renderWithStudio(<Sheet />);
    await expect.element(page.getByText("0 facets · 5 routed · undo: none")).toBeVisible();
    const undo = page.getByRole("button", { name: "Undo" });
    await expect.element(undo).toHaveAttribute("aria-disabled", "true");
    await expect.element(undo).toHaveAttribute("title", "Nothing to undo");

    await page.getByRole("button", { name: "Place ERC20" }).click();
    await expect.element(page.getByText("1 facets · 14 routed · undo: Placed ERC20")).toBeVisible();
    await expect.element(undo).toHaveAttribute("aria-disabled", "false");
    expect(bufferedServices().log.map((l) => l.text)).toContain("Placed ERC20 · 9 selectors · erc7201:lattice.storage.ERC20");

    // Keyboard path: focus Undo and press Enter.
    (await undo.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("0 facets · 5 routed · undo: none")).toBeVisible();
    expect(bufferedServices().log.map((l) => l.text)).toContain("Undid: Placed ERC20.");
    await expect.element(page.getByRole("button", { name: "Redo" })).toHaveAttribute("aria-disabled", "false");
  });

  test("a read-only session disables every document command with its reason", async () => {
    await renderWithStudio(<Sheet />);
    session.set({ readOnly: "Another tab is editing this project." });
    const place = page.getByRole("button", { name: "Place ERC20" });
    await expect.element(place).toHaveAttribute("aria-disabled", "true");
    await expect.element(place).toHaveAttribute("title", "Another tab is editing this project.");
    await place.click({ force: true });
    await expect.element(page.getByText("0 facets · 5 routed · undo: none")).toBeVisible();
  });

  test("usePrediction shows why there's no address, then the address once a wallet and chain are known", async () => {
    const chain = fakeChainService({ account: { address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", chainId: 11155111, connector: "io.metamask" } });
    await renderWithStudio(<Address />, { chain });
    await expect.element(page.getByText(NEEDS_WALLET)).toBeVisible();
    session.set({ chainId: 11155111 });
    await expect.element(page.getByText(/^Address 0x[0-9a-fA-F]{40}$/)).toBeVisible();
  });

  test("the NET checks run once a chain is selected; NET-05 waits for the wallet", async () => {
    const SEPOLIA = 11155111;
    // The probe says the predicted address has code, but without an account there's no prediction to be about.
    const chain = fakeChainService({ state: { [SEPOLIA]: { shared: { LatticeFactory: { present: false } }, predictedHasCode: true } } });
    await renderWithStudio(<ChainChecks />, { chain });
    await expect.element(page.getByText("Chain checks: none")).toBeVisible();
    session.set({ chainId: SEPOLIA });
    await chain.probe(SEPOLIA);
    await expect.element(page.getByText("Chain checks: NET-03")).toBeVisible();
    chain.setAccount({ address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", chainId: SEPOLIA, connector: "io.metamask" });
    await expect.element(page.getByText("Chain checks: NET-03 NET-05")).toBeVisible();
  });

  test("with nothing selected, a keyboard placement lands at the center of the view", async () => {
    await renderWithStudio(<Sheet />);
    const id = doc.get().id;
    session.set({ viewports: { [id]: { x: -200, y: -100, zoom: 0.5 } } });
    await runCommand({ id: "facet.place", args: { facet: "Receive" } }, "palette");
    const { panes } = session.get();
    const width = window.innerWidth - panes.left.size - panes.inspector.size;
    const height = window.innerHeight - 40 - 36 - panes.console.size;
    const center = { x: (width / 2 + 200) / 0.5, y: (height / 2 + 100) / 0.5 };
    const card = doc.get().layout.Receive;
    expect(Math.abs((card?.x ?? 0) + layoutMetrics.cardWidth / 2 - center.x)).toBeLessThanOrEqual(layoutMetrics.snap);
    expect(card?.y).toBeGreaterThan(center.y - 200);
    expect(card?.y).toBeLessThan(center.y);
  });

  test("settings persist to the browser's localStorage and come back", () => {
    try {
      const first = createSettingsStore(localStorage);
      first.store.setState({ theme: "light", minimap: true });
      first.stop();
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as { theme?: string; minimap?: boolean };
      expect(stored).toMatchObject({ theme: "light", minimap: true });
      expect(createSettingsStore(localStorage).store.getState()).toMatchObject({ theme: "light", minimap: true });
    } finally {
      localStorage.removeItem(SETTINGS_KEY);
    }
  });

  test("under Vitest the app's settings stay in memory", async () => {
    await renderWithStudio(<p>settings</p>);
    settings.set({ theme: "light" });
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
  });
});
