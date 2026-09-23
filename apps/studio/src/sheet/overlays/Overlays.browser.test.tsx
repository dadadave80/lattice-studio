/**
 * Traces, ties, notes and problem navigation on the real sheet (brief S4c): the collision note and its owner
 * choices writing `owners`, the three-contender owner menu, Choose per selector, the seam and missing-dependency
 * notes, the note's context menu, Resolve collision…, F8 in problem order, and the fade with reduced motion.
 */
import type { Hex4, Problem, Project, Recipe } from "@lattice-studio/core";
import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { command, doc, emptyAnalysis, getAnalysis, history, provideAnalysis, runCommand, session } from "@/contracts";
import { bufferedServices } from "@/contracts/services";
import { installShortcuts } from "@/commands/keys/dispatcher";
import { DialogHost } from "@/ui/overlays/DialogHost";
import { fixtureCatalog, onCleanup, overrideCommands } from "../../../test/harness";
import { cardProject } from "../card/testing/projects";
import { renderSheet } from "../canvas/testing/sheet-harness";
import { problemCursor, resetProblemCursor } from "./navigate";
import { clearNoteFocus } from "./note-focus";

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

async function waitForNote(kind: string): Promise<HTMLElement> {
  await expect.poll(() => note(kind)).not.toBeNull();
  return note(kind) as HTMLElement;
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
    await expect.poll(() => noteById(three)).not.toBeNull();
    expect(noteById(`collision:${CCIP}+${HYPERLANE}`)).not.toBeNull();
    const el = noteById(three) as HTMLElement;
    expect(el.querySelector("button")?.textContent).toBe(`Owner: ${AXELAR}`);
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
