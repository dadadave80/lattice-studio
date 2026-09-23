import type { CommandArgs, CommandCategory } from "@/contracts";
import { command, doc, provideServices, session } from "@/contracts";
import type { CommandId, Recipe } from "@lattice-studio/core";
import { loadTemplate } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { fixtureCatalog, onCleanup, overrideCommands, renderWithStudio } from "../../../../../test/harness";
import { ProblemView } from "./ProblemView";

/** Replaces `id` with a spy that records the arguments it ran with. */
function spyOn(id: CommandId, title: (args: CommandArgs) => string, category: CommandCategory = "Build") {
  const run = vi.fn<(args: CommandArgs) => void>();
  overrideCommands([command({ id, title, category, enabled: () => ({ ok: true }), run: (_ctx, args) => run(args) })]);
  return run;
}

function project(id: string, recipe: Recipe) {
  return makeProject({ id, recipe });
}

const catalog = fixtureCatalog();
const CONTESTED = makeRecipe({ facets: ["HyperlaneGatewayAdapter", "AxelarGatewayAdapter"] }, catalog);

describe("ProblemView", () => {
  test("SEL-01: the message, both selector anchors with Locate, and both fixes", async () => {
    const locate = spyOn("sheet.locate", () => "Locate", "Sheet");
    const route = spyOn("selector.route", (args) => (args.verb === "keep" ? `Keep ${String(args.facet)}` : `Route to ${String(args.facet)}`));
    await renderWithStudio(<ProblemView view={{ kind: "problem", id: "SEL-01:0xcdfe7f5c" }} />, {
      project: project("problem-sel01", CONTESTED),
    });

    await expect.element(page.getByRole("heading", { name: "SEL-01" })).toBeVisible();
    await expect.element(page.getByText("Blocker", { exact: true })).toBeVisible();
    const message = page.getByText(/is exported by AxelarGatewayAdapter and HyperlaneGatewayAdapter/);
    await expect.element(message).toBeVisible();
    expect(message.element().textContent).toBe(
      "sendMessage(bytes,bytes,bytes[]) 0xcdfe7f5c is exported by AxelarGatewayAdapter and HyperlaneGatewayAdapter. Choose one owner.",
    );
    // The signature is code, not raw backticks.
    expect(message.element().querySelector("code")?.textContent).toBe("sendMessage(bytes,bytes,bytes[])");

    const where = page.getByRole("region", { name: "Where" });
    const anchors = where.getByRole("listitem").elements();
    expect(anchors.map((li) => li.textContent)).toEqual([
      "sendMessage(bytes,bytes,bytes[]) 0xcdfe7f5c on AxelarGatewayAdapterLocate AxelarGatewayAdapter",
      "sendMessage(bytes,bytes,bytes[]) 0xcdfe7f5c on HyperlaneGatewayAdapterLocate HyperlaneGatewayAdapter",
    ]);

    await where.getByRole("button", { name: "Locate HyperlaneGatewayAdapter" }).click();
    expect(locate).toHaveBeenLastCalledWith({ facet: "HyperlaneGatewayAdapter", selector: "0xcdfe7f5c" });
    await where.getByRole("button", { name: "Locate AxelarGatewayAdapter" }).click();
    expect(locate).toHaveBeenLastCalledWith({ facet: "AxelarGatewayAdapter", selector: "0xcdfe7f5c" });

    await page.getByRole("button", { name: "Keep AxelarGatewayAdapter" }).click();
    expect(route).toHaveBeenLastCalledWith({ selector: "0xcdfe7f5c", facet: "AxelarGatewayAdapter", verb: "keep" });
    await page.getByRole("button", { name: "Route to HyperlaneGatewayAdapter" }).click();
    expect(route).toHaveBeenLastCalledWith({ selector: "0xcdfe7f5c", facet: "HyperlaneGatewayAdapter" });
    expect(route).toHaveBeenCalledTimes(2);
  });

  test("DEP-01: the facet anchor and the registry's Place ERC4626, which places it", async () => {
    await renderWithStudio(<ProblemView view={{ kind: "problem", id: "DEP-01:VaultCore+ERC4626" }} />, {
      project: project("problem-dep01", makeRecipe({ facets: ["VaultCore"] }, catalog)),
    });
    await expect.element(page.getByRole("heading", { name: "DEP-01" })).toBeVisible();
    await expect.element(page.getByText(/^VaultCore requires ERC4626: /)).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Locate VaultCore" })).toBeVisible();
    await page.getByRole("button", { name: "Place ERC4626" }).click();
    await vi.waitFor(() => expect(doc.get().recipe.facets).toContain("ERC4626"));
  });

  test("INIT-01: an init anchor whose Fill in focuses the field", async () => {
    const focusField = spyOn("init.focusField", () => "Fill in");
    const template = loadTemplate(catalog, "GovernedVault");
    if (!template.ok) throw new Error(template.error);
    await renderWithStudio(<ProblemView view={{ kind: "problem", id: "INIT-01:bundle.p.asset" }} />, {
      project: project("problem-init01", template.value),
    });
    const where = page.getByRole("region", { name: "Where" });
    await expect.element(where.getByRole("code")).toHaveTextContent("bundle.p.asset");
    await where.getByRole("button", { name: "Fill in bundle.p.asset" }).click();
    expect(focusField).toHaveBeenLastCalledWith({ path: "bundle.p.asset" });
  });

  test("CORE-02: a diamond anchor, a warning in words, and the acknowledgement note without a duplicate button", async () => {
    await renderWithStudio(<ProblemView view={{ kind: "problem", id: "CORE-02:diamond" }} />, {
      project: project("problem-core02", CONTESTED),
    });
    await expect.element(page.getByText("Warning", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Nothing can change this diamond after deploy.")).toBeVisible();
    await expect.element(page.getByRole("region", { name: "Where" }).getByText("The diamond")).toBeVisible();
    await expect
      .element(page.getByText("The deploy review asks you to acknowledge this warning before deploying."))
      .toBeVisible();
    // Keep immutable is the acknowledgement: the registry's fix, shown once.
    expect(page.getByRole("button", { name: "Keep immutable" }).elements()).toHaveLength(1);
  });

  test("Learn more routes the inspector to the problem's doc page, offline too", async () => {
    onCleanup(provideServices({ connection: { isOnline: () => false, subscribe: () => () => {} } }));
    await renderWithStudio(<ProblemView view={{ kind: "problem", id: "SEL-01:0xcdfe7f5c" }} />, {
      project: project("problem-learn", CONTESTED),
    });
    const learn = page.getByRole("button", { name: "Learn more about SEL-01" });
    await expect.element(learn).toBeVisible();
    await expect.element(learn).not.toHaveAttribute("aria-disabled", "true");
    await learn.click();
    expect(session.get().panes.inspector.view).toEqual({ kind: "doc", code: "SEL-01" });
  });

  test("a problem that's gone renders a quiet note", async () => {
    await renderWithStudio(<ProblemView view={{ kind: "problem", id: "SEL-01:0x00000000" }} />, {
      project: project("problem-gone", CONTESTED),
    });
    await expect.element(page.getByRole("heading", { name: "SEL-01" })).toBeVisible();
    await expect.element(page.getByText("This problem no longer applies.")).toBeVisible();
  });
});
