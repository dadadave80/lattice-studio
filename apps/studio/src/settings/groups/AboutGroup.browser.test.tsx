import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { version } from "../../../package.json";
import { fixtureCatalog, renderWithStudio } from "../../../test/harness";
import { AboutGroup } from "./AboutGroup";

describe("AboutGroup", () => {
  test("shows the version, the catalog's id, tag, commit and hash, its provisional note, and each package's own license", async () => {
    const catalog = fixtureCatalog();
    await renderWithStudio(<AboutGroup />);
    // The harness's fixture catalog uses its tag as its id; the real app's id and tag can differ.
    await expect.element(page.getByText(`Lattice ${catalog.lattice.tag}`, { exact: false })).toBeVisible();
    await expect.element(page.getByText(`(${catalog.lattice.tag})`, { exact: false })).toBeVisible();
    await expect.element(page.getByText(catalog.lattice.commit, { exact: false })).toBeVisible();
    await expect.element(page.getByText(catalog.hash, { exact: false })).toBeVisible();
    if (catalog.provisional) {
      await expect.element(page.getByText(catalog.provisional)).toBeVisible();
    }
    await expect.element(page.getByRole("heading", { name: "Licenses" })).toBeVisible();
    await expect.element(page.getByText("react — MIT", { exact: true })).toBeVisible();
    await expect.element(page.getByText("idb — ISC", { exact: true })).toBeVisible();
  });

  test("shows a loading state when there's no catalog yet, without crashing", async () => {
    await renderWithStudio(<AboutGroup />, { catalog: null });
    await expect.element(page.getByText("Catalog: loading…")).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Licenses" })).toBeVisible();
  });

  test("names Studio's version from its package (spec L638)", async () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    await renderWithStudio(<AboutGroup />);
    await expect.element(page.getByText(`Version ${version}`, { exact: true })).toBeVisible();
  });
});
