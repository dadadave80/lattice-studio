import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { overrideCachedIndex } from "@/catalog";
import { installShortcuts, remapBinding, WHEREVER_SINGLE_KEYS } from "@/commands";
import {
  command, doc, getCommand, provideServices, registerDropTarget, session, setCatalogStatus, settings, subscribeCatalogDrag,
  useCatalogStatus, type CatalogDrag,
} from "@/contracts";
import { Tour } from "@/tour/Tour";
import { resetTour, startTour } from "@/tour/tour-state";
import { overridePlatform } from "@/ui/shared/platform";
import {
  bufferedServices, fakeChainService, fixtureCatalog, healthyChainState, onCleanup, overrideCommands, renderWithStudio,
} from "../../../test/harness";
import { CatalogPanel } from "./CatalogPanel";
import { areaNodeId } from "./catalog-tree";

const row = (id: string) => document.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`);
const search = () => page.getByRole("textbox", { name: "Search" });

/**
 * A real, pointer-driven click on a row (via the browser automation protocol, not the DOM `.click()` IDL
 * method), so the browser's own focus-follows-click default action runs and keyboard tests can rely on it.
 */
async function clickRow(id: string): Promise<void> {
  const element = row(id);
  if (!element) throw new Error(`Row ${id} isn't in the DOM.`);
  await page.elementLocator(element).click();
}

/** Focuses the search field and types `text` a key at a time, the way a person would. */
async function typeQuery(text: string): Promise<void> {
  await userEvent.click(search());
  await userEvent.keyboard(text);
}

/** Replaces whatever the search field holds with `text`. */
async function replaceQuery(text: string): Promise<void> {
  await userEvent.clear(search());
  await userEvent.click(search());
  await userEvent.keyboard(text);
}

describe("Catalog search", () => {
  test("by name", async () => {
    await renderWithStudio(<CatalogPanel />);
    await typeQuery("erc4626");
    await expect.poll(() => row("ERC4626")).not.toBeNull();
    expect(row("ERC20")).toBeNull();
    expect(row(areaNodeId("access"))).toBeNull();
  });

  test("by area", async () => {
    await renderWithStudio(<CatalogPanel />);
    await typeQuery("access");
    await expect.poll(() => row("AccessControl")).not.toBeNull();
    expect(row(areaNodeId("access"))).not.toBeNull();
  });

  test("by namespace", async () => {
    await renderWithStudio(<CatalogPanel />);
    await typeQuery("lattice.storage.erc4626");
    await expect.poll(() => row("ERC4626")).not.toBeNull();
    expect(row("ERC20")).toBeNull();
  });

  test("by function name, not by the whole signature", async () => {
    await renderWithStudio(<CatalogPanel />);
    await typeQuery("transferfrom");
    await expect.poll(() => row("ERC20")).not.toBeNull();
    expect(row("ERC4626")).toBeNull();
  });

  test("by selector hex, prefix only", async () => {
    await renderWithStudio(<CatalogPanel />);
    await typeQuery("0xa9059c");
    await expect.poll(() => row("ERC20")).not.toBeNull();
    expect(row("ERC4626")).toBeNull();
  });

  test("the exact empty text, and no Retry button", async () => {
    await renderWithStudio(<CatalogPanel />);
    await typeQuery("notarealfacet123");
    await expect
      .poll(() => document.body.textContent)
      .toContain(
        "No facet matches ‘notarealfacet123’. Search covers names, areas, function names, selectors (0x…) and namespaces.",
      );
    expect(page.getByRole("button", { name: "Retry" }).query()).toBeNull();
  });

  test("the match count is announced, merged under one key while typing", async () => {
    await renderWithStudio(<CatalogPanel />);
    await typeQuery("erc4626");
    await expect.poll(() => bufferedServices().announce.at(-1)?.[0]).toBe("1 match.");
    expect(bufferedServices().announce.at(-1)?.[1]).toMatchObject({ politeness: "polite", merge: "catalog-search" });
  });
});

describe("Catalog tree keys and activation", () => {
  test("↓ then Enter places the focused facet", async () => {
    await renderWithStudio(<CatalogPanel />);
    await typeQuery("erc4626");
    await expect.poll(() => row("ERC4626")).not.toBeNull();
    await clickRow(areaNodeId("tokens"));
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(row("ERC4626"));
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => doc.get().recipe.facets).toContain("ERC4626");
    expect(bufferedServices().log.some((l) => l.text.startsWith("Placed ERC4626"))).toBe(true);
  });

  test("double-click places", async () => {
    await renderWithStudio(<CatalogPanel />);
    await typeQuery("accesscontrol");
    await expect.poll(() => row("AccessControl")).not.toBeNull();
    row("AccessControl")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await expect.poll(() => doc.get().recipe.facets).toContain("AccessControl");
  });

  test("Enter on an already-placed facet locates it instead of placing it again", async () => {
    const catalog = fixtureCatalog();
    const project = makeProject({ recipe: makeRecipe({ facets: ["ERC20"] }, catalog) });
    await renderWithStudio(<CatalogPanel />, { project });
    await typeQuery("erc20");
    await expect.poll(() => row("ERC20")).not.toBeNull();
    await clickRow("ERC20");
    await userEvent.keyboard("{Enter}");
    expect(doc.get().recipe.facets).toEqual(["ERC20"]);
    expect(bufferedServices().log.some((l) => l.text === "ERC20 is already on the sheet.")).toBe(true);
  });
});

describe("Catalog drag", () => {
  test("a pointerdown on an unplaced row starts a catalog drag with the facet and pointer", async () => {
    await renderWithStudio(<CatalogPanel />);
    await typeQuery("erc4626");
    await expect.poll(() => row("ERC4626")).not.toBeNull();
    const drags: (CatalogDrag | null)[] = [];
    onCleanup(subscribeCatalogDrag((drag) => drags.push(drag)));
    row("ERC4626")?.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 7, clientX: 120, clientY: 240, button: 0 }),
    );
    expect(drags.at(-1)).toEqual({ facet: "ERC4626", pointerId: 7, clientX: 120, clientY: 240 });
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, clientX: 120, clientY: 240 }));
  });

  function WithSheet() {
    return (
      <>
        <div data-testid="sheet" style={{ position: "fixed", right: 0, bottom: 0, width: 120, height: 120, zIndex: 1 }} />
        <CatalogPanel />
      </>
    );
  }

  test("touch: an unplaced row keeps vertical panning only, and a touch drag drops the facet on the sheet (spec L417)", async () => {
    await renderWithStudio(<WithSheet />);
    await typeQuery("erc4626");
    await expect.poll(() => row("ERC4626")).not.toBeNull();
    const target = row("ERC4626");
    if (!target) throw new Error("ERC4626 row not found");
    expect(getComputedStyle(target).touchAction).toBe("pan-y");
    const dropped: CatalogDrag[] = [];
    onCleanup(registerDropTarget({ element: page.getByTestId("sheet").element(), drop: (drag) => void dropped.push(drag) }));
    const drags: (CatalogDrag | null)[] = [];
    onCleanup(subscribeCatalogDrag((drag) => drags.push(drag)));
    const sheet = page.getByTestId("sheet").element().getBoundingClientRect();
    const x = Math.round(sheet.left + sheet.width / 2);
    const y = Math.round(sheet.top + sheet.height / 2);
    const touch = { bubbles: true, pointerId: 11, pointerType: "touch", isPrimary: true } as const;
    target.dispatchEvent(new PointerEvent("pointerdown", { ...touch, clientX: 40, clientY: 200, button: 0 }));
    expect(drags.at(-1)).toEqual({ facet: "ERC4626", pointerId: 11, clientX: 40, clientY: 200 });
    window.dispatchEvent(new PointerEvent("pointermove", { ...touch, clientX: (40 + x) / 2, clientY: 200 }));
    window.dispatchEvent(new PointerEvent("pointermove", { ...touch, clientX: x, clientY: y }));
    window.dispatchEvent(new PointerEvent("pointerup", { ...touch, clientX: x, clientY: y }));
    expect(dropped).toEqual([{ facet: "ERC4626", pointerId: 11, clientX: x, clientY: y }]);
    expect(drags.at(-1)).toBeNull();
  });

  test("touch: a vertical swipe the browser takes for scrolling cancels the drag, and nothing drops", async () => {
    await renderWithStudio(<WithSheet />);
    await typeQuery("erc4626");
    await expect.poll(() => row("ERC4626")).not.toBeNull();
    const dropped: CatalogDrag[] = [];
    onCleanup(registerDropTarget({ element: page.getByTestId("sheet").element(), drop: (drag) => void dropped.push(drag) }));
    const touch = { bubbles: true, pointerId: 12, pointerType: "touch", isPrimary: true } as const;
    row("ERC4626")?.dispatchEvent(new PointerEvent("pointerdown", { ...touch, clientX: 40, clientY: 200, button: 0 }));
    window.dispatchEvent(new PointerEvent("pointercancel", { ...touch, clientX: 40, clientY: 260 }));
    const sheet = page.getByTestId("sheet").element().getBoundingClientRect();
    window.dispatchEvent(new PointerEvent("pointerup", { ...touch, clientX: sheet.left + 10, clientY: sheet.top + 10 }));
    expect(dropped).toEqual([]);
  });

  test("a placed (ghosted) row doesn't start a drag", async () => {
    const catalog = fixtureCatalog();
    const project = makeProject({ recipe: makeRecipe({ facets: ["ERC20"] }, catalog) });
    await renderWithStudio(<CatalogPanel />, { project });
    await typeQuery("erc20");
    await expect.poll(() => row("ERC20")).not.toBeNull();
    const drags: (CatalogDrag | null)[] = [];
    onCleanup(subscribeCatalogDrag((drag) => drags.push(drag)));
    row("ERC20")?.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerId: 9, clientX: 10, clientY: 10, button: 0 }),
    );
    expect(drags).toEqual([]);
  });
});

describe("Catalog locate", () => {
  test("clicking a placed row selects it and calls sheet.locate once S4b registers", async () => {
    const located = vi.fn();
    overrideCommands([
      command<{ facet: string }>({
        id: "sheet.locate",
        title: () => "Locate",
        category: "Sheet",
        enabled: () => ({ ok: true }),
        run: (_ctx, args) => located(args.facet),
      }),
    ]);
    const catalog = fixtureCatalog();
    const project = makeProject({ recipe: makeRecipe({ facets: ["ERC20"] }, catalog) });
    await renderWithStudio(<CatalogPanel />, { project });
    await typeQuery("erc20");
    await expect.poll(() => row("ERC20")).not.toBeNull();
    row("ERC20")?.click();
    expect(session.get().selection).toEqual(["ERC20"]);
    await expect.poll(() => located.mock.calls.length).toBe(1);
    expect(located).toHaveBeenCalledWith("ERC20");
  });

  test("clicking an unplaced row previews it in the inspector instead", async () => {
    await renderWithStudio(<CatalogPanel />);
    await typeQuery("erc4626");
    await expect.poll(() => row("ERC4626")).not.toBeNull();
    row("ERC4626")?.click();
    await expect.poll(() => session.get().panes.inspector.view).toEqual({ kind: "preview", facet: "ERC4626" });
  });
});

describe("Catalog focus search: / wherever single keys are active (IR L33, spec L659)", () => {
  /** The page around the catalog: a plain control, and a sheet with a focused card and a card's rows. */
  function Surroundings() {
    return (
      <>
        <button type="button">Outside</button>
        <div data-keyctx="sheet">
          <button type="button">ERC20 card</button>
          <div data-keyctx="card-rows">
            <button type="button">transfer(address,uint256)</button>
          </div>
        </div>
        <CatalogPanel />
      </>
    );
  }

  /** The real registration, through S2's real dispatcher: no fake binding stands in for it. */
  async function renderReal(): Promise<void> {
    onCleanup(overridePlatform("mac"));
    onCleanup(installShortcuts());
    await renderWithStudio(<Surroundings />);
  }

  const focusOn = (name: string) => {
    (page.getByRole("button", { name }).element() as HTMLElement).focus();
  };

  test("registered wherever single keys are active, not in the global context alone", () => {
    const registered = getCommand("catalog.focusSearch");
    expect(registered.keys).toEqual(["/"]);
    expect(registered.keyContext).toEqual([...WHEREVER_SINGLE_KEYS]);
    expect(registered.keyContext).toEqual(["global", "sheet", "card-rows"]);
  });

  test("from a global control: focuses the search field, and the / isn't typed into it", async () => {
    await renderReal();
    focusOn("Outside");
    await userEvent.keyboard("/");
    await expect.element(search()).toHaveFocus();
    await expect.element(search()).toHaveValue("");
  });

  test("from a focused card on the sheet, and from a card's rows", async () => {
    await renderReal();
    focusOn("ERC20 card");
    await userEvent.keyboard("/");
    await expect.element(search()).toHaveFocus();
    focusOn("transfer(address,uint256)");
    await userEvent.keyboard("/");
    await expect.element(search()).toHaveFocus();
  });

  test("from a tree row: nothing, since single keys never fire inside trees", async () => {
    await renderReal();
    await clickRow(areaNodeId("tokens"));
    await userEvent.keyboard("/");
    expect(document.activeElement).toBe(row(areaNodeId("tokens")));
    await expect.element(search()).not.toHaveFocus();
  });

  test("with single keys off: nothing", async () => {
    await renderReal();
    settings.set({ singleKeys: false });
    focusOn("Outside");
    await userEvent.keyboard("/");
    await expect.element(page.getByRole("button", { name: "Outside" })).toHaveFocus();
    await expect.element(search()).not.toHaveFocus();
  });

  test("after a remap: / does nothing, and the new key focuses the search", async () => {
    await renderReal();
    expect(remapBinding("catalog.focusSearch", ["j"], { platform: "mac" }).ok).toBe(true);
    focusOn("Outside");
    await userEvent.keyboard("/");
    await expect.element(page.getByRole("button", { name: "Outside" })).toHaveFocus();
    await userEvent.keyboard("j");
    await expect.element(search()).toHaveFocus();
  });

  test("/ typed in the search field is just text", async () => {
    await renderReal();
    await typeQuery("/erc20");
    await expect.element(search()).toHaveValue("/erc20");
  });
});

describe("Catalog selection follows the sheet (spec L380)", () => {
  const project = () => makeProject({ recipe: makeRecipe({ facets: ["ERC20", "Pausable"] }, fixtureCatalog()) });
  const selectedOf = (id: string) => row(id)?.getAttribute("aria-selected");

  test("selecting ERC20 on the sheet highlights its row; selecting another card moves the highlight", async () => {
    await renderWithStudio(<CatalogPanel />, { project: project() });
    await typeQuery("erc20");
    await expect.poll(() => row("ERC20")).not.toBeNull();
    expect(selectedOf("ERC20")).toBe("false");
    session.set({ selection: ["ERC20"] });
    await expect.poll(() => selectedOf("ERC20")).toBe("true");
    session.set({ selection: ["Pausable"] });
    await expect.poll(() => selectedOf("ERC20")).toBe("false");
    expect(selectedOf("ERC20Pausable")).toBe("false");
  });

  test("an unplaced row previewed here keeps its local selection until the sheet's selection changes", async () => {
    await renderWithStudio(<CatalogPanel />, { project: project(), session: { selection: ["ERC20"] } });
    await typeQuery("erc20");
    await expect.poll(() => selectedOf("ERC20")).toBe("true");
    await clickRow("ERC20Permit");
    await expect.poll(() => selectedOf("ERC20Permit")).toBe("true");
    expect(selectedOf("ERC20")).toBe("false");
    // The preview leaves the sheet's selection alone.
    expect(session.get().selection).toEqual(["ERC20"]);
    session.set({ selection: ["ERC20"] });
    await expect.poll(() => selectedOf("ERC20")).toBe("true");
    expect(selectedOf("ERC20Permit")).toBe("false");
  });

  test("moving onto a placed row with the keyboard selects its card, as the Structure tree does", async () => {
    await renderWithStudio(<CatalogPanel />, { project: project() });
    await typeQuery("erc20");
    await expect.poll(() => row("ERC20")).not.toBeNull();
    await clickRow("BridgeERC20");
    expect(session.get().selection).toEqual([]);
    const ids = [...document.querySelectorAll<HTMLElement>("[data-tree-id]")].map((r) => r.dataset.treeId);
    const steps = ids.indexOf("ERC20") - ids.indexOf("BridgeERC20");
    expect(steps).toBeGreaterThan(0);
    for (let i = 0; i < steps; i++) await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(row("ERC20"));
    await expect.poll(() => session.get().selection).toEqual(["ERC20"]);
    expect(selectedOf("ERC20")).toBe("true");
  });
});

describe("Catalog coach mark (spec L400)", () => {
  test("the tour's catalog step lands just below the search, beside the catalog's rows, not centered", async () => {
    onCleanup(resetTour);
    await renderWithStudio(
      <>
        <div style={{ position: "fixed", top: 40, left: 0, width: 280, height: 600 }} data-testid="left-pane">
          <CatalogPanel />
        </div>
        <Tour />
      </>,
    );
    startTour();
    const card = page.getByRole("group", { name: "The catalog" });
    await expect.element(card).toBeVisible();
    const pane = page.getByTestId("left-pane").element();
    const target = document.querySelector('[data-tour="catalog"]');
    if (!target) throw new Error("no catalog coach-mark target");
    expect(pane.contains(target)).toBe(true);
    const targetRect = target.getBoundingClientRect();
    const paneRect = pane.getBoundingClientRect();
    await expect.poll(() => (card.element() as HTMLElement).getBoundingClientRect().top).toBeCloseTo(targetRect.bottom + 12, 0);
    const cardRect = (card.element() as HTMLElement).getBoundingClientRect();
    expect(cardRect.left).toBeLessThan(paneRect.right);
    expect(cardRect.top).toBeGreaterThan(paneRect.top);
    expect(cardRect.top).toBeLessThan(paneRect.bottom);
  });
});

describe("Catalog areas", () => {
  test("an area folder shows how many of its facets are on the sheet", async () => {
    const catalog = fixtureCatalog();
    const project = makeProject({ recipe: makeRecipe({ facets: ["ERC20"] }, catalog) });
    await renderWithStudio(<CatalogPanel />, { project });
    await expect.poll(() => row(areaNodeId("tokens"))?.textContent).toContain("1 on sheet");
    await expect.poll(() => row(areaNodeId("access"))?.textContent).toContain("0 on sheet");
  });
});

describe("Catalog loading and error", () => {
  const placeholders = () => document.querySelector("[data-placeholder-rows]");

  test("a first visit (no cached index): loading shows placeholder rows, no tree", async () => {
    onCleanup(overrideCachedIndex(false));
    await renderWithStudio(<CatalogPanel />, { catalog: null });
    expect(document.body.textContent).toContain("Loading the catalog");
    expect(placeholders()?.children.length).toBe(6);
    expect(page.getByRole("tree").query()).toBeNull();
  });

  test("a later visit (the index is cached): no placeholder rows, still announced as loading", async () => {
    onCleanup(overrideCachedIndex(true));
    await renderWithStudio(<CatalogPanel />, { catalog: null });
    expect(document.body.textContent).toContain("Loading the catalog");
    expect(placeholders()).toBeNull();
    expect(page.getByRole("tree").query()).toBeNull();
  });

  test("an error shows the reason with Retry, which recovers the real catalog", async () => {
    function Probe() {
      const status = useCatalogStatus();
      return (
        <>
          <p>{`Status: ${status.status}`}</p>
          <CatalogPanel />
        </>
      );
    }
    await renderWithStudio(<Probe />);
    setCatalogStatus({ status: "error", reason: "manifest.json answered 500." });
    await expect.element(page.getByText("Couldn't load the catalog. manifest.json answered 500.")).toBeVisible();
    await page.getByRole("button", { name: "Retry" }).click();
    await expect.element(page.getByText("Status: ready")).toBeVisible();
  });
});

describe("Catalog availability filter", () => {
  const CHAIN_ID = 11155111;

  test("offline: disabled with the spec's reason", async () => {
    await renderWithStudio(<CatalogPanel />, { session: { chainId: CHAIN_ID } });
    window.dispatchEvent(new Event("offline"));
    await expect.element(page.getByRole("checkbox")).toHaveAttribute("aria-disabled", "true");
    await expect.element(page.getByRole("checkbox")).toHaveAccessibleDescription("Chain checks need a connection.");
    window.dispatchEvent(new Event("online"));
  });

  test("no chain selected: disabled with S8a's one-label reason, so the toggle is never a silent no-op", async () => {
    await renderWithStudio(<CatalogPanel />);
    await expect.element(page.getByRole("checkbox")).toHaveAttribute("aria-disabled", "true");
    await expect.element(page.getByRole("checkbox")).toHaveAccessibleDescription("Choose a chain first.");
  });

  test("with no chain selected, mounting the panel never touches chainService: the lazy boundary (spec D13) stays closed at first paint", async () => {
    const spy = vi.fn(async () => fakeChainService());
    onCleanup(provideServices({ chain: spy }));
    await renderWithStudio(<CatalogPanel />);
    await expect.element(page.getByRole("checkbox")).toHaveAttribute("aria-disabled", "true");
    // Give any stray microtask a turn before asserting the negative.
    await Promise.resolve();
    expect(spy).not.toHaveBeenCalled();
  });

  test("a chain is selected but not probed yet: named from the picker's synchronous list, not left generic", async () => {
    const chain = fakeChainService();
    await renderWithStudio(<CatalogPanel />, { session: { chainId: CHAIN_ID }, chain });
    await expect.element(page.getByRole("checkbox", { name: "Available on Sepolia" })).toHaveAttribute("aria-disabled", "true");
    await expect
      .element(page.getByRole("checkbox", { name: "Available on Sepolia" }))
      .toHaveAccessibleDescription("Checking Sepolia…");
  });

  test("a probed chain: an unavailable facet gets a chip, a matching one gets the release-codehash mark, and the filter narrows the tree", async () => {
    const catalog = fixtureCatalog();
    const healthy = healthyChainState(CHAIN_ID, "Sepolia", catalog);
    const chain = fakeChainService({
      catalog,
      state: { [CHAIN_ID]: { shared: { ...healthy.shared, ERC20: { present: false } } } },
    });
    await chain.probe(CHAIN_ID);
    await renderWithStudio(<CatalogPanel />, { session: { chainId: CHAIN_ID }, chain });
    await expect.element(page.getByRole("checkbox", { name: "Available on Sepolia" })).not.toHaveAttribute("aria-disabled");
    await typeQuery("erc4626");
    await expect
      .poll(() => row("ERC4626")?.querySelector('[aria-label="Code matches the release"]'))
      .not.toBeNull();
    await replaceQuery("erc20");
    await expect.poll(() => row("ERC20")?.textContent).toContain("Not on Sepolia");
    await userEvent.click(page.getByRole("checkbox", { name: "Available on Sepolia" }));
    await expect.poll(() => row("ERC20")).toBeNull();
  });
});

describe("Catalog row menu", () => {
  test("Place, Preview and Open source on GitHub, at the pinned commit", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    await renderWithStudio(<CatalogPanel />);
    await typeQuery("erc4626");
    await expect.poll(() => row("ERC4626")).not.toBeNull();
    const target = row("ERC4626");
    if (!target) throw new Error("ERC4626 row not found");
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await expect.element(page.getByRole("menuitem", { name: "Place" })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: "Preview" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Open source on GitHub" }).click();
    expect(openSpy).toHaveBeenCalledWith(
      "https://github.com/dadadave80/lattice/blob/f4a32c8330934d39bcfdffff87d35a04b7fa6a79/src/tokens/ERC4626/ERC4626.sol",
      "_blank",
      "noopener,noreferrer",
    );
    openSpy.mockRestore();
  });
});
