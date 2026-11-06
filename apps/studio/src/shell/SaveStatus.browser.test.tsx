import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { provideServices, type ProjectsService, type SaveStatus as Status } from "@/contracts";
import { onCleanup, renderWithStudio } from "../../test/harness";
import { SaveStatus } from "./SaveStatus";

function saveStatusOf(status: Status): void {
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

afterEach(async () => { await page.viewport(1440, 900); });

test.each([1440, 900])("explains browser saving scope and portable recovery at %s", async (width) => {
  await page.viewport(width, 900);
  saveStatusOf({ state: "saved", text: "Saved" });
  const screen = await renderWithStudio(<SaveStatus compact={width < 1024} />);
  const trigger = screen.getByRole("button", { name: "Saved", exact: true });
  await trigger.click();
  await expect.element(page.getByText("Studio saves edits in this browser. Save a copy to keep a file outside this browser. Clearing browser data removes local projects.")).toBeVisible();
  await expect.element(page.getByText("Check persistent storage in Settings → Data.")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Save a copy…", exact: true })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Open…", exact: true })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(trigger).toHaveFocus();
});

test.each([
  { state: "not-saved", text: "Not saved", detail: "Disk refused the write", action: { id: "project.saveCopy" } },
  { state: "not-saved", text: "Not saved: browser storage is full", detail: "Original quota detail", action: { id: "project.saveCopy" } },
  { state: "not-saved", text: "Not saved", detail: "Locally cleared", action: { id: "project.new" } },
] as const)("keeps the original failure and one portable recovery action: $detail", async (status) => {
  saveStatusOf(status);
  const screen = await renderWithStudio(<SaveStatus compact />);
  await screen.getByRole("button", { name: status.text, exact: true }).click();
  await expect.element(page.getByText(status.detail, { exact: true })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Save a copy…", exact: true })).toBeVisible();
  expect(page.getByRole("button", { name: "Save a copy…", exact: true }).elements()).toHaveLength(1);
});
