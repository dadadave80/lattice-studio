/**
 * Traces, ties, notes and problem navigation on the real sheet (brief S4c): the collision note and its owner
 * choices writing `owners`, the three-contender owner menu, Choose per selector, the seam and missing-dependency
 * notes, the note's context menu, Resolve collision…, F8 in problem order, and the fade with reduced motion.
 */
import type { Catalog, Hex4, Problem, Project, Recipe } from "@lattice-studio/core";
import { makeCatalog, makeFacet } from "@lattice-studio/core/testing";
import { describe, expect, test } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { command, commandState, doc, emptyAnalysis, getAnalysis, history, provideAnalysis, runCommand, session } from "@/contracts";
import { bufferedServices } from "@/contracts/services";
import { installShortcuts } from "@/commands/keys/dispatcher";
import { DialogHost } from "@/ui/overlays/DialogHost";
import { fixtureCatalog, onCleanup, overrideCommands } from "../../../test/harness";
import { cardProject } from "../card/testing/projects";
import { ensureElementVisible, panSheet } from "../canvas";
import { drawn, renderSheet } from "../canvas/testing/sheet-harness";
import noteStyles from "./Note.module.css";
import { problemCursor, resetProblemCursor } from "./navigate";
import { clearNoteFocus } from "./note-focus";
import { computeOverlay } from "./overlay-model";

const catalog = fixtureCatalog();
const SEND: Hex4 = "0xcdfe7f5c";
const ATTRIBUTE: Hex4 = "0xdc680a0f";
const AXELAR = "AxelarGatewayAdapter";
const HYPERLANE = "HyperlaneGatewayAdapter";
const CCIP = "CCIPGatewayAdapter";

function project(facets: string[], options: { owners?: Record<Hex4, string>; columns?: number } = {}): Project {
  return cardProject(catalog, facets, { columns: options.columns ?? 3, rowPitch: 420, ...(options.owners ? { owners: options.owners } : {}) });
}

async function sheet(p: Project, settings: { reduceMotion?: "on" | "off" } = {}) {
  onCleanup(() => {
    resetProblemCursor();
    clearNoteFocus();
  });
  const screen = await renderSheet({ project: p, settings: { reduceMotion: settings.reduceMotion ?? "on" } });
  return screen;
}

function note(kind: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-note-kind="${kind}"]:not([data-leaving])`);
}

function noteById(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(id)}"]`);
}

function inSheet(el: Element): boolean {
  const s = (document.querySelector(".react-flow") as HTMLElement).getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return r.left >= s.left && r.right <= s.right && r.top >= s.top && r.bottom <= s.bottom;
}

async function waitForNote(kind: string): Promise<HTMLElement> {
  // The layer is its own chunk: on a cold, busy run it can take a moment to land.
  await expect.poll(() => note(kind), { timeout: 8000 }).not.toBeNull();
  const el = note(kind) as HTMLElement;
  // The 1000 × 700 test sheet can leave a note partly below its edge; the layer is clipped and never scrolls,
  // so pan it into view the way the sheet does, before a test clicks its buttons.
  ensureElementVisible(el);
  await expect.poll(() => inSheet(el)).toBe(true);
  return el;
}

function owners(): Recipe["owners"] {
  return doc.get().recipe.owners;
}

function problemIds(): string[] {
  return getAnalysis().problems.map((p) => p.id);
}

function focusedNoteId(): string | null {
  return (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-note-id]")?.dataset.noteId ?? null;
}

function inspectorProblem(): string | null {
  const view = session.get().panes.inspector.view;
  return view?.kind === "problem" ? view.id : null;
}

describe("collision note (Flow 4, spec L434-L439)", () => {
  test("Axelar and Hyperlane: one note, both selectors in full, ties between the pins", async () => {
    await sheet(project([AXELAR, HYPERLANE]));
    const el = await waitForNote("collision");
    const group = page.getByRole("note", { name: "Selector collision · 2" });
    await expect.element(group).toBeInTheDocument();
    expect(el.textContent).toContain("sendMessage(bytes,bytes,bytes[])");
    expect(el.textContent).toContain(SEND);
    expect(el.textContent).toContain("supportsAttribute(bytes4)");
    expect(el.textContent).toContain(ATTRIBUTE);
    expect(el.textContent).toContain("Only one facet can serve each selector.");
    expect(el.dataset.tour).toBe("collision");
    expect(el.tabIndex).toBe(0);
    // One tie per contested selector, never one edge per selector pair (spec L823).
    await expect.poll(() => document.querySelectorAll("[data-edge^='tie:']").length).toBe(2);
    expect(document.querySelector(`[data-edge^='tie:'][data-selector='${SEND}']`)).not.toBeNull();
    // A leader ties the note to its ties.
    expect(document.querySelector("[data-sheet-layer='notes'] svg path")).not.toBeNull();
  });

  test("Keep AxelarGatewayAdapter writes both owners as one undo step", async () => {
    await sheet(project([AXELAR, HYPERLANE]));
    await waitForNote("collision");
    await page.getByRole("button", { name: "Keep AxelarGatewayAdapter" }).click();
    expect(owners()).toEqual({ [SEND]: AXELAR, [ATTRIBUTE]: AXELAR });
    await expect.poll(() => note("collision")).toBeNull();
    await expect.poll(() => document.querySelectorAll("[data-edge^='tie:']").length).toBe(0);
    history.undo();
    expect(owners()).toEqual({});
  });

  test("Route to HyperlaneGatewayAdapter writes both owners, and the console says what resolved", async () => {
    await sheet(project([AXELAR, HYPERLANE]));
    await waitForNote("collision");
    await page.getByRole("button", { name: "Route to HyperlaneGatewayAdapter" }).click();
    expect(owners()).toEqual({ [SEND]: HYPERLANE, [ATTRIBUTE]: HYPERLANE });
    await expect.poll(() => bufferedServices().log.map((l) => l.text).join("\n")).toContain("Resolved");
  });

  test("read-only: the choices say the reason and change nothing", async () => {
    await sheet(project([AXELAR, HYPERLANE]));
    await waitForNote("collision");
    session.set({ readOnly: "Read-only: opened from a link" });
    const keep = page.getByRole("button", { name: "Keep AxelarGatewayAdapter" });
    await expect.element(keep).toHaveAttribute("aria-disabled", "true");
    await keep.click({ force: true });
    expect(owners()).toEqual({});
    await expect.element(page.getByRole("button", { name: "Choose per selector…" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("three or more contenders (spec L436, PA bug 22)", () => {
  test("one note per contested set, with the owner menu whose items route the set", async () => {
    await sheet(project([AXELAR, CCIP, HYPERLANE]));
    const three = `collision:${AXELAR}+${CCIP}+${HYPERLANE}`;
    await expect.poll(() => noteById(three), { timeout: 8000 }).not.toBeNull();
    expect(noteById(`collision:${CCIP}+${HYPERLANE}`)).not.toBeNull();
    const el = noteById(three) as HTMLElement;
    expect(el.querySelector("button")?.textContent).toBe(`Owner: ${AXELAR}`);
    // Two selectors share the set: Choose per selector… appears once in the note, and Choose owner… never does.
    const words = [...el.querySelectorAll<HTMLElement>("button")].map((b) => (b.textContent ?? "").trim());
    expect(words.filter((w) => w === "Choose per selector…")).toHaveLength(1);
    expect(words).not.toContain("Choose owner…");
    // No Keep/Route pair once there are three.
    expect(el.textContent).not.toContain("Keep ");
    (el.querySelector("button") as HTMLElement).click();
    const item = page.getByRole("menuitem", { name: HYPERLANE });
    await expect.element(item).toBeVisible();
    await item.click();
    expect(owners()).toEqual({ [SEND]: HYPERLANE, [ATTRIBUTE]: HYPERLANE });
    await expect.poll(() => noteById(three)).toBeNull();
    // The other set is still open.
    expect(noteById(`collision:${CCIP}+${HYPERLANE}`)).not.toBeNull();
  });
});

describe("Choose owner… on one selector with three contenders (spec L311, batch-2 #35)", () => {
  const SHARED: Hex4 = "0x5c60da1b";
  const trio: Catalog = makeCatalog({
    facets: ["Ash", "Birch", "Cedar"].map((name) => makeFacet({ name, selectors: [{ hex: SHARED, signature: "shared()" }] })),
  });

  test("SEL-01 carries it once, titled Choose owner…; the note shows the owner menu and doesn't repeat it (contracts §3.3)", async () => {
    onCleanup(() => {
      resetProblemCursor();
      clearNoteFocus();
    });
    const p = cardProject(trio, ["Ash", "Birch", "Cedar"], { columns: 3, rowPitch: 420 });
    await renderSheet({ project: p, catalog: trio, settings: { reduceMotion: "on" } });
    await expect.poll(() => noteById("collision:Ash+Birch+Cedar"), { timeout: 8000 }).not.toBeNull();
    const el = noteById("collision:Ash+Birch+Cedar") as HTMLElement;
    // The problem's own fixes hold the one Choose owner… (the inspector and Structure render them).
    const fixes = getAnalysis().problems.find((q) => q.id === `SEL-01:${SHARED}`)?.fixes ?? [];
    const chooser = fixes.filter((f) => f.id === "collision.choosePerSelector");
    expect(chooser).toHaveLength(1);
    expect(commandState(chooser[0] as (typeof fixes)[number]).title).toBe("Choose owner…");
    // The note builds its buttons from the contenders: the owner menu, and no second Choose owner….
    const words = [...el.querySelectorAll<HTMLElement>("button")].map((b) => (b.textContent ?? "").trim());
    expect(words.filter((w) => w.startsWith("Owner:"))).toHaveLength(1);
    expect(words.filter((w) => w === "Choose owner…" || w.startsWith("Choose per selector"))).toHaveLength(0);
  });
});

describe("Choose per selector (IR L176)", () => {
  test("one owner menu per selector; Apply owners is one undo step", async () => {
    await sheet(project([AXELAR, HYPERLANE]));
    await render(<DialogHost />);
    await waitForNote("collision");
    await page.getByRole("button", { name: "Choose per selector…" }).click();
    const dialog = page.getByRole("dialog", { name: "Choose per selector" });
    await expect.element(dialog).toBeVisible();
    const menus = document.querySelectorAll<HTMLElement>("[data-owner-menu]");
    expect(menus).toHaveLength(2);
    // Initial focus: the first selector's owner menu.
    await expect.poll(() => document.activeElement?.hasAttribute("data-owner-menu")).toBe(true);
    const apply = dialog.getByRole("button", { name: "Apply owners" });
    await expect.element(apply).toHaveAttribute("aria-disabled", "true");

    const pick = async (selector: Hex4, signature: string, facet: string) => {
      (document.querySelector(`[data-owner-menu="${selector}"]`) as HTMLElement).click();
      const menu = page.getByRole("menu", { name: `Owner of ${signature}` });
      const item = menu.getByRole("menuitemradio", { name: facet });
      await expect.element(item).toBeVisible();
      await item.click();
      await expect.poll(() => document.querySelector(`[data-owner-menu="${selector}"]`)?.textContent).toContain(facet);
      await userEvent.keyboard("{Escape}");
      await expect.element(menu).not.toBeInTheDocument();
    };
    await pick(SEND, "sendMessage(bytes,bytes,bytes[])", HYPERLANE);
    await pick(ATTRIBUTE, "supportsAttribute(bytes4)", AXELAR);
    await expect.element(dialog).toBeVisible();
    await apply.click();
    expect(owners()).toEqual({ [SEND]: HYPERLANE, [ATTRIBUTE]: AXELAR });
    await expect.element(dialog).not.toBeInTheDocument();
    history.undo();
    expect(owners()).toEqual({});
  });

  test("Choose owner… on a default-owned selector: Apply owners says what it did in the console", async () => {
    const NAME: Hex4 = "0x06fdde03";
    await sheet(project(["ERC20", "GovernedVault", "Governor"]));
    await render(<DialogHost />);
    expect(getAnalysis().routing[NAME]).toMatchObject({ owner: "GovernedVault", via: "default" });
    await runCommand({ id: "collision.choosePerSelector", args: { selectors: [NAME] } }, "api");
    const dialog = page.getByRole("dialog", { name: "Choose per selector" });
    await expect.element(dialog).toBeVisible();
    (document.querySelector(`[data-owner-menu="${NAME}"]`) as HTMLElement).click();
    const item = page.getByRole("menu", { name: "Owner of name()" }).getByRole("menuitemradio", { name: "ERC20" });
    await expect.element(item).toBeVisible();
    await item.click();
    await userEvent.keyboard("{Escape}");
    const before = bufferedServices().log.length;
    await dialog.getByRole("button", { name: "Apply owners" }).click();
    expect(owners()).toEqual({ [NAME]: "ERC20" });
    // No problem resolves; narration says what the change raised (SEL-02), and S1's fallback would say the
    // summary if it raised nothing. Either way the console has a line naming the new owner.
    await expect.poll(() => bufferedServices().log.slice(before).map((l) => l.text).join("\n")).toMatch(/ERC20/);
  });

  test("read-only: Choose per selector… is disabled with the reason", async () => {
    await sheet(project([AXELAR, HYPERLANE]), {});
    session.set({ readOnly: "Read-only: opened from a link" });
    const state = await runCommand({ id: "collision.choosePerSelector", args: { selectors: [SEND, ATTRIBUTE] } }, "api");
    expect(state).toEqual({ ok: false, reason: "Read-only: opened from a link" });
    expect(session.get().dialogs).toHaveLength(0);
  });
});

describe("seam and missing-dependency notes (Flow 5, spec L441-L449)", () => {
  test("SEM-01: a stale owner gets a seam note whose Route fixes it", async () => {
    await sheet(project(["ERC20", "ERC20Votes", "ERC20Pausable"], { owners: { "0xa9059cbb": "ERC20Pausable" } }));
    const el = await waitForNote("seam");
    expect(el.textContent).toContain("must be served by a version that");
    await expect.element(page.getByRole("button", { name: "Remove ERC20Pausable" })).toBeInTheDocument();
    const route = page.getByRole("note", { name: "Seam" }).getByRole("button", { name: /^Route to / });
    await route.click();
    await expect.poll(() => problemIds().some((id) => id.startsWith("SEM-01"))).toBe(false);
    await expect.poll(() => note("seam")).toBeNull();
  });

  test("DEP-01: Place ERC4626 puts it beside VaultCore and draws the trace labelled needs ERC4626", async () => {
    await sheet(project(["VaultCore"]));
    const el = await waitForNote("missing");
    expect(el.textContent).toContain("VaultCore requires ERC4626: it runs the assets behind ERC4626's shares and initializes after it.");
    await page.getByRole("button", { name: "Place ERC4626" }).click();
    expect(doc.get().recipe.facets).toContain("ERC4626");
    const vault = doc.get().layout["VaultCore"];
    const placed = doc.get().layout["ERC4626"];
    expect(placed && vault ? placed.x > vault.x : false).toBe(true);
    await expect.poll(() => document.querySelector("[data-edge='needs:VaultCore:ERC4626']")).not.toBeNull();
    await expect.poll(() => document.querySelector("[data-trace-label='needs:VaultCore:ERC4626']")?.textContent).toBe("needs ERC4626");
    await expect.poll(() => note("missing")).toBeNull();
  });
});

describe("DEP-01 with more than one option (spec L446, IR L108, batch-1 #36/#37)", () => {
  const optionsCatalog: Catalog = makeCatalog({
    facets: [
      makeFacet({
        name: "Dependent",
        requires: [{ anyOf: ["OptionA", "OptionB"], strength: "hard", reason: "it needs an option" }],
      }),
      makeFacet({ name: "OptionA" }),
      makeFacet({ name: "OptionB" }),
    ],
  });

  async function optionsSheet(): Promise<void> {
    onCleanup(() => {
      resetProblemCursor();
      clearNoteFocus();
    });
    const options = cardProject(optionsCatalog, ["Dependent"], { columns: 1 });
    await renderSheet({ project: options, catalog: optionsCatalog, settings: { reduceMotion: "on" } });
  }

  test("one Place button per anyOf option, plus Compare options…, which opens the preview", async () => {
    await optionsSheet();
    const el = await waitForNote("missing");
    const placeA = page.getByRole("button", { name: "Place OptionA" });
    const placeB = page.getByRole("button", { name: "Place OptionB" });
    await expect.element(placeA).toBeInTheDocument();
    await expect.element(placeB).toBeInTheDocument();
    const compare = page.getByRole("button", { name: "Compare options…" });
    await expect.element(compare).toBeInTheDocument();
    expect(el.textContent).toContain("Dependent");
    await compare.click();
    expect(session.get().panes.inspector.view).toMatchObject({ kind: "preview", facet: "OptionA", compare: ["OptionA", "OptionB"] });
    // Placing an option still puts it beside the dependent and clears the note (Flow 5).
    await placeA.click();
    expect(doc.get().recipe.facets).toContain("OptionA");
    await expect.poll(() => note("missing")).toBeNull();
  });
});

describe("the convention note is quieter than a missing-dependency note (spec L449, batch-1 #44)", () => {
  test("a hairline, muted rule and caption instead of the heavy accent (DEP-01 vs DEP-02)", async () => {
    await sheet(project(["GovernedDiamondCut", "VaultCore"]));
    const missing = await waitForNote("missing");
    const convention = await waitForNote("convention");
    const missingStyle = getComputedStyle(missing);
    const conventionStyle = getComputedStyle(convention);
    expect(parseFloat(conventionStyle.borderInlineStartWidth)).toBeLessThan(parseFloat(missingStyle.borderInlineStartWidth));
    expect(conventionStyle.borderInlineStartStyle).toBe("solid");
    expect(missingStyle.borderInlineStartStyle).toBe("dashed");
    expect(conventionStyle.borderInlineStartColor).not.toBe(missingStyle.borderInlineStartColor);
    const captionOf = (note: HTMLElement) => note.querySelector<HTMLElement>(`.${noteStyles.caption}`);
    const missingCaption = captionOf(missing);
    const conventionCaption = captionOf(convention);
    if (!missingCaption || !conventionCaption) throw new Error("No caption.");
    expect(getComputedStyle(conventionCaption).color).not.toBe(getComputedStyle(missingCaption).color);
  });
});

describe("Tab order: the notes sit between the tool strip and the title block (IR L18, spec L744, L752)", () => {
  test("from the last tool-strip control, Tab reaches the notes, then the init chip, then the title block", async () => {
    await sheet(project(["VaultCore"]));
    const el = await waitForNote("missing");
    session.set({ modes: { ...session.get().modes, initOrder: true } });
    await expect.poll(() => document.querySelector('[data-chrome="init-chip"]')).not.toBeNull();
    // The last tool-strip (or zoom readout) control that comes before the note in the document: title block and
    // the init chip both sit after the note (spec L744), so this excludes them the way "a note out of view"
    // does above.
    const panels = [...document.querySelectorAll<HTMLElement>(".react-flow__panel button")];
    const last = panels.filter((b) => b.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).at(-1);
    if (!last) throw new Error("No tool-strip control.");
    last.focus({ preventScroll: true });
    await userEvent.tab();
    expect(document.activeElement?.closest("[data-note-id]")).not.toBeNull();
    let guard = 0;
    while (document.activeElement?.closest("[data-note-id]") && guard < 10) {
      await userEvent.tab();
      guard += 1;
    }
    expect(guard).toBeGreaterThan(0);
    expect(document.activeElement?.closest('[data-chrome="init-chip"]')).not.toBeNull();
    await userEvent.tab();
    expect(document.activeElement?.closest('[data-chrome="title-block"]')).not.toBeNull();
  });
});

describe("traces and ties (IR L106-L107)", () => {
  test("a trace's reason shows from 75% zoom, below that while an end is selected, which also lights it", async () => {
    await sheet(project(["VaultCore", "ERC4626"], { columns: 2 }));
    const id = "needs:VaultCore:ERC4626";
    const trace = () => document.querySelector<SVGGElement>(`g[data-edge='${id}']`);
    const label = () => document.querySelector(`[data-trace-label='${id}']`);
    await expect.poll(trace, { timeout: 8000 }).not.toBeNull();
    const line = trace()?.querySelector("path:last-child") as SVGPathElement;
    expect(parseFloat(getComputedStyle(line).strokeWidth)).toBeCloseTo(1.5, 1);
    await expect.poll(label).not.toBeNull();
    await runCommand({ id: "sheet.zoomTo", args: { zoom: 0.5 } }, "api");
    await expect.poll(label).toBeNull();
    session.set({ selection: ["ERC4626"] });
    await expect.poll(label).not.toBeNull();
    expect(trace()?.hasAttribute("data-live")).toBe(true);
    session.set({ selection: [] });
    await expect.poll(label).toBeNull();
    // Keyboard focus on an end, with nothing selected, shows it too (IR L106: "on hover or focus").
    const node = document.querySelector<HTMLElement>(".react-flow__node[data-id='ERC4626']") as HTMLElement;
    node.focus();
    await expect.poll(() => label()?.textContent).toBe("needs ERC4626");
    expect(session.get().selection).toEqual([]);
    node.blur();
    await expect.poll(label).toBeNull();
  });

  test("a trace's line is 1.5 px until an end is selected, then 2 px accent (IR L106, batch-2 #135)", async () => {
    await sheet(project(["VaultCore", "ERC4626"], { columns: 2 }));
    const id = "needs:VaultCore:ERC4626";
    const trace = () => document.querySelector<SVGGElement>(`g[data-edge='${id}']`);
    await expect.poll(trace, { timeout: 8000 }).not.toBeNull();
    const line = () => trace()?.querySelector("path:last-child") as SVGPathElement;
    const width = () => parseFloat(getComputedStyle(line()).strokeWidth);
    const stroke = () => getComputedStyle(line()).stroke;
    // --lx-accent as the browser resolves it, read through a probe so the test never names a hex.
    const resolved = (token: string): string => {
      const probe = document.body.appendChild(document.createElement("span"));
      probe.style.color = `var(${token})`;
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const accent = resolved("--lx-accent");
    await expect.poll(width).toBeCloseTo(1.5, 1);
    const rest = stroke();
    expect(rest).not.toBe(accent);
    session.set({ selection: ["ERC4626"] });
    await expect.poll(() => trace()?.hasAttribute("data-live")).toBe(true);
    await expect.poll(width).toBeCloseTo(2, 1);
    await expect.poll(stroke).toBe(accent);
    session.set({ selection: [] });
    await expect.poll(() => trace()?.hasAttribute("data-live")).toBe(false);
    await expect.poll(width).toBeCloseTo(1.5, 1);
    await expect.poll(stroke).toBe(rest);
    expect(stroke()).not.toBe(accent);
  });

  test("more contrast: a trace's line holds 2 px even without a selected end (spec L786, batch-2 #103)", async () => {
    await cdp().send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-contrast", value: "more" }] });
    try {
      await sheet(project(["VaultCore", "ERC4626"], { columns: 2 }));
      const id = "needs:VaultCore:ERC4626";
      const line = () => document.querySelector<SVGGElement>(`g[data-edge='${id}']`)?.querySelector("path:last-child") as SVGPathElement;
      await expect.poll(() => document.querySelector(`g[data-edge='${id}']`), { timeout: 8000 }).not.toBeNull();
      expect(matchMedia("(prefers-contrast: more)").matches).toBe(true);
      expect(parseFloat(getComputedStyle(line()).strokeWidth)).toBeCloseTo(2, 1);
    } finally {
      await cdp().send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-contrast", value: "no-preference" }] });
    }
  });

  test("below 75% zoom, pointing at a trace shows its reason", async () => {
    await sheet(project(["VaultCore", "ERC4626"], { columns: 2 }));
    const id = "needs:VaultCore:ERC4626";
    const label = () => document.querySelector(`[data-trace-label='${id}']`);
    await expect.poll(() => document.querySelector(`g[data-edge='${id}']`), { timeout: 8000 }).not.toBeNull();
    await runCommand({ id: "sheet.zoomTo", args: { zoom: 0.5 } }, "api");
    // Hover only once the view is drawn at 50%: a hover at the old zoom leaves the trace under the pointer's old spot.
    const drawnScale = () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".react-flow__viewport") as Element).transform).a;
    await expect.poll(drawnScale).toBe(0.5);
    await expect.poll(label).toBeNull();
    const hit = document.querySelector<SVGPathElement>(`g[data-edge='${id}'] path:first-child`) as SVGPathElement;
    // The real pointer, at the middle of the trace: the hit stroke takes it though its wrapper doesn't.
    // A transparent, zero-height path fails Playwright's visibility check, so force it: the pointer still
    // goes to the middle of its box, on the line.
    await userEvent.hover(hit, { force: true });
    await expect.poll(() => label()?.textContent).toBe("needs ERC4626");
    await userEvent.unhover(hit);
    await expect.poll(label).toBeNull();
  });

  test("ties are 2 px accent, dashed in forced colors", async () => {
    await sheet(project([AXELAR, HYPERLANE]));
    await expect.poll(() => document.querySelectorAll("path[data-edge^='tie:']").length, { timeout: 8000 }).toBe(2);
    const tie = document.querySelector<SVGPathElement>("path[data-edge^='tie:']") as SVGPathElement;
    expect(parseFloat(getComputedStyle(tie).strokeWidth)).toBe(2);
    expect(getComputedStyle(tie).strokeDasharray).toBe("none");
    await cdp().send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
    try {
      await expect.poll(() => getComputedStyle(tie).strokeDasharray).not.toBe("none");
    } finally {
      await cdp().send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "none" }] });
    }
  });
});

describe("the note's context menu (IR L196)", () => {
  test("Shift+F10 on the note lists its fixes and Go to card", async () => {
    await sheet(project([AXELAR, HYPERLANE]));
    const el = await waitForNote("collision");
    el.focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    const menu = page.getByRole("menu", { name: "Selector collision actions" });
    await expect.element(menu).toBeVisible();
    await expect.element(menu.getByRole("menuitem", { name: "Keep AxelarGatewayAdapter" })).toBeVisible();
    await expect.element(menu.getByRole("menuitem", { name: "Route to HyperlaneGatewayAdapter" })).toBeVisible();
    await expect.element(menu.getByRole("menuitem", { name: "Choose per selector…" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Go to card" }).click();
    await expect.poll(() => session.get().selection).toEqual([AXELAR]);
  });

  test("the menu key and a right click open it too; its fix routes the set", async () => {
    await sheet(project([AXELAR, HYPERLANE]));
    const el = await waitForNote("collision");
    el.focus();
    await userEvent.keyboard("{ContextMenu}");
    await expect.element(page.getByRole("menu", { name: "Selector collision actions" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("menu", { name: "Selector collision actions" })).not.toBeInTheDocument();
    await page.getByRole("note", { name: "Selector collision · 2" }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Route to HyperlaneGatewayAdapter" }).click();
    expect(owners()).toEqual({ [SEND]: HYPERLANE, [ATTRIBUTE]: HYPERLANE });
  });
});

describe("Resolve collision… (spec L437)", () => {
  test("focuses the first collision's note and its choice", async () => {
    await sheet(project([AXELAR, HYPERLANE, "VaultCore"]));
    await waitForNote("collision");
    await runCommand({ id: "collision.resolve" }, "palette");
    await expect.poll(() => (document.activeElement as HTMLElement | null)?.textContent).toBe("Keep AxelarGatewayAdapter");
    expect(focusedNoteId()).toBe(`collision:${AXELAR}+${HYPERLANE}`);
    expect(session.get().selection).toEqual([AXELAR]);
    expect(inspectorProblem()).toBe(`SEL-01:${SEND}`);
  });

  test("with three contenders it opens the owner menu", async () => {
    await sheet(project([AXELAR, CCIP, HYPERLANE]));
    await waitForNote("collision");
    await runCommand({ id: "collision.resolve" }, "palette");
    await expect.element(page.getByRole("menuitem", { name: CCIP })).toBeVisible();
  });

  test("says there's nothing to resolve", async () => {
    await sheet(project(["VaultCore"]));
    await runCommand({ id: "collision.resolve" }, "palette");
    expect(bufferedServices().log.at(-1)?.text).toBe("No selector collisions to resolve.");
  });
});

describe("F8 and ⇧F8 (IR L17, spec L300)", () => {
  test("F8 walks the problems in problem order: note, card, inspector", async () => {
    onCleanup(installShortcuts());
    await sheet(project([AXELAR, HYPERLANE, "VaultCore", "GovernedDiamondCut"], { columns: 2 }));
    await waitForNote("collision");
    const order = problemIds();
    expect(order.length).toBeGreaterThan(3);
    const visited: string[] = [];
    for (let i = 0; i < order.length; i++) {
      await userEvent.keyboard("{F8}");
      await expect.poll(() => problemCursor()?.id).not.toBe(visited.at(-1));
      visited.push(problemCursor()?.id ?? "");
      expect(inspectorProblem()).toBe(visited.at(-1));
      const problem = getAnalysis().problems.find((p) => p.id === visited.at(-1));
      if (problem?.code === "SEL-01") {
        await expect.poll(focusedNoteId).toBe(`collision:${AXELAR}+${HYPERLANE}`);
        expect(session.get().selection).toEqual([AXELAR]);
      }
      if (problem?.code === "DEP-01") {
        await expect.poll(focusedNoteId).toBe(problem.id);
        expect(session.get().selection).toEqual(["VaultCore"]);
      }
    }
    expect(visited).toEqual(order);
    // Wraps to the first.
    await userEvent.keyboard("{F8}");
    await expect.poll(() => inspectorProblem()).toBe(order[0]);
  });

  test("⇧F8 goes back from the last", async () => {
    onCleanup(installShortcuts());
    await sheet(project([AXELAR, HYPERLANE, "VaultCore"]));
    await waitForNote("collision");
    const order = problemIds();
    await userEvent.keyboard("{Shift>}{F8}{/Shift}");
    await expect.poll(() => inspectorProblem()).toBe(order.at(-1));
    await userEvent.keyboard("{Shift>}{F8}{/Shift}");
    await expect.poll(() => inspectorProblem()).toBe(order.at(-2));
  });

  test("problem.focus from elsewhere; a problem that's gone says so", async () => {
    await sheet(project(["VaultCore"]));
    const [dep] = problemIds().filter((id) => id.startsWith("DEP-01"));
    await runCommand({ id: "problem.focus", args: { problemId: dep ?? "" } }, "api");
    await expect.poll(focusedNoteId).toBe(dep);
    const gone = await runCommand({ id: "problem.focus", args: { problemId: "SEL-01:0x00000000" } }, "api");
    expect(gone).toEqual({ ok: false, reason: "This problem no longer applies." });
  });

  test("with no problems F8 says so", async () => {
    await sheet(project(["VaultCore"]));
    const empty = emptyAnalysis();
    onCleanup(provideAnalysis({ getAnalysis: () => empty, subscribe: () => () => undefined }));
    const state = await runCommand({ id: "problem.next" }, "keys");
    expect(state).toEqual({ ok: false, reason: "No problems" });
    expect(bufferedServices().log.at(-1)?.text).toBe("No problems");
  });

  test("an init problem goes to its field; a card problem without a note to its card", async () => {
    await sheet(project(["VaultCore", "ERC20"]));
    const opened: unknown[] = [];
    onCleanup(overrideCommands([command({
      id: "init.open", title: () => "Edit field", category: "Build", enabled: () => ({ ok: true }),
      run: (_ctx, args) => void opened.push(args),
    })]));
    const base = getAnalysis();
    const problem = (id: string, where: Problem["where"]): Problem =>
      ({ id, code: "INIT-01", severity: "blocker", where, params: {}, message: "Asset is missing.", fixes: [] });
    const analysis = {
      ...base,
      problems: [problem("INIT-01:bundle.p.asset", [{ kind: "init", path: "bundle.p.asset" }]), problem("STO-01:x", [{ kind: "facet", facet: "ERC20" }])],
    };
    onCleanup(provideAnalysis({ getAnalysis: () => analysis, subscribe: () => () => undefined }));
    await runCommand({ id: "problem.focus", args: { problemId: "INIT-01:bundle.p.asset" } }, "api");
    await expect.poll(() => opened).toEqual([{ focus: "bundle.p.asset" }]);
    await runCommand({ id: "problem.focus", args: { problemId: "STO-01:x" } }, "api");
    await expect.poll(() => document.activeElement?.closest(".react-flow__node")?.getAttribute("data-id")).toBe("ERC20");
    expect(session.get().selection).toEqual(["ERC20"]);
    expect(inspectorProblem()).toBe("STO-01:x");
  });
});

describe("resolve fades the note (spec L438, L784)", () => {
  test("with reduced motion it goes at once, and focus moves to its card", async () => {
    await sheet(project([AXELAR, HYPERLANE]), { reduceMotion: "on" });
    await waitForNote("collision");
    const keep = page.getByRole("button", { name: "Keep AxelarGatewayAdapter" });
    await keep.click();
    await expect.poll(() => document.querySelector("[data-note-kind='collision']")).toBeNull();
    expect(document.activeElement?.closest(".react-flow__node")?.getAttribute("data-id")).toBe(AXELAR);
  });

  test("with full motion it fades out, inert, then goes", async () => {
    await sheet(project([AXELAR, HYPERLANE]), { reduceMotion: "off" });
    await waitForNote("collision");
    await page.getByRole("button", { name: "Keep AxelarGatewayAdapter" }).click();
    await expect.poll(() => document.querySelector("[data-note-kind='collision'][data-leaving]")).not.toBeNull();
    expect(document.querySelector("[data-note-kind='collision'][data-leaving]")?.hasAttribute("inert")).toBe(true);
    expect(document.activeElement?.closest(".react-flow__node")?.getAttribute("data-id")).toBe(AXELAR);
    await expect.poll(() => document.querySelector("[data-note-kind='collision']")).toBeNull();
  });
});

describe("a note out of view (2.4.11)", () => {
  test("Tab onto a note panned off-screen brings it into the sheet", async () => {
    await sheet(project([AXELAR, HYPERLANE]));
    const el = await waitForNote("collision");
    const sheetBox = () => (document.querySelector(".react-flow") as HTMLElement).getBoundingClientRect();
    // Pan the note well past the sheet's left edge.
    panSheet(-(el.getBoundingClientRect().right - sheetBox().left) - 400, 0);
    await expect.poll(() => el.getBoundingClientRect().right < sheetBox().left).toBe(true);
    // Tab onto the note from the stop before it: the last control in S4d's panels (spec L744: card grid, tool
    // strip, notes). Starting on a card would pan the card, and the note with it, before the note had to.
    const panels = [...document.querySelectorAll<HTMLElement>(".react-flow__panel button")];
    const before = panels.filter((b) => b.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).at(-1) as HTMLElement;
    before.focus({ preventScroll: true });
    expect(el.getBoundingClientRect().right < sheetBox().left).toBe(true);
    for (let i = 0; i < 5 && document.activeElement !== el; i++) await userEvent.tab();
    expect(document.activeElement).toBe(el);
    const where = () => {
      const r = el.getBoundingClientRect();
      const s = sheetBox();
      const inside = r.left >= s.left && r.right <= s.right && r.top >= s.top && r.bottom <= s.bottom;
      return inside ? "inside" : `note ${[r.left, r.top, r.right, r.bottom].map(Math.round).join(",")} sheet ${[s.left, s.top, s.right, s.bottom].map(Math.round).join(",")} zoom ${session.get().viewports[doc.get().id]?.zoom}`;
    };
    await expect.poll(where).toBe("inside");
  });
});

describe("layer order (spec L744)", () => {
  test("the notes are a layer after React Flow's renderer, not in its viewport", async () => {
    await sheet(project([AXELAR, HYPERLANE]));
    const el = await waitForNote("collision");
    expect(el.closest(".react-flow__viewport")).toBeNull();
    const layer = el.closest("[data-sheet-layer='notes']");
    const renderer = document.querySelector(".react-flow__renderer");
    expect(layer && renderer ? renderer.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING : 0).toBeTruthy();
  });
});

describe("note button targets hold 24 x 24 px below 100% zoom (spec L770, WCAG 2.5.8)", () => {
  test("Keep and Route to… (2 contenders) at the 30% a fit of 30 cards gives", async () => {
    await sheet(project([AXELAR, HYPERLANE], { columns: 6 }));
    await waitForNote("collision");
    await runCommand({ id: "sheet.zoomTo", args: { zoom: 0.3 } }, "api");
    await drawn();
    const keep = page.getByRole("button", { name: "Keep AxelarGatewayAdapter" });
    const route = page.getByRole("button", { name: "Route to HyperlaneGatewayAdapter" });
    for (const button of [keep, route]) {
      const box = await button.element().getBoundingClientRect();
      expect(box.width, `${button}'s width`).toBeGreaterThanOrEqual(24);
      expect(box.height, `${button}'s height`).toBeGreaterThanOrEqual(24);
    }
  });

  test("the owner menu and Choose per selector… (3+ contenders) at 30%", async () => {
    await sheet(project([AXELAR, CCIP, HYPERLANE], { columns: 6 }));
    const three = `collision:${AXELAR}+${CCIP}+${HYPERLANE}`;
    await expect.poll(() => noteById(three), { timeout: 8000 }).not.toBeNull();
    ensureElementVisible(noteById(three) as HTMLElement);
    await runCommand({ id: "sheet.zoomTo", args: { zoom: 0.3 } }, "api");
    await drawn();
    const el = noteById(three) as HTMLElement;
    const owner = el.querySelector("button");
    const choose = page.getByRole("button", { name: "Choose per selector…" }).first();
    if (!owner) throw new Error("no owner menu button");
    const ownerBox = owner.getBoundingClientRect();
    expect(ownerBox.width, "the owner menu's width").toBeGreaterThanOrEqual(24);
    expect(ownerBox.height, "the owner menu's height").toBeGreaterThanOrEqual(24);
    const chooseBox = await choose.element().getBoundingClientRect();
    expect(chooseBox.width, "Choose per selector…'s width").toBeGreaterThanOrEqual(24);
    expect(chooseBox.height, "Choose per selector…'s height").toBeGreaterThanOrEqual(24);
  });
});

describe("dragging cards (spec L816, L825)", () => {
  function box(el: HTMLElement): { left: number; top: number } {
    return { left: Number.parseFloat(el.style.left), top: Number.parseFloat(el.style.top) };
  }

  /** A drag's live move: `name` at `dx`, `dy` from where it was when the drag began. */
  function moveTo(name: string, from: { x: number; y: number }, dx: number, dy: number): void {
    doc.update((p) => {
      const entry = p.layout[name];
      if (!entry) return { project: p, changed: false, summary: `${name} isn't on the sheet.` };
      return { project: { ...p, layout: { ...p.layout, [name]: { ...entry, x: from.x + dx, y: from.y + dy } } }, changed: true, summary: "Moved" };
    });
  }

  /** Where a full layout of the document as it is puts every note, with the heights they measured. */
  function placedFromScratch(): Map<string, { left: number; top: number }> {
    const heights: Record<string, number> = {};
    for (const el of document.querySelectorAll<HTMLElement>("[data-note-id]")) heights[el.dataset.noteId ?? ""] = el.offsetHeight;
    const project = doc.get();
    const overlay = computeOverlay({ layout: project.layout, recipe: project.recipe, catalog, analysis: getAnalysis(), compact: false, heights });
    return new Map(overlay.entries.map((e) => [e.note.id, { left: e.placement.rect.x, top: e.placement.rect.y }]));
  }

  test("a move carries a dragged card's note with it and leaves the other notes alone; the release places them again", async () => {
    await sheet(project([AXELAR, HYPERLANE, "VaultCore"]));
    const missing = await waitForNote("missing");
    const collision = await waitForNote("collision");
    const before = { missing: box(missing), collision: box(collision) };
    const start = doc.get().layout["VaultCore"];
    if (!start) throw new Error("VaultCore isn't on the sheet.");

    doc.begin("Moved VaultCore");
    moveTo("VaultCore", start, 96, 48);
    await drawn();
    await expect.poll(() => box(missing)).toEqual({ left: before.missing.left + 96, top: before.missing.top + 48 });
    // The collision note isn't anchored to VaultCore: the same element, in the same place.
    expect(noteById(collision.dataset.noteId ?? "")).toBe(collision);
    expect(box(collision)).toEqual(before.collision);

    // Back where it began: every note is where it was.
    moveTo("VaultCore", start, 0, 0);
    await drawn();
    await expect.poll(() => box(missing)).toEqual(before.missing);

    // Moved onto the collision's cards and released: the commit lays every note out again.
    const axelar = doc.get().layout[AXELAR];
    if (!axelar) throw new Error("Axelar isn't on the sheet.");
    moveTo("VaultCore", start, axelar.x - start.x, axelar.y - start.y + 160);
    await drawn();
    doc.commit();
    await drawn();
    await expect.poll(() => {
      const expected = placedFromScratch();
      return [...document.querySelectorAll<HTMLElement>("[data-note-id]")].every((el) => {
        const want = expected.get(el.dataset.noteId ?? "");
        const got = box(el);
        return want !== undefined && want.left === got.left && want.top === got.top;
      });
    }).toBe(true);
    expect(history.canUndo).toBe(true);
  });
});
