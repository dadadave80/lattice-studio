import type { CommandRef } from "@lattice-studio/core";
import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { runCommand, session, settings, useAnalysis, useCommandState, useDocument } from "@/contracts";
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
  const facets = useDocument((s) => s.project.recipe.facets.length);
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

describe("S1 in the browser", () => {
  test("placing and undoing with buttons: one step each, re-rendered through selectors", async () => {
    await renderWithStudio(<Sheet />);
    await expect.element(page.getByText("0 facets · 0 routed · undo: none")).toBeVisible();
    const undo = page.getByRole("button", { name: "Undo" });
    await expect.element(undo).toHaveAttribute("aria-disabled", "true");
    await expect.element(undo).toHaveAttribute("title", "Nothing to undo");

    await page.getByRole("button", { name: "Place ERC20" }).click();
    await expect.element(page.getByText("1 facets · 9 routed · undo: Placed ERC20")).toBeVisible();
    await expect.element(undo).toHaveAttribute("aria-disabled", "false");
    expect(bufferedServices().log.map((l) => l.text)).toContain("Placed ERC20 · 9 selectors · erc7201:lattice.storage.ERC20");

    // Keyboard path: focus Undo and press Enter.
    (await undo.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("0 facets · 0 routed · undo: none")).toBeVisible();
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
    await expect.element(page.getByText("0 facets · 0 routed · undo: none")).toBeVisible();
  });

  test("usePrediction shows why there's no address, then the address once a wallet and chain are known", async () => {
    const chain = fakeChainService({ account: { address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", chainId: 11155111, connector: "io.metamask" } });
    await renderWithStudio(<Address />, { chain });
    await expect.element(page.getByText(NEEDS_WALLET)).toBeVisible();
    session.set({ chainId: 11155111 });
    await expect.element(page.getByText(/^Address 0x[0-9a-fA-F]{40}$/)).toBeVisible();
  });

  test("settings persist to the browser's localStorage and come back", () => {
    try {
      const first = createSettingsStore(localStorage);
      first.store.setState({ theme: "draft", minimap: true });
      first.stop();
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as { theme?: string; minimap?: boolean };
      expect(stored).toMatchObject({ theme: "draft", minimap: true });
      expect(createSettingsStore(localStorage).store.getState()).toMatchObject({ theme: "draft", minimap: true });
    } finally {
      localStorage.removeItem(SETTINGS_KEY);
    }
  });

  test("under Vitest the app's settings stay in memory", async () => {
    await renderWithStudio(<p>settings</p>);
    settings.set({ theme: "draft" });
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
  });
});
