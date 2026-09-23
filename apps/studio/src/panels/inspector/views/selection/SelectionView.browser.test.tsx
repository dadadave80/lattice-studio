import type { CommandId } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { command, commandRef, commandState } from "@/contracts";
import { fixtureCatalog, overrideCommands, renderWithStudio } from "../../../../../test/harness";
import { SelectionView } from "./SelectionView";

function spy(id: CommandId, title: string) {
  const run = vi.fn();
  overrideCommands([command({ id, title: () => title, category: "Build", enabled: () => ({ ok: true }), run })]);
  return run;
}

const FACETS = ["HyperlaneGatewayAdapter", "AxelarGatewayAdapter", "Receive"];

async function render(selection: string[], id: string) {
  await renderWithStudio(<SelectionView view={{ kind: "selection" }} />, {
    project: makeProject({ id, recipe: makeRecipe({ facets: FACETS }, fixtureCatalog()) }),
    session: { selection },
  });
}

describe("selection view", () => {
  test("one row per selected card with routed/total and Open {name}", async () => {
    const show = spy("inspector.show", "Open in inspector");
    await render(["AxelarGatewayAdapter", "Receive", "NotPlaced"], "selection-rows");
    await expect.element(page.getByRole("heading", { level: 2, name: "2 facets selected" })).toBeVisible();
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-facet]"));
    expect(rows.map((row) => row.dataset.facet)).toEqual(["AxelarGatewayAdapter", "Receive"]);
    expect(rows[0]?.textContent).toContain("7/9 selectors");
    expect(rows[1]?.textContent).toContain("1/1 selector");
    await page.getByRole("button", { name: "Open Receive" }).click();
    expect(show.mock.calls[0]?.[1]).toEqual({ facet: "Receive" });
  });

  test("combined problems, each once", async () => {
    await render(["HyperlaneGatewayAdapter", "AxelarGatewayAdapter"], "selection-problems");
    await expect.element(page.getByRole("heading", { level: 3, name: "Problems" })).toBeVisible();
    const ids = Array.from(document.querySelectorAll<HTMLElement>("[data-problem]")).map((el) => el.dataset.problem);
    expect(ids).toContain("SEL-01:0xcdfe7f5c");
    expect(ids).toContain("SEL-01:0xdc680a0f");
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("Remove {n}, Tidy selection and Move to… act on the selection", async () => {
    const tidy = spy("layout.tidySelection", "Tidy selection");
    const move = spy("sheet.moveTo", "Move to…");
    await render(["AxelarGatewayAdapter", "Receive"], "selection-actions");
    // The registry's own title for Remove {n}.
    expect(commandState(commandRef("facet.remove", { facets: ["AxelarGatewayAdapter", "Receive"] })).title).toBe("Remove 2 facets");
    await expect.element(page.getByRole("button", { name: "Remove 2 facets" })).toBeVisible();
    await page.getByRole("button", { name: "Tidy selection" }).click();
    await page.getByRole("button", { name: "Move to…" }).click();
    expect(tidy).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledTimes(1);
    const remove = spy("facet.remove", "Remove 2 facets");
    await page.getByRole("button", { name: "Remove 2 facets" }).click();
    expect(remove.mock.calls[0]?.[1]).toEqual({ facets: ["AxelarGatewayAdapter", "Receive"] });
  });
});
