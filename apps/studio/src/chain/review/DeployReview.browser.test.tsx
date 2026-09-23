import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { renderReview, section, templateProject } from "./test-support";

describe("the deploy review", () => {
  test("opens with its heading focused, nine sections and the controller opened", async () => {
    const { dialog, controller } = await renderReview({ project: templateProject("ERC20") });
    await expect.element(dialog.getByRole("heading", { name: "Deploy ERC20" })).toHaveFocus();
    for (const title of ["Network", "Deployer", "Address", "What gets cut", "Init", "Authority after deploy", "Checks", "Cost", "Simulation"]) {
      await expect.element(section(title)).toBeVisible();
    }
    await expect.poll(() => controller.methods()).toContain("open");
    await expect.element(section("Network").getByText("Sepolia · LatticeFactory ✓ · 7 of 7 facets and init contracts ✓")).toBeVisible();
    await expect.element(page.getByText("Needs a tick").first()).toBeVisible();
  });
});
