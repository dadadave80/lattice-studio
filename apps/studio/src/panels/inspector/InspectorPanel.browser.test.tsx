import type { Deployment, Project } from "@lattice-studio/core";
import { analyze, formatAddress } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import {
  command, commandRef, commandState, doc, inspectorViewComponent, putDeployment, runCommand, session, type InspectorView,
} from "@/contracts";
import { bufferedServices, fakeChainService, fixtureCatalog, overrideCommands, renderWithStudio } from "../../../test/harness";
import { clearInspectorFocus, pendingInspectorFocus, requestInspectorFocus } from "./focus-request";
import { InspectorPanel } from "./InspectorPanel";

const SEPOLIA = 11155111;

afterEach(() => {
  clearInspectorFocus();
});

function project(facets: string[], id = "inspector-frame"): Project {
  return makeProject({ id, name: "Frame test", recipe: makeRecipe({ facets }, fixtureCatalog()) });
}

function shownKind(): string | undefined {
  return document.querySelector<HTMLElement>("[data-inspector-view]")?.dataset.inspectorView;
}

function setView(view: InspectorView): void {
  session.set((s) => ({ panes: { ...s.panes, inspector: { ...s.panes.inspector, view } } }));
}

/** Waits for a view to render; the first one loads the views' chunk, which takes a moment on a cold run. */
async function viewShown(kind: string): Promise<void> {
  await vi.waitFor(() => expect(document.querySelector(`[data-view="${kind}"]`)).not.toBeNull(), { timeout: 5000 });
}

function inspectorView(): InspectorView {
  return session.get().panes.inspector.view;
}

describe("view routing", () => {
  test("nothing selected shows the Diamond view", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["ERC20"]) });
    await viewShown("diamond");
    expect(shownKind()).toBe("diamond");
  });

  test("one selected card shows its Facet view, several the Selection view", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["ERC20", "Receive"]), session: { selection: ["ERC20"] } });
    await viewShown("facet");
    await expect.element(page.getByRole("heading", { level: 2, name: "ERC20" })).toBeVisible();
    session.set({ selection: ["ERC20", "Receive"] });
    await viewShown("selection");
  });

  test("an explicit view a command routed here wins over the selection", async () => {
    await renderWithStudio(<InspectorPanel />, {
      project: project(["ERC20"]),
      session: { selection: ["ERC20"] },
    });
    setView({ kind: "preview", facet: "Governor" });
    await viewShown("preview");
    expect(shownKind()).toBe("preview");
  });

  test("a facet view whose card was removed falls back to the selection's view", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["ERC20"]) });
    setView({ kind: "facet", facet: "Governor" });
    await vi.waitFor(() => expect(shownKind()).toBe("diamond"));
  });

  test("seam views render what their owner registered: S12's problem docs", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["ERC20"]) });
    setView({ kind: "doc", code: "SEL-01" });
    await expect.element(page.getByRole("heading", { name: "Selector needs an owner" })).toBeVisible();
    expect(shownKind()).toBe("doc");
  });

  test("a seam view nobody registered yet says who builds it", async () => {
    const kind = (["confirm-addresses", "init"] as const).find((k) => inspectorViewComponent(k) === null);
    if (!kind) return; // Both owners have landed: nothing left unbuilt.
    const owner = kind === "init" ? "S5d" : "S13";
    await renderWithStudio(<InspectorPanel />, { project: project(["ERC20"]) });
    setView({ kind });
    await expect.element(page.getByText(`Not built yet · WP-${owner}`)).toBeVisible();
  });
});

describe("following the selection", () => {
  test("a routed view gives way when the selection changes on its own", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["ERC20", "Receive"]) });
    setView({ kind: "preview", facet: "Governor" });
    await viewShown("preview");
    session.set({ selection: ["Receive"] });
    expect(inspectorView()).toBeNull();
    await viewShown("facet");
    await expect.element(page.getByRole("heading", { level: 2, name: "Receive" })).toBeVisible();
  });

  test("a command that sets selection and view together keeps its view", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["ERC20"]) });
    session.set((s) => ({
      selection: ["ERC20"],
      panes: { ...s.panes, inspector: { ...s.panes.inspector, view: { kind: "problem", id: "INIT-04:ERC20" } } },
    }));
    expect(inspectorView()).toEqual({ kind: "problem", id: "INIT-04:ERC20" });
  });

  test("routing the view, then selecting in a second update of the same task, keeps the view (F8)", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["ERC20"]) });
    await Promise.resolve();
    setView({ kind: "problem", id: "INIT-04:ERC20" });
    session.set({ selection: ["ERC20"] });
    await Promise.resolve();
    expect(inspectorView()).toEqual({ kind: "problem", id: "INIT-04:ERC20" });
    // A later, separate selection change still moves the inspector on.
    session.set({ selection: [] });
    expect(inspectorView()).toBeNull();
  });

  test("the Init plan stays while the selection changes", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["ERC20", "Receive"]) });
    setView({ kind: "init" });
    session.set({ selection: ["Receive"] });
    expect(inspectorView()).toEqual({ kind: "init" });
  });
});

describe("commands", () => {
  test("inspector.show opens a placed facet, selects it and focuses the view's heading", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["ERC20", "Receive"]) });
    setView({ kind: "preview", facet: "Governor" });
    await runCommand(commandRef("inspector.show", { facet: "Receive" }), "menu");
    expect(session.get().selection).toEqual(["Receive"]);
    // An explicit view, which narrow layouts follow to open the inspector.
    expect(inspectorView()).toEqual({ kind: "facet", facet: "Receive" });
    const heading = page.getByRole("heading", { level: 2, name: "Receive" });
    await expect.element(heading).toHaveFocus();
  });

  test("inspector.show on a facet that isn't placed says why", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["ERC20"]) });
    expect(commandState(commandRef("inspector.show", { facet: "Governor" }))).toMatchObject({
      ok: false,
      reason: "Governor isn't on the sheet.",
    });
    const outcome = await runCommand(commandRef("inspector.show", { facet: "Governor" }), "console");
    expect(outcome.ok).toBe(false);
    expect(bufferedServices().log.at(-1)?.text).toBe("Governor isn't on the sheet.");
  });

  test("inspector.show without a facet opens the pane on the current view", async () => {
    await renderWithStudio(<InspectorPanel />, {
      project: project(["ERC20"]),
      session: { panes: { ...session.get().panes, inspector: { open: false, size: 316, view: null } } },
    });
    await runCommand(commandRef("inspector.show"), "palette");
    expect(session.get().panes.inspector.open).toBe(true);
    await vi.waitFor(() => expect(document.activeElement?.hasAttribute("data-inspector-heading")).toBe(true));
  });

  test("inspector.focusSelectors routes to the facet's Selectors list", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["ERC20"]) });
    await runCommand(commandRef("inspector.focusSelectors", { facet: "ERC20" }), "api");
    expect(session.get().selection).toEqual(["ERC20"]);
    expect(inspectorView()).toEqual({ kind: "facet", facet: "ERC20", focus: "selectors" });
    await vi.waitFor(() => expect(document.activeElement?.getAttribute("data-selector")).toBe(fixtureCatalog().facets.find((f) => f.name === "ERC20")?.selectors[0]?.hex), { timeout: 5000 });
    expect(commandState(commandRef("inspector.focusSelectors", { facet: "Governor" }))).toMatchObject({
      ok: false,
      reason: "Governor isn't on the sheet.",
    });
  });

  test("dependency.compare opens the options side by side as catalog previews", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["VaultCore"]) });
    await runCommand(commandRef("dependency.compare", { options: ["ERC20", "ERC4626"] }), "fix");
    expect(inspectorView()).toEqual({ kind: "preview", facet: "ERC20", compare: ["ERC20", "ERC4626"] });
    await expect.element(page.getByRole("heading", { level: 2, name: "Compare options" })).toHaveFocus();
    expect(commandState(commandRef("dependency.compare", { options: ["ERC20"] }))).toMatchObject({
      ok: false,
      reason: "Compare needs two or more options.",
    });
    expect(commandState(commandRef("dependency.compare", { options: ["ERC20", "Nope"] }))).toMatchObject({
      ok: false,
      reason: "Nope isn't in the catalog.",
    });
    expect(commandState(commandRef("dependency.compare", { options: ["ERC20", "ERC4626"] })).title).toBe("Compare options…");
  });

  test("deploy.compare opens the comparison for the record", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["ERC20"]) });
    const address = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
    await runCommand(commandRef("deploy.compare", { chainId: SEPOLIA, address }), "button");
    expect(inspectorView()).toEqual({ kind: "comparison", chainId: SEPOLIA, address });
    await expect.element(page.getByRole("heading", { level: 2, name: "Compare with the sheet" })).toHaveFocus();
    await vi.waitFor(() => expect(shownKind()).toBe("comparison"));
  });

  test("deployments.show (the status chip) opens the Diamond view at its Deployments list", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["ERC20"]), session: { selection: ["ERC20"] } });
    await runCommand(commandRef("deployments.show"), "button");
    expect(inspectorView()).toEqual({ kind: "diamond", section: "deployments" });
    expect(session.get().panes.inspector.open).toBe(true);
    await vi.waitFor(() => expect(shownKind()).toBe("diamond"));
    await expect.element(page.getByRole("heading", { level: 3, name: "Deployments" })).toHaveFocus();
  });

  test("a focus request that never finds its element expires, so it can't steal focus later", () => {
    clearInspectorFocus();
    requestInspectorFocus({ kind: "heading" });
    expect(pendingInspectorFocus()).toEqual({ kind: "heading" });
    const spy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_000);
    try {
      expect(pendingInspectorFocus()).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("keeping focus when an action inside replaces the view", () => {
  test("Remove in the Facet view: focus lands on the next view's heading", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["ERC20", "Receive"]), session: { selection: ["Receive"] } });
    await viewShown("facet");
    expect(document.querySelector('[data-view="facet"]')?.getAttribute("data-facet")).toBe("Receive");
    const remove = page.getByRole("button", { name: "Remove", exact: true });
    await remove.click();
    await vi.waitFor(() => expect(doc.get().recipe.facets).toEqual(["ERC20"]));
    await vi.waitFor(() => expect(document.activeElement?.hasAttribute("data-inspector-heading")).toBe(true), { timeout: 5000 });
  });

  test("a fix that resolves the Problem view's problem: focus lands on the next view's heading", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["VaultCore"]) });
    setView({ kind: "problem", id: "DEP-01:VaultCore+ERC4626" });
    await viewShown("problem");
    await page.getByRole("button", { name: "Place ERC4626" }).first().click();
    await vi.waitFor(() => expect(doc.get().recipe.facets).toContain("ERC4626"));
    await vi.waitFor(() => expect(document.activeElement?.hasAttribute("data-inspector-heading")).toBe(true), { timeout: 5000 });
    expect(shownKind()).not.toBe("problem");
  });

  test("Place on sheet in a catalog preview: focus lands on the placed facet's heading", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["ERC20"]) });
    setView({ kind: "preview", facet: "Receive" });
    await viewShown("preview");
    await page.getByRole("button", { name: "Place on sheet" }).click();
    await vi.waitFor(() => expect(doc.get().recipe.facets).toContain("Receive"));
    await vi.waitFor(() => expect(document.activeElement?.hasAttribute("data-inspector-heading")).toBe(true), { timeout: 5000 });
  });

  test("a view change while focus is elsewhere leaves focus alone", async () => {
    await renderWithStudio(<><button type="button">Outside</button><InspectorPanel /></>, { project: project(["ERC20"]) });
    await viewShown("diamond");
    const outside = page.getByRole("button", { name: "Outside" });
    await outside.click();
    session.set({ selection: ["ERC20"] });
    await viewShown("facet");
    await expect.element(outside).toHaveFocus();
  });
});

describe("remounting only for another view", () => {
  test("a parameter change (init's focus field) keeps the same view element", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["ERC20"]) });
    setView({ kind: "init", focus: "steps[0].name_" });
    const body = () => document.querySelector("[data-inspector-view]")?.children[0]?.nextElementSibling ?? null;
    await vi.waitFor(() => expect(shownKind()).toBe("init"));
    await vi.waitFor(() => expect(body()?.firstElementChild?.tagName).not.toBe("P"), { timeout: 5000 });
    const before = body()?.firstElementChild;
    expect(before).toBeTruthy();
    setView({ kind: "init", focus: "steps[0].symbol_" });
    await Promise.resolve();
    expect(body()?.firstElementChild).toBe(before);
  });
});

describe("cut plan footer", () => {
  test("lists [00] ADD name, address and routed/total, with ⟂ while contested", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["HyperlaneGatewayAdapter", "AxelarGatewayAdapter"]) });
    const cuts = page.getByRole("list", { name: "Cuts in order" });
    await expect.element(cuts).toBeVisible();
    const items = cuts.getByRole("listitem");
    expect(items.elements().length).toBe(2);
    // Text matchers take strings here: a RegExp from the test's realm doesn't survive into the matcher.
    const axelar = fixtureCatalog().facets.find((f) => f.name === "AxelarGatewayAdapter")?.release.address;
    if (!axelar) throw new Error("The fixture catalog lost AxelarGatewayAdapter.");
    expect(items.nth(0).element().textContent).toBe(`[00]ADDAxelarGatewayAdapter${formatAddress(axelar)}7/9 selectors⟂contested`);
    expect(items.nth(1).element().textContent).toMatch(/^\[01\]ADDHyperlaneGatewayAdapter0x.+10\/12 selectors⟂contested$/);
    await expect.element(page.getByText("2 · cut order")).toBeVisible();
  });

  test("Copy plan as JSON copies the FacetCuts and says so", async () => {
    const writes = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const p = project(["ERC20"]);
    await renderWithStudio(<InspectorPanel />, { project: p });
    await page.getByRole("button", { name: "Copy plan as JSON" }).click();
    await vi.waitFor(() => expect(writes).toHaveBeenCalledTimes(1));
    const json = JSON.parse(String(writes.mock.calls[0]?.[0])) as { recipeHash: string; facetCuts: { facet: string }[] };
    const catalog = fixtureCatalog();
    expect(json.recipeHash).toBe(analyze(p.recipe, catalog).recipeHash);
    expect(json.facetCuts.map((cut) => cut.facet)).toEqual(["ERC20"]);
    expect(bufferedServices().toast.at(-1)?.text).toBe("Copied plan");
  });

  test("an empty sheet has no plan to copy, and says why", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project([]) });
    await expect.element(page.getByText("No cuts yet. Place facets to plan the cut.")).toBeVisible();
    const button = page.getByRole("button", { name: /Copy plan as JSON/ });
    await expect.element(button).toHaveAttribute("aria-disabled", "true");
    await expect.element(button).toHaveAccessibleDescription("Place facets first");
  });

  test("the address block reads the prediction's reason until there is one", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["ERC20"]) });
    await expect.element(page.getByText("LatticeFactory · deterministic")).toBeVisible();
    await expect.element(page.getByText("Predicted")).toBeVisible();
    await expect
      .element(page.getByText("Connect a wallet to see the deploy address (it depends on the deploying account)"))
      .toBeVisible();
  });

  test("live on the selected chain: the address takes the accent, with explorer and Louper links", async () => {
    const p = project(["ERC20"], "inspector-frame-live");
    const catalog = fixtureCatalog();
    const address = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
    const record: Deployment = {
      projectId: p.id, chainId: SEPOLIA, address, path: "factory", deployer: address, salt: `0x${"11".repeat(32)}`,
      status: "confirmed", recipeHash: analyze(p.recipe, catalog).recipeHash, catalogHash: catalog.hash,
      at: "2026-09-20T10:00:00.000Z", verification: "exact_match", revision: 1,
    };
    await putDeployment(record);
    await renderWithStudio(<InspectorPanel />, { project: p, session: { chainId: SEPOLIA }, chain: fakeChainService() });
    const footer = page.getByRole("region", { name: "DiamondCut plan" });
    await expect.element(footer.getByText("Live", { exact: true })).toBeVisible();
    await expect.element(footer.getByRole("link", { name: "Open in explorer" })).toHaveAttribute(
      "href",
      `https://sepolia.etherscan.io/address/${address}`,
    );
    await expect.element(footer.getByRole("link", { name: "Open in Louper" })).toHaveAttribute(
      "href",
      `https://louper.dev/diamond/${address}?network=sepolia`,
    );
    // Next steps (spec L578): copy address, save a file copy; no governance proposal for a plain diamond.
    const writes = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await footer.getByRole("button", { name: "Copy address" }).click();
    await vi.waitFor(() => expect(writes).toHaveBeenCalledWith(address));
    expect(bufferedServices().toast.at(-1)?.text).toBe("Copied 0x71C7…976F");
    const save = vi.fn();
    overrideCommands([
      command({ id: "project.exportFile", title: () => "Save a file copy", category: "Session", enabled: () => ({ ok: true }), run: save }),
    ]);
    await footer.getByRole("button", { name: "Save a file copy" }).click();
    expect(save).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("Recommended first proposal");
  });

  test("a live governed diamond recommends its first proposal", async () => {
    const catalog = fixtureCatalog();
    const recipe = makeRecipe({ facets: ["GovernedDiamondCut", "EmergencyStop", "DiamondLoupeFacet"] }, catalog);
    const p = makeProject({ id: "inspector-frame-governed", recipe });
    const address = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
    await putDeployment({
      projectId: p.id, chainId: SEPOLIA, address, path: "factory", deployer: address, salt: `0x${"22".repeat(32)}`,
      status: "confirmed", recipeHash: analyze(recipe, catalog).recipeHash, catalogHash: catalog.hash,
      at: "2026-09-20T10:00:00.000Z", verification: "pending", revision: 1,
    });
    await renderWithStudio(<InspectorPanel />, { project: p, session: { chainId: SEPOLIA }, chain: fakeChainService() });
    await expect
      .element(page.getByText(/^Recommended first proposal: freeze the loupe selectors/))
      .toBeVisible();
  });
});

describe("narrow windows", () => {
  test("under 768 px, Fill in sits at the top of the pane while arguments are missing", async () => {
    const init = vi.fn();
    overrideCommands([
      command({ id: "init.open", title: () => "Fill in", category: "Build", enabled: () => ({ ok: true }), run: init }),
    ]);
    await page.viewport(600, 800);
    try {
      const catalog = fixtureCatalog();
      await renderWithStudio(<InspectorPanel />, {
        project: makeProject({ id: "inspector-narrow", recipe: makeRecipe({ facets: ["ERC20"], init: { kind: "steps", steps: [{ spec: "ERC20Init", args: {} }] } }, catalog) }),
      });
      const fill = page.getByRole("button", { name: "Fill in" }).first();
      await expect.element(fill).toBeVisible();
      await fill.click();
      expect(init).toHaveBeenCalledTimes(1);
    } finally {
      await page.viewport(1440, 900);
    }
  });

  test("with nothing missing there is no Fill in bar", async () => {
    await renderWithStudio(<InspectorPanel />, { project: project(["Receive"]) });
    expect(document.querySelector("[data-narrow-fill-in]")).toBeNull();
    expect(doc.get().recipe.facets).toEqual(["Receive"]);
  });
});
