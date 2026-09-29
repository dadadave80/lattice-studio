/**
 * Ruling R6: Save a copy states the recipe hash, catalog tag and Studio version; the `.lattice.json` body
 * stays exactly what core writes.
 */
import { recipeHash } from "@lattice-studio/core";
import { makeRecipe } from "@lattice-studio/core/testing";
import { expect, test } from "vitest";
import { createProject, openDialog, setCatalogStatus } from "@/contracts";
import { DialogHost } from "@/ui";
import { fixtureCatalog, onCleanup, renderWithStudio } from "../../../test/harness";
import { shortHash } from "@/app/format";
import { STUDIO_VERSION } from "@/app/version";

const catalog = fixtureCatalog();

function ready(): void {
  setCatalogStatus({ status: "ready", id: catalog.lattice.tag, catalog, manifest: null });
  onCleanup(() => setCatalogStatus({ status: "loading" }));
}

test("states the recipe hash, catalog tag and Studio version", async () => {
  ready();
  const created = await createProject(makeRecipe({}, catalog), "Vault");
  if (!created.ok) throw new Error(created.error);
  const hash = recipeHash(created.value.recipe, catalog);

  const screen = await renderWithStudio(<DialogHost />);
  openDialog("save-copy", { filename: "vault.lattice.json" });

  const expected = `Recipe ${shortHash(hash)} · catalog Lattice ${catalog.lattice.tag} · Studio ${STUDIO_VERSION}`;
  await expect.element(screen.getByText(expected, { exact: true })).toBeVisible();
});
