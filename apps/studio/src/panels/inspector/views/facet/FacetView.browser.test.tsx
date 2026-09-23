import type { Catalog, CommandId, Hex4, Project, Recipe } from "@lattice-studio/core";
import { loadTemplate } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { command, provideServices, session } from "@/contracts";
import { fakeChainService, fixtureCatalog, onCleanup, overrideCommands, renderWithStudio } from "../../../../../test/harness";
import { clearInspectorFocus, requestInspectorFocus } from "../../focus-request";
import { FacetView } from "./FacetView";

const SEPOLIA = 11155111;
const TRANSFER: Hex4 = "0xa9059cbb";
const DECIMALS: Hex4 = "0x313ce567";
const SEND_MESSAGE: Hex4 = "0xcdfe7f5c";

afterEach(() => {
  clearInspectorFocus();
});

function project(recipe: Partial<Recipe>, id: string, catalog: Catalog = fixtureCatalog()): Project {
  return makeProject({ id, name: "Facet view test", recipe: makeRecipe(recipe, catalog) });
}

function governedVault(): Recipe {
  const loaded = loadTemplate(fixtureCatalog(), "GovernedVault");
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.value.facets.includes("ERC20") ? loaded.value : { ...loaded.value, facets: [...loaded.value.facets, "ERC20"] };
}

/** A command whose run is a spy; `mock.calls[n][1]` holds the args it ran with. */
function spy(id: CommandId, title: string = id) {
  const run = vi.fn();
  overrideCommands([command({ id, title: () => title, category: "Build", enabled: () => ({ ok: true }), run })]);
  return run;
}

function argsOf(run: ReturnType<typeof vi.fn>, call = 0): unknown {
  return run.mock.calls[call]?.[1];
}

/** The value of the first spec row labelled `label`. */
function specValue(label: string): string {
  const dt = Array.from(document.querySelectorAll("[data-view] dt")).find((el) => el.textContent === label);
  return dt?.nextElementSibling?.textContent ?? "";
}

function row(hex: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-selector="${hex}"]`);
  if (!element) throw new Error(`No row for ${hex}`);
  return element;
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-selector]"));
}

async function shown(name: string): Promise<void> {
  await expect.element(page.getByRole("heading", { level: 2, name })).toBeVisible();
}

describe("spec rows", () => {
  test("ERC4626: source, version, address, namespace, slot, selectors, init and cut", async () => {
    const catalog = fixtureCatalog();
    const erc4626 = catalog.facets.find((f) => f.name === "ERC4626");
    const recipe = {
      facets: ["ERC20", "ERC4626"],
      exclude: ["0x07a2d13a" as Hex4],
      init: { kind: "steps" as const, steps: [{ spec: "ERC20Init", args: {} }, { spec: "ERC4626Init", args: {} }] },
    };
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "ERC4626" }} />, { project: project(recipe, "facet-rows-4626") });
    await shown("ERC4626");
    await expect.element(page.getByText("Facet", { exact: true })).toBeVisible();
    expect(specValue("Source")).toBe("src/tokens/ERC4626/ERC4626.sol");
    expect(specValue("Version")).toBe("0.2.0");
    expect(specValue("Address")).toBe(erc4626?.release.address);
    expect(specValue("Namespace")).toBe("lattice.storage.ERC4626 · reads lattice.storage.ERC20");
    expect(specValue("Slot")).toBe(erc4626?.storage?.slot);
    expect(specValue("Selectors")).toBe("17 exported · 1 excluded · 16 cut");
    expect(specValue("Init")).toBe("ERC4626Init · Step 2 of 3");
    expect(specValue("Cut")).toBe("ADD · 16 selectors");
    await expect.element(page.getByText(erc4626?.summary ?? "")).toBeVisible();
  });

  test("ERC20 alone: no init and nine selectors cut", async () => {
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "ERC20" }} />, { project: project({ facets: ["ERC20"] }, "facet-rows-20") });
    await shown("ERC20");
    expect(specValue("Selectors")).toBe("9 exported · 0 excluded · 9 cut");
    expect(specValue("Init")).toBe("ERC20Init");
    expect(specValue("Cut")).toBe("ADD · 9 selectors");
    expect(specValue("Namespace")).toBe("lattice.storage.ERC20");
  });

  test("a contested facet's cut carries routed/total and ⟂ in the accent, and its problems show here", async () => {
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "HyperlaneGatewayAdapter" }} />, {
      project: project({ facets: ["HyperlaneGatewayAdapter", "AxelarGatewayAdapter"] }, "facet-contested"),
    });
    await shown("HyperlaneGatewayAdapter");
    expect(specValue("Cut")).toBe("ADD · 10/12 selectors ⟂, contested");
    expect(document.querySelector("[data-contested]")).not.toBeNull();
    const sel01 = Array.from(document.querySelectorAll('[data-problem^="SEL-01"]'));
    expect(sel01.length).toBe(2);
    expect(sel01[0]?.textContent).toContain("is exported by AxelarGatewayAdapter and HyperlaneGatewayAdapter. Choose one owner.");
  });

  test("an init in a bundle reads In GovernedVaultInit (bundle)", async () => {
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "ERC4626" }} />, { project: makeProject({ id: "facet-bundle", recipe: governedVault() }) });
    await shown("ERC4626");
    expect(specValue("Init")).toBe("In GovernedVaultInit (bundle)");
  });
});

describe("selectors list", () => {
  test("each pin state dispatches what its tooltip says", async () => {
    const route = spy("selector.route", "Route");
    const exclude = spy("selector.exclude", "Exclude");
    const choose = spy("collision.choosePerSelector", "Choose per selector…");
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "ERC20" }} />, {
      project: project({ facets: ["ERC20", "ERC4626"] }, "facet-pins"),
    });
    await shown("ERC20");

    const routed = row(TRANSFER);
    // The row's text: the dense selector and its state (the hidden description follows them).
    expect(routed.textContent?.startsWith("transfer · 0xa9059cbbrouted")).toBe(true);
    await expect.element(routed).toHaveAccessibleDescription("transfer(address,uint256): routes here. Click to leave it out of the diamond.");
    await userEvent.click(routed);
    expect(argsOf(exclude)).toEqual({ selector: TRANSFER });

    const served = row(DECIMALS);
    expect(served.textContent).toContain("→ ERC4626");
    await expect.element(served).toHaveAccessibleDescription("Served by ERC4626. Click to route here instead.");
    await userEvent.click(served);
    expect(argsOf(route)).toEqual({ selector: DECIMALS, facet: "ERC20" });
    expect(choose).not.toHaveBeenCalled();
  });

  test("owner by default: Choose per selector for that one selector", async () => {
    const choose = spy("collision.choosePerSelector", "Choose per selector…");
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "ERC4626" }} />, {
      project: project({ facets: ["ERC20", "ERC4626"] }, "facet-default"),
    });
    await shown("ERC4626");
    const owner = row(DECIMALS);
    expect(owner.textContent).toContain("owner by default");
    await expect.element(owner).toHaveAccessibleDescription("Owner by default. Click to change.");
    await userEvent.click(owner);
    expect(argsOf(choose)).toEqual({ selectors: [DECIMALS] });
  });

  test("not in the diamond: include it", async () => {
    const include = spy("selector.include", "Include");
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "ERC20" }} />, {
      project: project({ facets: ["ERC20"], exclude: [TRANSFER] }, "facet-excluded"),
    });
    await shown("ERC20");
    const excluded = row(TRANSFER);
    expect(excluded.textContent).toContain("not in the diamond");
    await expect.element(excluded).toHaveAccessibleDescription("Not in the diamond. Click to route here.");
    await userEvent.click(excluded);
    expect(argsOf(include)).toEqual({ selector: TRANSFER });
  });

  test("contested: route it here", async () => {
    const route = spy("selector.route", "Route");
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "HyperlaneGatewayAdapter" }} />, {
      project: project({ facets: ["HyperlaneGatewayAdapter", "AxelarGatewayAdapter"] }, "facet-contested-pin"),
    });
    await shown("HyperlaneGatewayAdapter");
    const contested = row(SEND_MESSAGE);
    expect(contested.textContent).toContain("contested");
    await expect.element(contested).toHaveAccessibleDescription("Contested by AxelarGatewayAdapter and HyperlaneGatewayAdapter. Click to route here.");
    await userEvent.click(contested);
    expect(argsOf(route)).toEqual({ selector: SEND_MESSAGE, facet: "HyperlaneGatewayAdapter" });
  });

  test("a seam offers no route: aria-disabled with its reason, and a click runs nothing", async () => {
    const route = spy("selector.route", "Route");
    const exclude = spy("selector.exclude", "Exclude");
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "ERC20" }} />, { project: makeProject({ id: "facet-seam", recipe: governedVault() }) });
    await shown("ERC20");
    const seam = row(TRANSFER);
    expect(seam.textContent).toContain("seam");
    await expect.element(seam).toHaveAttribute("aria-disabled", "true");
    await expect.element(seam).toHaveAccessibleDescription("Seam: stays on GovernedVault because its version moves vote checkpoints with balances.");
    // An aria-disabled control isn't clickable to Playwright; dispatch the click itself.
    seam.click();
    seam.focus();
    await userEvent.keyboard(" ");
    expect(route).not.toHaveBeenCalled();
    expect(exclude).not.toHaveBeenCalled();
  });

  test("rows are at least 24 px tall", async () => {
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "ERC20" }} />, { project: project({ facets: ["ERC20"] }, "facet-size") });
    await shown("ERC20");
    for (const element of rows()) expect(element.getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
  });

  test("one Tab stop; ↑/↓/Home/End move between rows; Space and Enter act", async () => {
    const exclude = spy("selector.exclude", "Exclude");
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "ERC20" }} />, { project: project({ facets: ["ERC20"] }, "facet-keys") });
    await shown("ERC20");
    const all = rows();
    expect(all.filter((el) => el.tabIndex === 0)).toHaveLength(1);
    expect(all[0]?.tabIndex).toBe(0);

    all[0]?.focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(all[1] as HTMLElement).toHaveFocus();
    expect(all[1]?.tabIndex).toBe(0);
    expect(all[0]?.tabIndex).toBe(-1);
    await userEvent.keyboard("{End}");
    await expect.element(all[all.length - 1] as HTMLElement).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(all[all.length - 1] as HTMLElement).toHaveFocus();
    await userEvent.keyboard("{Home}");
    await expect.element(all[0] as HTMLElement).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    await expect.element(all[0] as HTMLElement).toHaveFocus();

    await userEvent.keyboard(" ");
    expect(exclude).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Enter}");
    expect(exclude).toHaveBeenCalledTimes(2);
    const first = all[0]?.dataset.selector;
    expect(argsOf(exclude, 1)).toEqual({ selector: first });
  });

  test("the filter matches signatures and hex", async () => {
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "ERC20" }} />, { project: project({ facets: ["ERC20"] }, "facet-filter") });
    await shown("ERC20");
    expect(rows()).toHaveLength(9);
    const filter = page.getByRole("textbox", { name: "Filter selectors" });
    await filter.fill("transfer");
    await vi.waitFor(() => expect(rows().map((el) => el.dataset.selector)).toEqual(expect.arrayContaining([TRANSFER, "0x23b872dd"])));
    expect(rows()).toHaveLength(2);
    await filter.fill("0x095e");
    await vi.waitFor(() => expect(rows().map((el) => el.dataset.selector)).toEqual(["0x095ea7b3"]));
    await filter.fill("nothing like it");
    await expect.element(page.getByText("No selector matches ‘nothing like it’.")).toBeVisible();
    expect(rows()).toHaveLength(0);
  });

  test("a pending selectors request focuses the first row on mount", async () => {
    requestInspectorFocus({ kind: "selectors", facet: "ERC20" });
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "ERC20", focus: "selectors" }} />, {
      project: project({ facets: ["ERC20"] }, "facet-focus"),
    });
    await shown("ERC20");
    await expect.element(rows()[0] as HTMLElement).toHaveFocus();
  });
});

describe("requires, problems and init", () => {
  test("VaultCore alone: DEP-01 with its fix and Learn more, and Requires offers Place ERC4626", async () => {
    const place = spy("facet.place", "Place ERC4626");
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "VaultCore" }} />, { project: project({ facets: ["VaultCore"] }, "facet-requires") });
    await shown("VaultCore");
    await expect.element(page.getByText("VaultCore requires ERC4626: it runs the assets behind ERC4626's shares and initializes after it.")).toBeVisible();
    const requirement = document.querySelector<HTMLElement>('[data-requirement="ERC4626"]');
    expect(requirement?.textContent).toContain("Missing");
    const button = requirement?.querySelector<HTMLElement>("button");
    expect(button?.textContent).toBe("Place ERC4626");
    await userEvent.click(button as HTMLElement);
    expect(argsOf(place)).toEqual({ facet: "ERC4626" });
    expect(requirement?.textContent).not.toContain("Compare options…");

    await page.getByRole("button", { name: "Learn more about DEP-01" }).click();
    expect(session.get().panes.inspector.view).toEqual({ kind: "doc", code: "DEP-01" });
  });

  test("a met requirement reads Met by ERC4626", async () => {
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "VaultCore" }} />, {
      project: project({ facets: ["ERC20", "ERC4626", "VaultCore"] }, "facet-requires-met"),
    });
    await shown("VaultCore");
    expect(document.querySelector('[data-requirement="ERC4626"]')?.textContent).toContain("Met by ERC4626");
  });

  test("more than one option adds Compare options…", async () => {
    const base = fixtureCatalog();
    const catalog: Catalog = {
      ...base,
      facets: base.facets.map((f) =>
        f.name === "VaultCore" ? { ...f, requires: [{ anyOf: ["ERC4626", "GovernedVault"], strength: "hard", reason: "it needs a vault" }] } : f,
      ),
    };
    const compare = spy("dependency.compare", "Compare options…");
    const place = spy("facet.place", "Place");
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "VaultCore" }} />, {
      catalog,
      project: project({ facets: ["VaultCore"] }, "facet-compare", catalog),
    });
    await shown("VaultCore");
    const requirement = document.querySelector<HTMLElement>('[data-requirement="ERC4626|GovernedVault"]');
    const buttons = Array.from(requirement?.querySelectorAll<HTMLElement>("button") ?? []);
    expect(buttons.map((b) => b.textContent)).toEqual(["Place", "Place", "Compare options…"]);
    await userEvent.click(buttons[1] as HTMLElement);
    expect(argsOf(place)).toEqual({ facet: "GovernedVault" });
    await userEvent.click(buttons[2] as HTMLElement);
    expect(argsOf(compare)).toEqual({ options: ["ERC4626", "GovernedVault"] });
  });

  test("a convention reads Convention", async () => {
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "SafeDiamondCut" }} />, {
      project: project({ facets: ["SafeDiamondCut"] }, "facet-convention"),
    });
    await shown("SafeDiamondCut");
    expect(document.querySelector('[data-requirement="EmergencyStop"]')?.textContent).toContain("Convention");
  });

  test("init steps move up and down (not past the ends) and open in the plan", async () => {
    const move = spy("init.moveStep", "Move step");
    const open = spy("init.open", "Fill in");
    const recipe = {
      facets: ["ERC20", "ERC4626"],
      init: { kind: "steps" as const, steps: [{ spec: "ERC20Init", args: {} }, { spec: "ERC4626Init", args: {} }] },
    };
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "ERC4626" }} />, { project: project(recipe, "facet-init") });
    await shown("ERC4626");
    expect(specValue("Position")).toBe("Step 2 of 3");
    const down = page.getByRole("button", { name: "Move step down" });
    await expect.element(down).toHaveAttribute("aria-disabled", "true");
    await expect.element(down).toHaveAccessibleDescription("It's already the last step.");
    down.element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(move).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Move step up" }).click();
    expect(argsOf(move)).toEqual({ path: "steps[1]", to: 0 });
    await page.getByRole("button", { name: "Fill in" }).click();
    expect(argsOf(open)).toEqual({ focus: "steps[1]" });
  });
});

describe("storage, seams and release", () => {
  test("storage lists the placed facets that share its namespaces; seams it serves list selector and reason", async () => {
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "GovernedVault" }} />, { project: makeProject({ id: "facet-seams", recipe: governedVault() }) });
    await shown("GovernedVault");
    expect(specValue("Shared with")).toContain("ERC4626");
    const transfer = document.querySelector<HTMLElement>(`[data-seam="${TRANSFER}"]`);
    expect(transfer?.textContent).toBe("transfer(address,uint256) 0xa9059cbbIts version moves vote checkpoints with balances.");
  });

  test("the source link comes from the facet's shard, at the pinned commit", async () => {
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "ERC4626" }} />, { project: project({ facets: ["ERC4626"] }, "facet-source") });
    await shown("ERC4626");
    const link = page.getByRole("link", { name: "src/tokens/ERC4626/ERC4626.sol" });
    await expect
      .element(link)
      .toHaveAttribute("href", "https://github.com/dadadave80/lattice/blob/f4a32c8330934d39bcfdffff87d35a04b7fa6a79/src/tokens/ERC4626/ERC4626.sol");
    await expect.element(page.getByText("Stateless Diamond facet for the ERC-4626 Tokenized Vault Standard.")).toBeVisible();
  });

  test("on the selected chain: not checked yet, then deployed once probed; nothing without a chain", async () => {
    const chain = fakeChainService();
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "ERC20" }} />, {
      project: project({ facets: ["ERC20"] }, "facet-chain"),
      chain,
      session: { chainId: SEPOLIA },
    });
    await shown("ERC20");
    await vi.waitFor(() => expect(specValue("Chain")).toBe("Not checked yet"));
    await chain.probe(SEPOLIA);
    await vi.waitFor(() => expect(specValue("Chain")).toBe("Deployed on Sepolia"));
    chain.setState(SEPOLIA, { shared: {} });
    await chain.probe(SEPOLIA);
    await vi.waitFor(() => expect(specValue("Chain")).toBe("Not on Sepolia"));
    session.set({ chainId: null });
    await vi.waitFor(() => expect(specValue("Chain")).toBe(""));
  });

  test("offline, chain checks need a connection", async () => {
    onCleanup(provideServices({ connection: { isOnline: () => false, subscribe: () => () => {} } }));
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "ERC20" }} />, {
      project: project({ facets: ["ERC20"] }, "facet-offline"),
      chain: true,
      session: { chainId: SEPOLIA },
    });
    await shown("ERC20");
    await vi.waitFor(() => expect(specValue("Chain")).toBe("Chain checks need a connection."));
  });
});

describe("actions", () => {
  test("Flip pins, Locate, Move to… and Remove dispatch for this facet", async () => {
    const flip = spy("layout.flipPins", "Flip pins");
    const locate = spy("sheet.locate", "Locate");
    const moveTo = spy("sheet.moveTo", "Move to…");
    const remove = spy("facet.remove", "Remove ERC20");
    await renderWithStudio(<FacetView view={{ kind: "facet", facet: "ERC20" }} />, { project: project({ facets: ["ERC20"] }, "facet-actions") });
    await shown("ERC20");
    await page.getByRole("button", { name: "Flip pins" }).click();
    expect(argsOf(flip)).toEqual({ facets: ["ERC20"] });
    await page.getByRole("button", { name: "Locate" }).click();
    expect(argsOf(locate)).toEqual({ facet: "ERC20" });
    await page.getByRole("button", { name: "Move to…" }).click();
    expect(moveTo).toHaveBeenCalledTimes(1);
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    expect(argsOf(remove)).toEqual({ facets: ["ERC20"] });
  });
});
