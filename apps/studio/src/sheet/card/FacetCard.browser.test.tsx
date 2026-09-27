/**
 * The facet card in React Flow (brief S4a): accessible name and description, what a pin click does, "+ n more"
 * and Collapse, the compact form, handles at C9's geometry, size and paint containment, and 1/zoom strokes.
 */
import { cardSize, contestedSelectors, type Hex4, type Project } from "@lattice-studio/core";
import type { ReactFlowInstance } from "@xyflow/react";
import { describe, expect, test } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { doc, getAnalysis, getCommand, history, layoutMetrics, runCommand, session, useSession } from "@/contracts";
import { fixtureCatalog, overrideCommands, renderWithStudio } from "../../../test/harness";
import { cardNameId, type FacetNode } from "./node";
import { CardSheet } from "./testing/CardSheet";
import { cardProject, GALLERY_FACETS } from "./testing/projects";

const SYMBOL: Hex4 = "0x95d89b41";
const catalog = fixtureCatalog();

function gallery(options: Parameters<typeof cardProject>[2] = {}): Project {
  return cardProject(catalog, GALLERY_FACETS, { exclude: [SYMBOL], ...options });
}

function card(facet: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-facet="${facet}"]`);
  if (!el) throw new Error(`No card for ${facet}.`);
  return el;
}

function row(facet: string, selector: Hex4): HTMLElement {
  const el = card(facet).querySelector<HTMLElement>(`[data-selector="${selector}"]`);
  if (!el) throw new Error(`${facet} draws no row for ${selector}.`);
  return el;
}

function wrapper(facet: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${facet}"]`);
  if (!el) throw new Error(`No node for ${facet}.`);
  return el;
}

async function sheet(project: Project, zoom = 1) {
  const screen = await renderWithStudio(<CardSheet zoom={zoom} />, { project });
  await expect.poll(() => document.querySelectorAll("[data-facet]").length).toBe(Object.keys(project.layout).length);
  return screen;
}

/** The selection, shown so a test can see it didn't change. */
function SelectionProbe() {
  const selection = useSession((s) => s.selection);
  return <output data-testid="selection">{selection.join(",")}</output>;
}

describe("accessible name and description (spec L745-L746)", () => {
  test("each card is a named 'facet card' group on React Flow's focusable wrapper", async () => {
    await sheet(gallery());
    const group = page.getByRole("group", { name: "ERC20, 9 selectors, 3 served by other facets, 1 not in the diamond" });
    await expect.element(group).toBeInTheDocument();
    expect(group.element()).toBe(wrapper("ERC20"));
    expect(wrapper("ERC20").getAttribute("aria-roledescription")).toBe("facet card");
    expect(wrapper("ERC20").tabIndex).toBe(0);
    await expect
      .element(page.getByRole("group", { name: "AxelarGatewayAdapter, 9 selectors, 2 contested" }))
      .toHaveAccessibleDescription(
        "Collides with HyperlaneGatewayAdapter on sendMessage and supportsAttribute; 2 blockers; 1 warning. Not selected.",
      );
  });

  test("the description states the selection, and follows it", async () => {
    await sheet(gallery());
    const vault = page.getByRole("group", { name: /^VaultCore,/ });
    await expect.element(vault).toHaveAccessibleDescription(/Needs ERC4626, which isn't on the sheet;.* Not selected\.$/);
    session.set({ selection: ["VaultCore"] });
    await expect.element(vault).toHaveAccessibleDescription(/ Selected\.$/);
    expect(card("VaultCore").dataset.selected).toBe("");
  });

  test("the name follows an edit", async () => {
    await sheet(gallery());
    await userEvent.click(row("ERC20", "0xdd62ed3e"));
    await expect
      .element(page.getByRole("group", { name: "ERC20, 9 selectors, 3 served by other facets, 2 not in the diamond" }))
      .toBeInTheDocument();
    expect(document.getElementById(cardNameId("ERC20"))?.hidden).toBe(true);
  });

  test("pin rows are named by signature, hex and state, and described by what a click does", async () => {
    await sheet(gallery());
    const allowance = page.getByRole("button", { name: "allowance(address,address) 0xdd62ed3e, routes here" });
    await expect.element(allowance).toHaveAccessibleDescription(
      "allowance(address,address): routes here. Click to leave it out of the diamond.",
    );
    await expect
      .element(page.getByRole("button", { name: "name() 0x06fdde03, served by GovernedVault" }))
      .toHaveAccessibleDescription("Served by GovernedVault. Click to route here instead.");
  });
});

describe("what a pin does (Flow 6, IR L47, L104)", () => {
  test("a click leaves a routed selector out, a second brings it back; the selection doesn't change", async () => {
    await renderWithStudio(
      <>
        <CardSheet />
        <SelectionProbe />
      </>,
      { project: gallery(), session: { selection: ["VaultCore"] } },
    );
    await expect.poll(() => document.querySelectorAll("[data-facet]").length).toBe(GALLERY_FACETS.length);
    await userEvent.click(row("ERC20", "0xdd62ed3e"));
    await expect.poll(() => row("ERC20", "0xdd62ed3e").dataset.state).toBe("excluded");
    expect(doc.get().recipe.exclude).toContain("0xdd62ed3e");
    await expect.element(page.getByTestId("selection")).toHaveTextContent("VaultCore");
    await userEvent.click(row("ERC20", "0xdd62ed3e"));
    await expect.poll(() => row("ERC20", "0xdd62ed3e").dataset.state).toBe("routed");
  });

  test("Space on a focused row does what a click does", async () => {
    await sheet(gallery());
    row("ERC20", SYMBOL).focus();
    await userEvent.keyboard(" ");
    await expect.poll(() => row("ERC20", SYMBOL).dataset.state).toBe("routed");
    expect(doc.get().recipe.exclude).not.toContain(SYMBOL);
  });

  test("a click on a contested pin routes it here and the conflict clears", async () => {
    await sheet(gallery({ expanded: ["HyperlaneGatewayAdapter"] }));
    expect(card("AxelarGatewayAdapter").dataset.border).toBe("conflict");
    await userEvent.click(row("AxelarGatewayAdapter", "0xcdfe7f5c"));
    await userEvent.click(row("AxelarGatewayAdapter", "0xdc680a0f"));
    await expect.poll(() => row("AxelarGatewayAdapter", "0xcdfe7f5c").dataset.state).toBe("routed");
    expect(row("HyperlaneGatewayAdapter", "0xcdfe7f5c").dataset.state).toBe("elsewhere");
    expect(row("HyperlaneGatewayAdapter", "0xcdfe7f5c").textContent).toContain("→ AxelarGatewayAdapter");
    expect(doc.get().recipe.owners["0xcdfe7f5c"]).toBe("AxelarGatewayAdapter");
    await expect.poll(() => card("AxelarGatewayAdapter").dataset.border).not.toBe("conflict");
  });

  test("a seam offers no route: disabled with its reason, and a click changes nothing", async () => {
    await sheet(gallery());
    const transfer = row("ERC20", "0xa9059cbb");
    expect(transfer.getAttribute("aria-disabled")).toBe("true");
    await expect
      .element(page.getByRole("button", { name: "transfer(address,uint256) 0xa9059cbb, seam: stays on GovernedVault" }).first())
      .toHaveAccessibleDescription("Seam: stays on GovernedVault because its version moves vote checkpoints with balances.");
    const before = doc.get().recipe;
    await userEvent.click(transfer, { force: true });
    expect(doc.get().recipe).toBe(before);
    expect(transfer.textContent).toContain("Seam: stays on GovernedVault");
    expect(transfer.querySelector('[data-icon="lock"]')).not.toBeNull();
  });

  test("read-only: every pin says why and changes nothing", async () => {
    await renderWithStudio(<CardSheet />, { project: gallery(), session: { readOnly: "Read-only: open in one tab at a time" } });
    await expect.poll(() => document.querySelectorAll("[data-facet]").length).toBe(GALLERY_FACETS.length);
    const allowance = row("ERC20", "0xdd62ed3e");
    expect(allowance.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(allowance, { force: true });
    expect(doc.get().recipe.exclude).not.toContain("0xdd62ed3e");
    expect(allowance.dataset.state).toBe("routed");
  });
});

describe("disabled commands (spec L661)", () => {
  test("a pin whose command can't run is disabled with the command's reason, and a click changes nothing", async () => {
    await sheet(gallery());
    const reason = "Not built yet · WP-S5c";
    const real = getCommand("selector.exclude");
    overrideCommands([{ ...real, enabled: () => ({ ok: false, reason }) }]);
    const allowance = row("ERC20", "0xdd62ed3e");
    await expect.poll(() => allowance.getAttribute("aria-disabled")).toBe("true");
    await expect
      .element(page.getByRole("button", { name: "allowance(address,address) 0xdd62ed3e, routes here" }))
      .toHaveAccessibleDescription(new RegExp(reason));
    await userEvent.click(allowance, { force: true });
    expect(doc.get().recipe.exclude).not.toContain("0xdd62ed3e");
  });
});

describe("the footer (IR L103)", () => {
  test("a namespace too long for the card ends in an ellipsis and keeps the whole string", async () => {
    await sheet(gallery());
    const footer = card("ERC20").querySelector<HTMLElement>("[title]");
    expect(footer?.title).toBe("erc7201:lattice.storage.ERC20");
    expect(footer?.textContent).toBe("erc7201:lattice.storage.ERC20");
    if (!footer) throw new Error("No footer.");
    // 29 characters of 13 px mono don't fit 208 px: the span clips with an ellipsis rather than mid-name.
    expect(footer.scrollWidth).toBeGreaterThan(footer.clientWidth);
    expect(getComputedStyle(footer).textOverflow).toBe("ellipsis");
    expect(getComputedStyle(footer).overflow).toBe("hidden");
    expect(footer.getBoundingClientRect().right).toBeLessThanOrEqual(card("ERC20").getBoundingClientRect().right);
  });
});

describe("more contrast (spec L785)", () => {
  test("meaningful strokes are never thinner than the 2 px hairline", async () => {
    await cdp().send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-contrast", value: "more" }] });
    try {
      await renderWithStudio(<CardSheet />, { project: gallery(), session: { selection: ["ERC20Votes"] } });
      await expect.poll(() => document.querySelectorAll("[data-facet]").length).toBe(GALLERY_FACETS.length);
      expect(matchMedia("(prefers-contrast: more)").matches).toBe(true);
      const width = (facet: string) => parseFloat(getComputedStyle(card(facet), "::after").borderTopWidth);
      expect(width("Receive")).toBe(2);
      expect(width("ERC20Votes")).toBeGreaterThanOrEqual(width("Receive"));
      expect(width("VaultCore")).toBeGreaterThanOrEqual(width("Receive"));
      const tick = row("ERC20", "0xdd62ed3e").querySelector<HTMLElement>("[class*='tick']");
      if (!tick) throw new Error("No tick.");
      expect(parseFloat(getComputedStyle(tick).borderTopWidth)).toBeGreaterThanOrEqual(2);
    } finally {
      await cdp().send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-contrast", value: "no-preference" }] });
    }
  });
});

describe("+ n more and Collapse (spec L479)", () => {
  test("a card over 9 selectors shows 6 rows, its contested ones kept, and + n more", async () => {
    await sheet(gallery());
    const hyperlane = card("HyperlaneGatewayAdapter");
    expect(hyperlane.querySelectorAll("[data-selector]")).toHaveLength(6);
    expect(row("HyperlaneGatewayAdapter", "0xcdfe7f5c").dataset.state).toBe("contested");
    const more = page.getByRole("button", { name: "+ 6 more" });
    await expect.element(more).toHaveAttribute("aria-expanded", "false");
    // 20 px on the grid, a 24 px hit area (spec L770).
    const box = more.element().getBoundingClientRect();
    const hit = getComputedStyle(more.element(), "::before");
    expect(box.height + parseFloat(hit.bottom) * -1).toBeGreaterThanOrEqual(24);
    expect(card("ERC20").querySelector("[aria-expanded]")).toBeNull();
  });

  test("expanding is one undo step that shows every row, and Collapse puts it back", async () => {
    await sheet(gallery());
    await userEvent.click(page.getByRole("button", { name: "+ 6 more" }));
    await expect.poll(() => card("HyperlaneGatewayAdapter").querySelectorAll("[data-selector]").length).toBe(12);
    expect(doc.get().layout["HyperlaneGatewayAdapter"]?.expanded).toBe(true);
    await expect.element(page.getByRole("button", { name: "Collapse" })).toHaveAttribute("aria-expanded", "true");
    history.undo();
    await expect.poll(() => card("HyperlaneGatewayAdapter").querySelectorAll("[data-selector]").length).toBe(6);
    history.redo();
    await expect.poll(() => card("HyperlaneGatewayAdapter").querySelectorAll("[data-selector]").length).toBe(12);
    await userEvent.click(page.getByRole("button", { name: "Collapse" }));
    await expect.poll(() => card("HyperlaneGatewayAdapter").querySelectorAll("[data-selector]").length).toBe(6);
  });
});

describe("size, paint containment and handles (spec L824-L825)", () => {
  test("each card is drawn at C9's cardSize, with contain-intrinsic-size to match", async () => {
    const project = gallery({ expanded: ["GovernedVault"] });
    await sheet(project);
    const analysis = getAnalysis();
    for (const name of GALLERY_FACETS) {
      const facet = catalog.facets.find((f) => f.name === name);
      if (!facet) throw new Error(name);
      const size = cardSize(facet, {
        metrics: layoutMetrics, expanded: project.layout[name]?.expanded === true, pins: "left", compact: false,
        contested: contestedSelectors(analysis, name),
      });
      const rect = card(name).getBoundingClientRect();
      expect([name, rect.width, rect.height]).toEqual([name, size.width, size.height]);
      const paint = card(name).firstElementChild?.nextElementSibling?.nextElementSibling;
      if (!(paint instanceof HTMLElement)) throw new Error("No paint box.");
      expect(getComputedStyle(paint).contentVisibility).toBe("auto");
      const style = getComputedStyle(paint);
      expect(style.getPropertyValue("contain-intrinsic-width")).toMatch(new RegExp(`(^| )${size.width}px$`));
      expect(style.getPropertyValue("contain-intrinsic-height")).toMatch(new RegExp(`(^| )${size.height}px$`));
    }
  });

  test("a source and a target handle per drawn row on the pin side, and dependency handles on both sides", async () => {
    await sheet(gallery({ pinsRight: ["GovernedVault"] }));
    const hyperlane = card("HyperlaneGatewayAdapter");
    const ids = [...hyperlane.querySelectorAll<HTMLElement>(".react-flow__handle")].map(
      (h) => `${h.dataset.handleid}:${h.classList.contains("source") ? "source" : "target"}`,
    );
    for (const selector of ["0x97a21652", "0xcdfe7f5c", "0xdc680a0f"]) {
      expect(ids).toContain(`${selector}:source`);
      expect(ids).toContain(`${selector}:target`);
    }
    expect(ids).not.toContain("0x3e56e39a:source");
    for (const side of ["left", "right"]) expect(ids).toContain(`dependency-${side}:source`);

    // At the row's middle, on the card's edge: C9's pin anchor.
    const top = hyperlane.getBoundingClientRect().top;
    const send = hyperlane.querySelector<HTMLElement>('.react-flow__handle[data-handleid="0xcdfe7f5c"]');
    const sendRect = send?.getBoundingClientRect();
    const index = 4;
    const expected = layoutMetrics.headerHeight + layoutMetrics.grid + index * layoutMetrics.rowHeight + layoutMetrics.rowHeight / 2;
    expect(Math.round((sendRect?.top ?? 0) + (sendRect?.height ?? 0) / 2 - top)).toBe(expected);
    expect(Math.round((sendRect?.left ?? 0) + (sendRect?.width ?? 0) / 2)).toBe(Math.round(hyperlane.getBoundingClientRect().left));

    const vault = card("GovernedVault");
    const pin = vault.querySelector<HTMLElement>('.react-flow__handle[data-handleid="0x4bf5d7e9"]');
    expect(pin?.classList.contains("react-flow__handle-right")).toBe(true);
  });
});

describe("compact below 40% zoom (spec L481)", () => {
  test("header plus a tick strip, at C9's compact size, with handles on the strip", async () => {
    await sheet(gallery(), 0.3);
    const hyperlane = card("HyperlaneGatewayAdapter");
    expect(hyperlane.dataset.compact).toBe("");
    expect(hyperlane.querySelectorAll("[data-selector]")).toHaveLength(0);
    expect(hyperlane.querySelectorAll('[data-state="contested"]')).toHaveLength(2);
    const header = hyperlane.querySelector<HTMLElement>("[class*='path']");
    // 10 of its 12 route here; the 2 contested with Axelar don't yet.
    expect(header?.textContent).toBe("10/12 selectors");
    expect(hyperlane.style.height).toBe(`${layoutMetrics.headerHeight + layoutMetrics.rowHeight}px`);
    expect(hyperlane.querySelector('.react-flow__handle[data-handleid="0xcdfe7f5c"]')).not.toBeNull();
  });

  test("crossing 40% redraws the card at full size, and its handle follows to the row (spec L825)", async () => {
    const flow: { zoomTo?: (zoom: number) => Promise<boolean> } = {};
    await renderWithStudio(<CardSheet zoom={0.3} onInit={(rf) => (flow.zoomTo = (z) => rf.zoomTo(z))} />, { project: gallery() });
    await expect.poll(() => flow.zoomTo !== undefined).toBe(true);
    expect(card("ERC20").dataset.compact).toBe("");
    const ALLOWANCE: Hex4 = "0xdd62ed3e";
    const handle = () => card("ERC20").querySelector<HTMLElement>(`.react-flow__handle[data-handleid="${ALLOWANCE}"]`);
    const compactTop = handle()?.style.top;
    await flow.zoomTo?.(0.5);
    await expect.poll(() => card("ERC20").dataset.compact).toBeUndefined();
    expect(card("ERC20").querySelectorAll("[data-selector]")).toHaveLength(9);
    await expect.poll(() => handle()?.style.top).not.toBe(compactTop);
    const index = [...card("ERC20").querySelectorAll<HTMLElement>("[data-selector]")].findIndex((r) => r.dataset.selector === ALLOWANCE);
    expect(index).toBeGreaterThanOrEqual(0);
    const expectedTop = layoutMetrics.headerHeight + layoutMetrics.grid + index * layoutMetrics.rowHeight + layoutMetrics.rowHeight / 2;
    expect(handle()?.style.top).toBe(`${expectedTop}px`);
  });
});

describe("handles follow an expand or a pin flip (spec L825, batch-3 #36)", () => {
  /** React Flow's own handle bounds for `facet` (what `updateNodeInternals` refreshes), not just the DOM. */
  function handleBounds(flow: { instance?: ReactFlowInstance<FacetNode> }, facet: string) {
    return flow.instance?.getInternalNode(facet)?.internals.handleBounds;
  }

  test("expanding draws a handle for the newly-shown row, and React Flow's own handle bounds pick it up", async () => {
    const flow: { instance?: ReactFlowInstance<FacetNode> } = {};
    await renderWithStudio(<CardSheet onInit={(rf) => (flow.instance = rf)} />, { project: gallery() });
    await expect.poll(() => document.querySelectorAll("[data-facet]").length).toBe(GALLERY_FACETS.length);
    const HIDDEN: Hex4 = "0x3e56e39a"; // trustedRemoteOf(uint256), past Hyperlane's collapsed 6 rows
    const hasBound = () => handleBounds(flow, "HyperlaneGatewayAdapter")?.source?.some((h) => h.id === HIDDEN) ?? false;
    expect(card("HyperlaneGatewayAdapter").querySelector(`.react-flow__handle[data-handleid="${HIDDEN}"]`)).toBeNull();
    expect(hasBound()).toBe(false);

    await userEvent.click(page.getByRole("button", { name: "+ 6 more" }));
    await expect.poll(() => card("HyperlaneGatewayAdapter").querySelectorAll("[data-selector]").length).toBe(12);
    const handle = () => card("HyperlaneGatewayAdapter").querySelector<HTMLElement>(`.react-flow__handle[data-handleid="${HIDDEN}"]`);
    await expect.poll(() => handle() !== null).toBe(true);
    // updateNodeInternals ran: React Flow's store, not just the DOM, now has a bound for the new handle.
    await expect.poll(hasBound).toBe(true);
    const index = [...card("HyperlaneGatewayAdapter").querySelectorAll<HTMLElement>("[data-selector]")].findIndex(
      (r) => r.dataset.selector === HIDDEN,
    );
    expect(index).toBeGreaterThanOrEqual(0);
    const expectedTop = layoutMetrics.headerHeight + layoutMetrics.grid + index * layoutMetrics.rowHeight + layoutMetrics.rowHeight / 2;
    expect(handle()?.style.top).toBe(`${expectedTop}px`);
    const bound = handleBounds(flow, "HyperlaneGatewayAdapter")?.source?.find((h) => h.id === HIDDEN);
    expect(Math.round(bound?.y ?? 0)).toBe(expectedTop);
  });

  test("flipping pins moves a card's handles to its new side, in React Flow's own handle bounds too", async () => {
    const flow: { instance?: ReactFlowInstance<FacetNode> } = {};
    await renderWithStudio(<CardSheet onInit={(rf) => (flow.instance = rf)} />, { project: gallery() });
    await expect.poll(() => document.querySelectorAll("[data-facet]").length).toBe(GALLERY_FACETS.length);
    const ALLOWANCE: Hex4 = "0xdd62ed3e";
    const handle = () => card("ERC20").querySelector<HTMLElement>(`.react-flow__handle[data-handleid="${ALLOWANCE}"]`);
    const boundX = () => handleBounds(flow, "ERC20")?.source?.find((h) => h.id === ALLOWANCE)?.x;
    expect(handle()?.classList.contains("react-flow__handle-left")).toBe(true);
    const leftX = boundX();

    await runCommand({ id: "layout.flipPins", args: { facets: ["ERC20"] } }, "api");
    await expect.poll(() => card("ERC20").dataset.pins).toBe("right");
    await expect.poll(() => handle()?.classList.contains("react-flow__handle-right")).toBe(true);
    expect(handle()?.classList.contains("react-flow__handle-left")).toBe(false);
    // Its top on the row's middle doesn't change: only the side does, in the DOM and in React Flow's bounds.
    const index = [...card("ERC20").querySelectorAll<HTMLElement>("[data-selector]")].findIndex((r) => r.dataset.selector === ALLOWANCE);
    const expectedTop = layoutMetrics.headerHeight + layoutMetrics.grid + index * layoutMetrics.rowHeight + layoutMetrics.rowHeight / 2;
    expect(handle()?.style.top).toBe(`${expectedTop}px`);
    await expect.poll(boundX).not.toBe(leftX);
  });
});

describe("strokes scale with 1/zoom (spec L772)", () => {
  test("at 50% the hairline frame is 2 sheet px, 1 px on screen; at 200% it stays 1", async () => {
    const flow: { zoomTo?: (zoom: number) => Promise<boolean> } = {};
    await renderWithStudio(<CardSheet zoom={0.5} onInit={(rf) => (flow.zoomTo = (z) => rf.zoomTo(z))} />, { project: gallery() });
    await expect.poll(() => flow.zoomTo !== undefined).toBe(true);
    const frame = () => getComputedStyle(card("Receive"), "::after");
    await expect.poll(() => frame().borderTopWidth).toBe("2px");
    await expect.poll(() => getComputedStyle(card("AxelarGatewayAdapter"), "::after").borderTopWidth).toBe("4px");
    await flow.zoomTo?.(2);
    await expect.poll(() => frame().borderTopWidth).toBe("1px");
  });
});
