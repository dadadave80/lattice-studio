import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { afterEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { Problem } from "@lattice-studio/core";
import {
  commandRef, doc, emptyAnalysis, provideAnalysis, provideServices, runCommand, session, type ProjectsService,
  type SaveStatus,
} from "@/contracts";
import { keyContextOf } from "@/commands/keys/key-context";
import { fixtureCatalog, onCleanup, renderWithStudio, seedDeployState } from "../../test/harness";
import { Shell } from "./Shell";

const WIDTHS = [1440, 1280, 1100, 1024, 900, 768, 600, 320] as const;

/** An analysis with one INIT-01: a required argument is missing, so Fill in shows. */
function missingArgument(): void {
  const problem: Problem = {
    id: "INIT-01:asset", code: "INIT-01", severity: "blocker", where: [], params: {}, message: "", fixes: [],
  };
  const analysis = { ...emptyAnalysis(), problems: [problem] };
  onCleanup(provideAnalysis({ getAnalysis: () => analysis, subscribe: () => () => undefined }));
}

/** A projects service whose save status is `status`. */
function saveStatusOf(status: SaveStatus): void {
  const projects: ProjectsService = {
    createProject: () => Promise.reject(new Error("not in this test")),
    openProject: () => Promise.reject(new Error("not in this test")),
    saveStatus: () => status,
    subscribeSaveStatus: () => () => undefined,
    loadViewport: () => Promise.resolve(null),
    saveViewport: () => undefined,
  };
  onCleanup(provideServices({ projects }));
}

afterEach(async () => {
  await page.viewport(1440, 900);
});

function pane(id: "left" | "sheet" | "inspector" | "console"): HTMLElement {
  const el = document.getElementById(`shell-${id}`);
  if (!el) throw new Error(`shell-${id} isn't mounted.`);
  return el;
}

/** Which regions show now, by name. */
function showing(): string[] {
  return (["left", "sheet", "inspector", "console"] as const).filter((id) => pane(id).checkVisibility());
}

async function renderAt(width: number, options: Parameters<typeof renderWithStudio>[1] = {}) {
  await page.viewport(width, 900);
  const screen = await renderWithStudio(<Shell />, options);
  await expect.poll(() => document.querySelector("[data-layout]")?.getAttribute("data-layout")).toBe(tierOf(width));
  return screen;
}

function tierOf(width: number): string {
  if (width >= 1280) return "wide";
  if (width >= 1024) return "mid";
  if (width >= 768) return "narrow";
  return "phone";
}

const bar = () => page.getByRole("region", { name: "Title bar", exact: true });

/** The title bar's controls sit side by side: none overlaps the next, and all stay inside the window. */
function expectNoOverlap(titlebar: HTMLElement): void {
  const row = titlebar.getBoundingClientRect().top + 40;
  const controls = [...titlebar.querySelectorAll<HTMLElement>("button, [role='group'], fieldset")].filter(
    (el) => el.checkVisibility() && el.getBoundingClientRect().top < row,
  );
  const boxes = controls
    .filter((el) => !controls.some((other) => other !== el && other.contains(el)))
    .map((el) => el.getBoundingClientRect())
    .sort((a, b) => a.left - b.left);
  for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.left).toBeGreaterThanOrEqual(boxes[i - 1]!.right - 0.5);
  for (const box of boxes) expect(box.right).toBeLessThanOrEqual(window.innerWidth);
}

describe("regions at each width", () => {
  for (const width of WIDTHS) {
    test(`${width} px`, async () => {
      await renderAt(width);
      const tier = tierOf(width);
      const toggles = bar().getByRole("group", { name: "Panes" });
      const switcher = bar().getByRole("tablist", { name: "Panes" });
      const overflow = bar().getByRole("button", { name: "More" });
      const deploy = bar().getByRole("button", { name: /^Deploy…/ });
      const undo = bar().getByRole("button", { name: "Undo" });

      if (tier === "wide") {
        await expect.poll(showing).toEqual(["left", "sheet", "inspector", "console"]);
        await expect.element(toggles).not.toBeInTheDocument();
        await expect.element(deploy).not.toBeInTheDocument();
      } else if (tier === "phone") {
        await expect.poll(showing).toEqual(["sheet"]);
        await expect.element(switcher).toBeVisible();
        await expect.element(overflow).toBeVisible();
        await expect.element(undo).not.toBeInTheDocument();
        await expect.element(deploy).toBeVisible();
      } else {
        await expect.poll(showing).toEqual(["sheet", "console"]);
        await expect.element(toggles).toBeVisible();
        await expect.element(switcher).not.toBeInTheDocument();
        if (tier === "narrow") {
          await expect.element(deploy).toBeVisible();
          await expect.element(overflow).toBeVisible();
        } else {
          await expect.element(deploy).not.toBeInTheDocument();
          await expect.element(overflow).not.toBeInTheDocument();
        }
      }
      if (tier !== "phone") await expect.element(undo).toBeVisible();
      const titlebar = bar().element() as HTMLElement;
      expect(titlebar.scrollWidth).toBeLessThanOrEqual(titlebar.clientWidth);
      expectNoOverlap(titlebar);
    });
  }

  test("1280 px and wider: the panes keep their sizes", async () => {
    await renderAt(1440);
    expect(pane("left").getBoundingClientRect().width).toBe(240);
    expect(pane("inspector").getBoundingClientRect().width).toBe(316);
    expect(pane("console").getBoundingClientRect().height).toBe(36 + 124);
    const titlebar = bar().element() as HTMLElement;
    expect(titlebar.getBoundingClientRect().height).toBe(40);
  });
});

describe("drawers, 768-1279 px", () => {
  test("a toggle opens one side pane at a time over the sheet", async () => {
    await renderAt(1100);
    await bar().getByRole("button", { name: "Catalog" }).click();
    await expect.poll(showing).toEqual(["left", "sheet", "console"]);
    const sheet = pane("sheet").getBoundingClientRect();
    expect(sheet.left).toBe(0);
    expect(pane("left").getBoundingClientRect().right).toBeGreaterThan(sheet.left);
    await expect.element(bar().getByRole("button", { name: "Catalog" })).toHaveAttribute("aria-pressed", "true");

    await bar().getByRole("button", { name: "Inspector" }).click();
    await expect.poll(showing).toEqual(["sheet", "inspector", "console"]);
    await expect.element(bar().getByRole("button", { name: "Catalog" })).toHaveAttribute("aria-pressed", "false");

    await bar().getByRole("button", { name: "Inspector" }).click();
    await expect.poll(showing).toEqual(["sheet", "console"]);
  });

  test("Structure opens the left drawer on its tab", async () => {
    await renderAt(1100);
    await bar().getByRole("button", { name: "Structure" }).click();
    await expect.poll(showing).toContain("left");
    expect(session.get().panes.left.tab).toBe("structure");
    const tab = page.getByRole("tab", { name: "Structure" });
    await expect.element(tab).toHaveAttribute("aria-selected", "true");
    const panel = () => document.getElementById(tab.element().getAttribute("aria-controls") ?? "");
    // The dev server compiles the lazy Structure chunk on first request.
    const filled = () => panel()?.checkVisibility() && panel()?.childElementCount;
    await expect.poll(filled, { timeout: 10_000 }).toBeGreaterThan(0);
  });

  test("1024-1279 px: selecting a card opens the inspector", async () => {
    await renderAt(1100);
    session.set({ selection: ["ERC20"] });
    await expect.poll(showing).toEqual(["sheet", "inspector", "console"]);
  });

  test("768-1023 px: selecting doesn't cover the sheet", async () => {
    await renderAt(900);
    session.set({ selection: ["ERC20"] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(showing()).toEqual(["sheet", "console"]);
  });

  test("a view routed to the inspector opens its drawer", async () => {
    await renderAt(900);
    await runCommand(commandRef("help.open", { code: "SEL-01" }), "api");
    await expect.poll(showing).toContain("inspector");
  });

  test("Esc inside a drawer closes it and focus goes back to its toggle", async () => {
    await renderAt(1100);
    const toggle = bar().getByRole("button", { name: "Catalog" });
    await toggle.click();
    await expect.poll(showing).toContain("left");
    const catalogTab = page.getByRole("tab", { name: "Catalog" });
    (catalogTab.element() as HTMLElement).focus();
    await userEvent.keyboard("{Escape}");
    await expect.poll(showing).toEqual(["sheet", "console"]);
    await expect.element(toggle).toHaveFocus();
  });

  test("768-1023 px: the save status shows as an icon in every state", async () => {
    saveStatusOf({ state: "saved", text: "Saved" });
    await renderAt(900);
    await expect.element(bar().getByRole("button", { name: "Saved" })).toBeVisible();
  });

  test("a toggle moves focus into the drawer it opens; Esc brings it back", async () => {
    await renderAt(1100);
    const toggle = bar().getByRole("button", { name: "Catalog" });
    await toggle.click();
    await expect.element(page.getByRole("tab", { name: "Catalog" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(toggle).toHaveFocus();
  });

  test("the inspector opening on selection leaves focus where it was", async () => {
    await renderAt(1100);
    const undo = bar().getByRole("button", { name: "Undo" });
    (undo.element() as HTMLElement).focus();
    session.set({ selection: ["ERC20"] });
    await expect.poll(showing).toContain("inspector");
    await expect.element(undo).toHaveFocus();
  });

  test("1024-1279 px: a selection made in the left drawer keeps that drawer open", async () => {
    await renderAt(1100);
    await bar().getByRole("button", { name: "Structure" }).click();
    await expect.element(page.getByRole("tab", { name: "Structure" })).toHaveFocus();
    session.set({ selection: ["ERC20"] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(showing()).toEqual(["left", "sheet", "console"]);
  });

  test("closing a drawer from its splitter hands focus to its toggle", async () => {
    await renderAt(1100);
    await bar().getByRole("button", { name: "Catalog" }).click();
    const splitter = page.getByRole("separator", { name: "Resize left pane" });
    (splitter.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(showing).toEqual(["sheet", "console"]);
    await expect.element(bar().getByRole("button", { name: "Catalog" })).toHaveFocus();
  });

  test("hiding a pane from the keyboard never drops focus on the body", async () => {
    await renderAt(1440);
    const tab = page.getByRole("tab", { name: "Catalog" });
    (tab.element() as HTMLElement).focus();
    await runCommand(commandRef("pane.toggle", { pane: "left" }), "keys");
    await expect.poll(showing).toEqual(["sheet", "inspector", "console"]);
    await expect.element(page.getByRole("region", { name: "Sheet", exact: true })).toHaveFocus();
  });

  test("768-1023 px: Share, the theme and the palette move into the overflow menu", async () => {
    await renderAt(900);
    await bar().getByRole("button", { name: "More" }).click();
    const menu = page.getByRole("menu", { name: "More" });
    await expect.element(menu).toBeVisible();
    for (const item of ["Share", "Theme", "Command palette"]) {
      await expect.element(menu.getByRole("menuitem", { name: item, exact: true })).toBeInTheDocument();
    }
    await expect.element(menu.getByRole("menuitem", { name: "Tools", exact: true })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
  });

  test("768-1023 px: the console collapses to its summary line, and comes back at 1024 px", async () => {
    await renderAt(1440);
    expect(session.get().panes.console.open).toBe(true);
    await page.viewport(900, 900);
    await expect.poll(() => pane("console").getBoundingClientRect().height).toBe(36);
    expect(session.get().panes.console.open).toBe(false);
    await page.viewport(1100, 900);
    await expect.poll(() => pane("console").getBoundingClientRect().height).toBe(36 + 124);
  });
});

describe("under 768 px", () => {
  test("the switcher shows one pane at a time", async () => {
    await renderAt(600);
    const switcher = bar().getByRole("tablist", { name: "Panes" });
    await expect
      .poll(() => (switcher.element() as HTMLElement).innerText.split("\n").filter(Boolean))
      .toEqual(["Sheet", "Structure", "Catalog", "Inspector", "Console"]);
    for (const [tab, shows] of [
      ["Structure", "left"], ["Catalog", "left"], ["Inspector", "inspector"], ["Console", "console"], ["Sheet", "sheet"],
    ] as const) {
      await switcher.getByRole("tab", { name: tab }).click();
      await expect.poll(showing).toEqual([shows]);
    }
    expect(session.get().panes.narrow).toBe("sheet");
  });

  test("the switcher takes arrow keys", async () => {
    await renderAt(600);
    const sheetTab = bar().getByRole("tab", { name: "Sheet" });
    (sheetTab.element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => session.get().panes.narrow).toBe("structure");
    await expect.poll(showing).toEqual(["left"]);
  });

  test("the overflow menu holds what the title bar gave up", async () => {
    await renderAt(600);
    await bar().getByRole("button", { name: "More" }).click();
    const menu = page.getByRole("menu", { name: "More" });
    await expect.element(menu).toBeVisible();
    for (const item of ["Undo", "Redo", "Share", "Export", "Theme", "Command palette", "Tools"]) {
      await expect.element(menu.getByRole("menuitem", { name: item, exact: true })).toBeInTheDocument();
    }
    await userEvent.keyboard("{Escape}");
  });

  test("Fill in shows only while arguments are missing", async () => {
    await renderAt(600);
    await runCommand(commandRef("pane.show", { pane: "inspector" }), "api");
    await expect.poll(showing).toEqual(["inspector"]);
    await expect.element(page.getByRole("button", { name: /^Fill in/ })).not.toBeInTheDocument();
  });

  test("Fill in sits at the top of the Inspector pane and in the overflow menu", async () => {
    missingArgument();
    await renderAt(600);
    await runCommand(commandRef("pane.show", { pane: "inspector" }), "api");
    const inspector = pane("inspector");
    const fillIn = page.getByRole("region", { name: "Inspector", exact: true }).getByRole("button", { name: /^Fill in/ });
    await expect.element(fillIn).toBeVisible();
    expect(inspector.querySelector("button")).toBe(fillIn.element());
    await bar().getByRole("button", { name: "More" }).click();
    await expect.element(page.getByRole("menu", { name: "More" }).getByRole("menuitem", { name: "Fill in" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
  });

  test("each switcher tab points at the region it shows", async () => {
    await renderAt(600);
    const switcher = bar().getByRole("tablist", { name: "Panes" });
    for (const [tab, id] of [
      ["Sheet", "shell-sheet"], ["Structure", "shell-left"], ["Catalog", "shell-left"], ["Inspector", "shell-inspector"],
      ["Console", "shell-console"],
    ] as const) {
      await expect.element(switcher.getByRole("tab", { name: tab })).toHaveAttribute("aria-controls", id);
    }
  });

  test("the theme and the Select and Hand tools are radios in the overflow menu", async () => {
    await renderAt(600);
    await bar().getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Theme" }).click();
    await expect.element(page.getByRole("menuitemradio", { name: "Shop" })).toHaveAttribute("aria-checked", "true");
    await expect.element(page.getByRole("menuitemradio", { name: "Draft" })).toHaveAttribute("aria-checked", "false");
    await userEvent.keyboard("{Escape}{Escape}");
    await bar().getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Tools" }).click();
    const tools = page.getByRole("menu", { name: "Tools" });
    await expect.element(tools.getByRole("menuitemradio", { name: "Select" })).toHaveAttribute("aria-checked", "true");
    const labels = [...(tools.element() as HTMLElement).querySelectorAll("[role^='menuitem'], [role='separator']")].map(
      (el) => (el.getAttribute("role") === "separator" ? "·" : document.getElementById(el.getAttribute("aria-labelledby") ?? "")?.textContent),
    );
    expect(labels).toEqual([
      "Select", "Hand", "·", "Zoom out", "Zoom in", "Fit", "·", "Init order", "Tidy", "Auto-layout", "·", "Minimap",
    ]);
    await expect.element(tools.getByRole("menuitem", { name: "Auto-layout" })).toHaveAccessibleDescription("Arrives in v1.1");
    await userEvent.keyboard("{Escape}{Escape}");
  });

  test("320 px: no horizontal scroll outside the sheet; the name truncates and the chip shrinks", async () => {
    const project = makeProject({ name: "A governed vault with a very long name indeed", recipe: makeRecipe({}, fixtureCatalog()) });
    await renderAt(320, { project });
    await expect.poll(showing).toEqual(["sheet"]);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    const titlebar = bar().element() as HTMLElement;
    expect(titlebar.scrollWidth).toBeLessThanOrEqual(titlebar.clientWidth);
    for (const id of ["sheet"] as const) expect(pane(id).getBoundingClientRect().right).toBeLessThanOrEqual(320);

    const name = bar().getByRole("button", { name: project.name });
    await expect.element(name).toBeVisible();
    const text = (name.element() as HTMLElement).querySelector("span") as HTMLElement;
    expect(text.scrollWidth).toBeGreaterThan(text.clientWidth);

    // A deploy in flight: the chip shrinks to its dot and one word, and keeps its full words for assistive tech.
    seedDeployState({ phase: "pending", chainId: 11155111 });
    const chip = bar().getByRole("button", { name: "Pending · Chain 11155111" });
    await expect.element(chip).toBeVisible();
    const shown = (chip.element() as HTMLElement).querySelector("[aria-hidden='true']:not(:empty)") as HTMLElement;
    expect(shown.textContent).toBe("Pending");
    expect((chip.element() as HTMLElement).getBoundingClientRect().right).toBeLessThanOrEqual(320);
    expect(titlebar.scrollWidth).toBeLessThanOrEqual(titlebar.clientWidth);
    expectNoOverlap(titlebar);

    for (const which of ["structure", "inspector", "console"] as const) {
      await runCommand(commandRef("pane.show", { pane: which }), "api");
      await expect.poll(() => document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    }
  });
});

describe("splitters", () => {
  test("arrows, Shift, Home, End and Enter resize and collapse the left pane", async () => {
    await renderAt(1440);
    const splitter = page.getByRole("separator", { name: "Resize left pane" });
    (splitter.element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(session.get().panes.left.size).toBe(248);
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(session.get().panes.left.size).toBe(280);
    await userEvent.keyboard("{End}");
    expect(session.get().panes.left.size).toBe(360);
    await expect.poll(() => pane("left").getBoundingClientRect().width).toBe(360);
    await userEvent.keyboard("{Home}");
    expect(session.get().panes.left.size).toBe(200);
    await userEvent.keyboard("{Enter}");
    await expect.poll(showing).toEqual(["sheet", "inspector", "console"]);
    await userEvent.keyboard("{Enter}");
    await expect.poll(showing).toEqual(["left", "sheet", "inspector", "console"]);
  });

  test("the inspector's splitter grows it leftward", async () => {
    await renderAt(1440);
    const splitter = page.getByRole("separator", { name: "Resize inspector" });
    (splitter.element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(session.get().panes.inspector.size).toBe(324);
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(session.get().panes.inspector.size).toBe(308);
  });

  test("the console resizes up to half the window's height", async () => {
    await renderAt(1440);
    const splitter = page.getByRole("separator", { name: "Resize console" });
    await expect.element(splitter).toHaveAttribute("aria-valuemax", String(Math.floor(900 / 2) - 36));
    (splitter.element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(session.get().panes.console.size).toBe(132);
    await userEvent.keyboard("{End}");
    await expect.poll(() => pane("console").getBoundingClientRect().height).toBe(450);
  });

  test("the left pane's menu has Narrower, Wider and Collapse", async () => {
    await renderAt(1440);
    await page.getByRole("button", { name: "Left pane menu" }).click();
    await page.getByRole("menuitem", { name: "Wider" }).click();
    expect(session.get().panes.left.size).toBe(248);
    await page.getByRole("menuitem", { name: "Collapse" }).click();
    await expect.poll(showing).toEqual(["sheet", "inspector", "console"]);
  });

  test("pane sizes stay out of undo", async () => {
    await renderAt(1440);
    const before = doc.state().lastChange;
    const splitter = page.getByRole("separator", { name: "Resize left pane" });
    (splitter.element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(doc.state().lastChange).toBe(before);
    expect(doc.state().canUndo).toBe(false);
  });
});

describe("the sheet's keys", () => {
  test("work as soon as F6 lands on the sheet region", async () => {
    await renderAt(1440);
    const region = pane("sheet");
    region.focus();
    expect(document.activeElement).toBe(region);
    expect(keyContextOf(region)).toBe("sheet");
  });
});

describe("the sheet stays put", () => {
  test("pane changes and new widths never remount the sheet", async () => {
    await renderAt(1440);
    const sheet = pane("sheet").firstElementChild;
    expect(sheet).not.toBeNull();
    await runCommand(commandRef("pane.toggle", { pane: "console" }), "api");
    await runCommand(commandRef("pane.toggle", { pane: "left" }), "api");
    session.set((s) => ({ panes: { ...s.panes, console: { ...s.panes.console, maximized: true } } }));
    for (const width of [1100, 900, 600, 320, 1440]) {
      await page.viewport(width, 900);
      await expect.poll(() => document.querySelector("[data-layout]")?.getAttribute("data-layout")).toBe(tierOf(width));
      expect(pane("sheet").firstElementChild).toBe(sheet);
    }
  });
});
