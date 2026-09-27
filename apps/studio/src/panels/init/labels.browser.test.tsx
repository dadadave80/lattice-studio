/**
 * ENS labels that persist (spec L462): the name typed into an address field is stored with the project, so it
 * survives a reload and travels in the project file.
 */
import { exportProjectFile } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import { afterEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createProject, doc } from "@/contracts";
import { fakeDoc, testPersistence } from "@/persist/testing";
import { fakeChainService, renderWithStudio } from "../../../test/harness";
import { resetInitUi } from "./init-ui-store";
import { InitEditor } from "./InitEditor";
import { SAFE, templateRecipe } from "./test-support";

afterEach(resetInitUi);

describe("ENS labels kept with the project (spec L462)", () => {
  test("a label survives a reload and is in the project file", async () => {
    const chain = fakeChainService({ ens: { "safe.eth": SAFE } });
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { session: { chainId: 11155111 }, chain });
    const store = testPersistence();
    const created = await createProject(templateRecipe("SafeDiamondCut"), "Vault");
    if (!created.ok) throw new Error(created.error);
    const id = created.value.id;

    const safe = page.getByRole("textbox", { name: "Safe", exact: true });
    await safe.fill("safe.eth");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText(`safe.eth (${SAFE})`)).toBeVisible();
    expect(doc.get().labels).toEqual({ "steps[0].safe": "safe.eth" });
    await store.flush();

    // Another tab reads what was stored, as a reload would.
    const other = testPersistence({ dbName: store.dbName, doc: fakeDoc(makeProject({ id: "untitled" })), provide: false, page: null });
    const opened = await other.projects.openProject(id);
    if (!opened.ok) throw new Error(opened.error);
    expect(opened.value.labels).toEqual({ "steps[0].safe": "safe.eth" });
    const file = JSON.parse(exportProjectFile(opened.value, []).text) as { project: { labels?: Record<string, string> } };
    expect(file.project.labels).toEqual({ "steps[0].safe": "safe.eth" });

    // After the reload nothing typed this session remains: the name comes from the project alone.
    resetInitUi();
    doc.load(opened.value);
    await expect.element(page.getByText(`safe.eth (${SAFE})`)).toBeVisible();
  });
});
