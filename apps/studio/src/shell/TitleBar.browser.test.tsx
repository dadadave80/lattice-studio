import type { Analysis, Deployment, Hex } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  commandRef, commandState, doc, emptyAnalysis, provideAnalysis, putDeployment, runCommand, session, settings,
} from "@/contracts";
import { bufferedServices, fixtureCatalog, onCleanup, renderWithStudio, seedDeployState } from "../../test/harness";
import { Shell } from "./Shell";

const bar = () => page.getByRole("region", { name: "Title bar", exact: true });
const HASH: Hex = `0x${"ab".repeat(32)}`;

function useAnalysisOf(analysis: Analysis): void {
  onCleanup(provideAnalysis({ getAnalysis: () => analysis, subscribe: () => () => undefined }));
}

function project(name = "GovernedVault") {
  return makeProject({ name, recipe: makeRecipe({}, fixtureCatalog()) });
}

describe("the project name", () => {
  test("click to rename; Enter commits", async () => {
    await renderWithStudio(<Shell />, { project: project() });
    await bar().getByRole("button", { name: "GovernedVault" }).click();
    const field = bar().getByRole("textbox", { name: "Project name" });
    await expect.element(field).toHaveFocus();
    await userEvent.keyboard("{ControlOrMeta>}a{/ControlOrMeta}Treasury{Enter}");
    await expect.poll(() => doc.get().name).toBe("Treasury");
    await expect.element(bar().getByRole("button", { name: "Treasury" })).toHaveFocus();
  });

  test("leaving the field commits, once; Enter and Esc aren't followed by a second commit", async () => {
    await renderWithStudio(<Shell />, { project: project() });
    let edits = 0;
    onCleanup(doc.subscribe((state, previous) => {
      if (state.lastChange !== previous.lastChange && state.lastChange?.kind === "edit") edits += 1;
    }));

    await bar().getByRole("button", { name: "GovernedVault" }).click();
    await userEvent.keyboard("{ControlOrMeta>}a{/ControlOrMeta}Treasury");
    (bar().getByRole("button", { name: "Undo" }).element() as HTMLElement).focus();
    await expect.poll(() => doc.get().name).toBe("Treasury");
    expect(edits).toBe(1);

    await bar().getByRole("button", { name: "Treasury" }).click();
    await userEvent.keyboard("{ControlOrMeta>}a{/ControlOrMeta}Vault{Enter}");
    await expect.poll(() => doc.get().name).toBe("Vault");
    (bar().getByRole("button", { name: "Undo" }).element() as HTMLElement).focus();
    await bar().getByRole("button", { name: "Vault" }).click();
    await userEvent.keyboard("{ControlOrMeta>}a{/ControlOrMeta}Other{Escape}");
    (bar().getByRole("button", { name: "Undo" }).element() as HTMLElement).focus();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(doc.get().name).toBe("Vault");
    expect(edits).toBe(2);
  });

  test("Esc reverts", async () => {
    await renderWithStudio(<Shell />, { project: project() });
    await bar().getByRole("button", { name: "GovernedVault" }).click();
    await userEvent.keyboard("{ControlOrMeta>}a{/ControlOrMeta}Something else{Escape}");
    await expect.element(bar().getByRole("button", { name: "GovernedVault" })).toHaveFocus();
    expect(doc.get().name).toBe("GovernedVault");
  });

  test("an empty name says why it isn't taken", async () => {
    await renderWithStudio(<Shell />, { project: project() });
    await bar().getByRole("button", { name: "GovernedVault" }).click();
    await userEvent.keyboard("{ControlOrMeta>}a{/ControlOrMeta}{Backspace}{Enter}");
    await expect.poll(() => bufferedServices().log.at(-1)?.text).toBe("A project needs a name.");
    expect(doc.get().name).toBe("GovernedVault");
  });

  test("read-only: the name says why it can't be renamed", async () => {
    await renderWithStudio(<Shell />, { project: project(), session: { readOnly: "Another tab is editing this project" } });
    const name = bar().getByRole("button", { name: /^GovernedVault/ });
    await expect.element(name).toHaveAttribute("aria-disabled", "true");
    await expect.element(name).toHaveAccessibleDescription("Another tab is editing this project");
    (name.element() as HTMLElement).click();
    await expect.element(bar().getByRole("textbox", { name: "Project name" })).not.toBeInTheDocument();
  });
});

/** A confirmed r1 on Sepolia whose recipe hash matches `HASH`: the chip reads Live. */
function liveRecord(projectId: string): Deployment {
  return {
    projectId, chainId: 11155111, address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", path: "factory",
    deployer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", salt: `0x${"00".repeat(32)}`, status: "confirmed",
    recipeHash: HASH, catalogHash: HASH, at: "2026-01-01T00:00:00.000Z", verification: "exact_match", revision: 1,
  };
}

describe("the status chip", () => {
  test("says Not deployed, and why it can't open the Deployments list while it can't", async () => {
    await renderWithStudio(<Shell />);
    const chip = bar().getByRole("button", { name: /^Not deployed/ });
    await expect.element(chip).toBeVisible();
    // Whichever neighbors have landed: the chip is disabled exactly when Deployments can't open, and says why.
    const show = commandState(commandRef("deployments.show"), "button");
    if (show.ok) {
      await expect.element(chip).not.toHaveAttribute("aria-disabled", "true");
    } else {
      await expect.element(chip).toHaveAttribute("aria-disabled", "true");
      await expect.element(chip).toHaveAccessibleDescription(show.reason);
    }
  });

  test("reads the live record on the selected chain", async () => {
    useAnalysisOf({ ...emptyAnalysis(), recipeHash: HASH });
    const open = project();
    await putDeployment(liveRecord(open.id));
    await renderWithStudio(<Shell />, { project: open, session: { chainId: 11155111 }, chain: true });
    await expect.element(bar().getByRole("button", { name: /^Live · Sepolia · r1/ })).toBeVisible();
  });

  test("clicking a live chip shows the Deployments list (IR L67)", async () => {
    useAnalysisOf({ ...emptyAnalysis(), recipeHash: HASH });
    const open = project();
    await putDeployment(liveRecord(open.id));
    const closed = { ...session.get().panes, inspector: { ...session.get().panes.inspector, open: false } };
    await renderWithStudio(<Shell />, { project: open, session: { chainId: 11155111, panes: closed }, chain: true });
    const chip = bar().getByRole("button", { name: /^Live · Sepolia · r1/ });
    await expect.element(chip).toBeVisible();
    await chip.click();
    const inspector = page.getByRole("region", { name: "Inspector", exact: true });
    const heading = inspector.getByRole("heading", { name: "Deployments", exact: true });
    await expect.element(heading, { timeout: 10_000 }).toBeVisible();
    await expect.element(heading).toHaveFocus();
    await expect.element(inspector.getByRole("region", { name: "Deployments", exact: true })).toBeInViewport();
  });

  test("while a deploy is in flight, follows the deploy", async () => {
    await renderWithStudio(<Shell />, { session: { chainId: 11155111 }, chain: true });
    seedDeployState({ phase: "proposed", chainId: 11155111 });
    await expect.element(bar().getByRole("button", { name: /^Proposed · Sepolia \(Safe\)/ })).toBeVisible();
  });
});

describe("the App menu", () => {
  test("lists the spec's items, each on its command", async () => {
    await renderWithStudio(<Shell />);
    await bar().getByRole("button", { name: "Lattice Studio" }).click();
    const menu = page.getByRole("menu", { name: "App menu" });
    await expect.element(menu).toBeVisible();
    const items = [
      "Projects", "New project", "Open…", "Save a copy…", "Open diamond…", "Settings", "Keyboard shortcuts", "Help",
      "Take the tour", "About",
    ];
    const labels = () =>
      [...(menu.element() as HTMLElement).querySelectorAll("[role='menuitem']")].map(
        (el) => document.getElementById(el.getAttribute("aria-labelledby") ?? "")?.textContent,
      );
    await expect.poll(labels).toEqual(items);
    await expect.element(menu.getByRole("menuitem", { name: "Open diamond…" })).toHaveAccessibleDescription("Arrives in v2");
    await menu.getByRole("menuitem", { name: "Help" }).click();
    await expect.poll(() => session.get().panes.inspector.view).toEqual({ kind: "doc" });
  });

  test("app.menu opens it from anywhere", async () => {
    await renderWithStudio(<Shell />);
    await runCommand(commandRef("app.menu"), "palette");
    await expect.element(page.getByRole("menu", { name: "App menu" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("menu", { name: "App menu" })).not.toBeInTheDocument();
  });

  test("the brand button reads ≡, the mark, then the name; the mark takes the button's ink, `text`, in both themes", async () => {
    await renderWithStudio(<Shell />, { theme: "light" });
    const brand = bar().getByRole("button", { name: "Lattice Studio", exact: true });
    await expect.element(brand).toBeVisible();
    const button = brand.element() as HTMLElement;
    const glyph = button.querySelector("svg[data-icon='menu']") as SVGSVGElement;
    const mark = button.querySelector("svg[data-logomark]") as SVGSVGElement;
    expect(glyph).not.toBeNull();
    expect(mark).not.toBeNull();
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect(mark.querySelectorAll("path").length).toBe(3);
    expect(mark.getBoundingClientRect().width).toBe(19);
    expect(glyph.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mark.nextSibling?.textContent).toBe("Lattice Studio");
    // A probe in `text`, so the check follows the token and not a literal color.
    const probe = document.createElement("span");
    probe.style.color = "var(--lx-text)";
    document.body.append(probe);
    onCleanup(() => probe.remove());
    const inks = () => ({
      stroke: getComputedStyle(mark).stroke, color: getComputedStyle(button).color, text: getComputedStyle(probe).color,
    });
    const light = inks();
    expect(light.stroke).toBe(light.color);
    expect(light.color).toBe(light.text);
    document.documentElement.dataset.theme = "dark";
    // The button's color transitions (120 ms); wait for it to land on the dark ink before comparing.
    await expect.poll(() => inks().color).toBe(inks().text);
    const dark = inks();
    expect(dark.stroke).toBe(dark.color);
    expect(dark.color).not.toBe(light.color);
  });

  test("the brand button opens the menu by click and by keyboard", async () => {
    await renderWithStudio(<Shell />);
    const brand = bar().getByRole("button", { name: "Lattice Studio", exact: true });
    const menu = () => page.getByRole("menu", { name: "App menu" });
    await brand.click();
    await expect.element(menu()).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(menu()).not.toBeInTheDocument();
    (brand.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(menu()).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(menu()).not.toBeInTheDocument();
  });

  test("the compact tier keeps the mark and the name, and the hidden name adds no width", async () => {
    await page.viewport(1000, 900);
    try {
      await renderWithStudio(<Shell />);
      await expect.poll(() => document.querySelector("[data-layout]")?.getAttribute("data-layout")).toBe("narrow");
      const brand = bar().getByRole("button", { name: "Lattice Studio", exact: true });
      await expect.element(brand).toBeVisible();
      const mark = (brand.element() as HTMLElement).querySelector("svg[data-logomark]") as SVGSVGElement;
      expect(mark.getBoundingClientRect().width).toBe(19);
      const wordmark = mark.parentElement as HTMLElement;
      const hidden = wordmark.querySelector("span") as HTMLElement;
      expect(hidden.textContent).toBe("Lattice Studio");
      expect(hidden.getBoundingClientRect().width).toBeLessThanOrEqual(1);
      expect(wordmark.getBoundingClientRect().width).toBe(19);
    } finally {
      await page.viewport(1440, 900);
    }
  });
});

describe("the other controls", () => {
  test("Undo, Redo, Share, the theme and ⌘K run their commands, or say why not", async () => {
    await renderWithStudio(<Shell />);
    await expect.element(bar().getByRole("button", { name: "Undo" })).toHaveAccessibleDescription("Nothing to undo");
    await expect.element(bar().getByRole("button", { name: /^Share/ })).toHaveAttribute("aria-disabled", "true");
    await expect.element(bar().getByRole("button", { name: /(⌘|Ctrl\+)K ?Command palette/ })).toBeVisible();
    await expect.element(bar().getByRole("group", { name: "Theme" })).toBeVisible();
  });

  test("the theme switch names Light and Dark, in that order, and confirms a switch", async () => {
    await renderWithStudio(<Shell />, { theme: "dark" });
    const theme = bar().getByRole("group", { name: "Theme" });
    expect(theme.getByRole("button").elements().map((b) => b.getAttribute("aria-label"))).toEqual(["Light", "Dark"]);
    await expect.element(theme.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    await theme.getByRole("button", { name: "Light" }).click();
    await expect.poll(() => settings.get().theme).toBe("light");
    expect(bufferedServices().log.at(-1)?.text).toBe("Theme: Light.");
    await expect.element(theme.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
  });

  test("the theme switch shows a sun and a moon, and keeps the names Light and Dark", async () => {
    await renderWithStudio(<Shell />, { theme: "dark" });
    const theme = bar().getByRole("group", { name: "Theme" });
    const light = theme.getByRole("button", { name: "Light", exact: true });
    const dark = theme.getByRole("button", { name: "Dark", exact: true });
    await expect.element(light).toBeVisible();
    await expect.element(dark).toBeVisible();
    const options = theme.getByRole("button").elements();
    expect(options.map((b) => b.textContent)).toEqual(["", ""]);
    expect(options.map((b) => b.querySelector("svg")?.getAttribute("data-icon"))).toEqual(["sun", "moon"]);
    expect(options.map((b) => b.querySelector("svg")?.getAttribute("aria-hidden"))).toEqual(["true", "true"]);
    for (const option of options) {
      const rect = option.getBoundingClientRect();
      expect(rect.width).toBeGreaterThanOrEqual(24);
      expect(rect.height).toBeGreaterThanOrEqual(24);
    }
    expect(getComputedStyle(dark.element()).backgroundSize).toBe("100% 2px");
    await light.hover();
    await expect.poll(() => document.querySelector("[data-tooltip]")?.textContent).toBe("Light");
    dark.element().focus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.element(light).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(light).toHaveAttribute("aria-pressed", "true");
  });

  test("the save status shows its details on click", async () => {
    await renderWithStudio(<Shell />);
    await bar().getByRole("button", { name: "Not saved" }).click();
    await expect.element(page.getByRole("dialog", { name: "Not saved" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
  });
});

describe("pane commands", () => {
  test("pane.show says so when the pane already shows", async () => {
    await renderWithStudio(<Shell />);
    await runCommand(commandRef("pane.show", { pane: "inspector" }), "palette");
    expect(bufferedServices().log.at(-1)?.text).toBe("The inspector is already showing.");
  });

  test("pane.toggle hides and shows, and announces it", async () => {
    await renderWithStudio(<Shell />);
    await runCommand(commandRef("pane.toggle", { pane: "inspector" }), "palette");
    await expect.poll(() => document.getElementById("shell-inspector")?.hidden).toBe(true);
    expect(bufferedServices().announce.at(-1)?.[0]).toBe("Hid the inspector.");
    await runCommand(commandRef("pane.toggle", { pane: "inspector" }), "palette");
    await expect.poll(() => document.getElementById("shell-inspector")?.hidden).toBe(false);
  });

  test("Go to inspector reaches a closed drawer", async () => {
    await page.viewport(1100, 900);
    try {
      await renderWithStudio(<Shell />);
      await runCommand(commandRef("region.focus", { region: "inspector" }), "keys");
      await expect.element(page.getByRole("region", { name: "Inspector", exact: true })).toHaveFocus();
    } finally {
      await page.viewport(1440, 900);
    }
  });
});
