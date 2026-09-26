import type { Project } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { commandRef, commandState, createProject, doc, isPlaceholder, openProject, session } from "@/contracts";
import { BannerHost } from "@/feedback/BannerHost";
import { editLockState } from "@/persist/current";
import type { Persistence } from "@/persist/persistence";
import { fakeDoc, testPersistence, type FakeDoc } from "@/persist/testing";
import { renderWithStudio } from "../../test/harness";
import { ELSEWHERE, HANDED_OVER, UNBUNDLED } from "./copy";
import { readOnlyReason, syncReadOnly } from "./read-only";
import { resetFlows, template } from "./test-support";

afterEach(() => {
  resetFlows();
});

const PLACE = commandRef("facet.place", { facet: "Pausable" });
const TAKE_OVER = commandRef("project.takeOverEditing");

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

/** Another tab on the same database, opening `project`. */
async function otherTab(first: Persistence, project: Project): Promise<{ tab: Persistence; tabDoc: FakeDoc }> {
  const tabDoc = fakeDoc(makeProject({ id: "untitled" }));
  const tab = testPersistence({ dbName: first.dbName, doc: tabDoc, provide: false, page: null, stealAfter: 200 });
  const opened = await tab.projects.openProject(project.id);
  if (!opened.ok) throw new Error(opened.error);
  return { tab, tabDoc };
}

async function created(): Promise<Project> {
  const result = await createProject(template("ERC20"), "Vault");
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function tryEdit(): boolean {
  return doc.apply("Renamed", (p) => ({ project: { ...p, name: "Edited" }, changed: true, summary: "Renamed" })).changed;
}

describe("two tabs (Flow 10 step 8)", () => {
  test("the second tab opens read-only; Take over editing brings editing here", async () => {
    await renderWithStudio(<BannerHost />);
    // The other tab created the project first and holds its lock.
    const store = testPersistence();
    const otherDoc = fakeDoc(makeProject({ id: "untitled" }));
    const other = testPersistence({ dbName: store.dbName, doc: otherDoc, provide: false, page: null });
    const project = await other.projects.createProject(template("ERC20"), "Vault");
    if (!project.ok) throw new Error(project.error);
    expect((await openProject(project.value.id)).ok).toBe(true);

    await until(() => session.get().readOnly === ELSEWHERE, "read-only");
    await expect.element(page.getByText(ELSEWHERE)).toBeVisible();
    // Every document command is disabled with the reason, and the store refuses edits anyway (spec L389).
    expect(commandState(PLACE)).toMatchObject({ ok: false, reason: ELSEWHERE });
    expect(commandState(commandRef("link.confirmAddresses"))).toMatchObject({ ok: false, reason: ELSEWHERE });
    if (!isPlaceholder("deploy.open")) expect(commandState(commandRef("deploy.open")).ok).toBe(false);
    expect(tryEdit()).toBe(false);

    await page.getByRole("button", { name: "Take over editing" }).click();
    await until(() => editLockState().state === "held", "the lock");
    await until(() => session.get().readOnly === null, "editing");
    await expect.element(page.getByText(ELSEWHERE)).not.toBeInTheDocument();
    expect(other.editLock().state).toBe("handed-over");
    expect(tryEdit()).toBe(true);
  });

  test("a tab that handed editing over says so, and Take back editing returns it", async () => {
    await renderWithStudio(<BannerHost />);
    const store = testPersistence();
    const project = await created();
    const { tab } = await otherTab(store, project);
    expect(tab.editLock().state).toBe("elsewhere");
    expect((await tab.takeOverEditing()).ok).toBe(true);

    await until(() => session.get().readOnly === HANDED_OVER, "read-only");
    await expect.element(page.getByText(HANDED_OVER)).toBeVisible();
    expect(commandState(TAKE_OVER)).toMatchObject({ ok: true, title: "Take back editing" });
    expect(commandState(PLACE)).toMatchObject({ ok: false, reason: HANDED_OVER });

    await page.getByRole("button", { name: "Take back editing" }).click();
    await until(() => session.get().readOnly === null, "editing");
    expect(tab.editLock().state).toBe("handed-over");
    await expect.element(page.getByText(HANDED_OVER)).not.toBeInTheDocument();
  });

  test("Take over editing is offered only while another tab has editing", async () => {
    await renderWithStudio(<BannerHost />);
    testPersistence();
    await created();
    await until(() => editLockState().state === "held", "the lock");
    expect(commandState(TAKE_OVER)).toMatchObject({ ok: false, reason: "This tab is editing this project", title: "Take over editing" });
  });
});

describe("the read-only reason", () => {
  test("the tab lock comes first, then an unbundled catalog", () => {
    const unbundled = { status: "unbundled", migrateTo: null } as const;
    expect(readOnlyReason({ state: "elsewhere", projectId: "p" }, unbundled)).toBe(ELSEWHERE);
    expect(readOnlyReason({ state: "handed-over", projectId: "p" }, { status: "matches" })).toBe(HANDED_OVER);
    expect(readOnlyReason({ state: "held", projectId: "p" }, unbundled)).toBe(UNBUNDLED);
    expect(readOnlyReason({ state: "none" }, { status: "unknown" })).toBeNull();
  });

  test("clears only the reason it set", async () => {
    await renderWithStudio(<BannerHost />, { session: { readOnly: "Set by someone else" } });
    syncReadOnly({ state: "none" }, { status: "matches" });
    expect(session.get().readOnly).toBe("Set by someone else");
    syncReadOnly({ state: "elsewhere", projectId: doc.get().id }, { status: "matches" });
    expect(session.get().readOnly).toBe(ELSEWHERE);
    syncReadOnly({ state: "held", projectId: doc.get().id }, { status: "matches" });
    expect(session.get().readOnly).toBeNull();
    await expect.element(page.getByText(ELSEWHERE)).not.toBeInTheDocument();
  });
});
