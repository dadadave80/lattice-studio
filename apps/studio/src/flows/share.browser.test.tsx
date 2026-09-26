import type { ExportFile } from "@lattice-studio/core";
import { decodeShareLink, recipeHash, SHARE_WARN_LENGTH } from "@lattice-studio/core";
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from "vitest";
import { page, userEvent } from "vitest/browser";
import { commandRef, commandState, doc, runCommand, session } from "@/contracts";
import { setDownloader } from "@/panels/console/download";
import { DialogHost } from "@/ui/overlays/DialogHost";
import { bufferedServices, fixtureCatalog, onCleanup, renderWithStudio } from "../../test/harness";
import { projectFor, resetFlows, template } from "./test-support";

const SHARE = commandRef("share.copyLink");

let writeText: MockInstance<(text: string) => Promise<void>>;

beforeEach(() => {
  writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
});

afterEach(() => {
  writeText.mockRestore();
  resetFlows();
});

function copied(): string {
  const text = writeText.mock.calls.at(-1)?.[0];
  if (text === undefined) throw new Error("Nothing was copied.");
  return text;
}

/** Text that doesn't compress: a name long enough to push the link past 2,000 characters. */
function noise(length: number): string {
  let seed = 7;
  let out = "";
  while (out.length < length) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out += (seed % 36).toString(36);
  }
  return out;
}

describe("Share (Flow 10 step 6)", () => {
  test("is offered once the sheet has facets", async () => {
    await renderWithStudio(<DialogHost />);
    expect(commandState(SHARE)).toMatchObject({ ok: false, reason: "Place facets first", title: "Copy share link" });
    await runCommand(SHARE, "button");
    expect(writeText).not.toHaveBeenCalled();
    expect(bufferedServices().log.at(-1)?.text).toBe("Place facets first");
  });

  test("copies the whole address with the #s=1. link, and says how long it is", async () => {
    const project = projectFor(template("GovernedVault"), { name: "GovernedVault" });
    await renderWithStudio(<DialogHost />, { project });
    await runCommand(SHARE, "button");
    const link = copied();
    expect(link.startsWith(`${location.origin}${location.pathname}${location.search}#s=1.`)).toBe(true);
    expect(link.length).toBeLessThanOrEqual(SHARE_WARN_LENGTH);
    expect(bufferedServices().toast.at(-1)?.text).toBe(`Link copied · ${link.length} characters`);
    const decoded = decodeShareLink(link, [fixtureCatalog()]);
    if (!decoded.ok) throw new Error(decoded.error[0]?.message);
    expect(decoded.value.hash).toBe(recipeHash(project.recipe));
    // The whole recipe and nothing else: no layout, salt or deployments (spec L503).
    expect(Object.keys(decoded.value.recipe).sort()).toEqual(Object.keys({ ...project.recipe, name: "" }).sort());
  });

  test("the link names the recipe after the project: rename, then share (spec L212)", async () => {
    const project = projectFor(template("GovernedVault"), { name: "GovernedVault" });
    await renderWithStudio(<DialogHost />, { project });
    await runCommand(commandRef("project.rename", { name: "Treasury vault" }), "api");
    expect(doc.get().name).toBe("Treasury vault");
    await runCommand(SHARE, "button");
    const decoded = decodeShareLink(copied(), [fixtureCatalog()]);
    if (!decoded.ok) throw new Error(decoded.error[0]?.message);
    expect(decoded.value.recipe.name).toBe("Treasury vault");
    // The name is display only: the link's recipe hash is the project's.
    expect(decoded.value.hash).toBe(recipeHash(doc.get().recipe));
  });

  test("a read-only project can still be shared", async () => {
    await renderWithStudio(<DialogHost />, {
      project: projectFor(template("ERC20")),
      session: { readOnly: "Another tab is editing this project" },
    });
    expect(commandState(SHARE).ok).toBe(true);
  });

  describe("over 2,000 characters", () => {
    const long = () => projectFor(template("GovernedVault"), { name: noise(2400) });

    test("opens Share instead of copying, with Save a file instead focused", async () => {
      await renderWithStudio(<DialogHost />, { project: long() });
      await runCommand(SHARE, "button");
      expect(writeText).not.toHaveBeenCalled();
      const dialog = page.getByRole("dialog", { name: "Share" });
      await expect.element(dialog).toBeVisible();
      const link = session.get().dialogs.at(-1)?.props as { link: string };
      expect(link.link.length).toBeGreaterThan(SHARE_WARN_LENGTH);
      await expect.element(dialog.getByText(`This link is ${link.link.length.toLocaleString("en-US")} characters`, { exact: false })).toBeVisible();
      await expect.element(dialog.getByRole("button", { name: "Save a file instead" })).toHaveFocus();
    });

    test("Copy anyway copies it and says so", async () => {
      await renderWithStudio(<DialogHost />, { project: long() });
      await runCommand(SHARE, "button");
      await page.getByRole("button", { name: "Copy anyway" }).click();
      const link = copied();
      expect(link.length).toBeGreaterThan(SHARE_WARN_LENGTH);
      expect(bufferedServices().toast.at(-1)?.text).toBe(`Link copied · ${link.length.toLocaleString("en-US")} characters`);
      await expect.element(page.getByRole("dialog", { name: "Share" })).not.toBeInTheDocument();
    });

    test("Save a file instead downloads recipe.json with the recipe the link carries", async () => {
      const files: ExportFile[] = [];
      onCleanup(setDownloader((file) => void files.push(file)));
      const project = long();
      await renderWithStudio(<DialogHost />, { project });
      await runCommand(SHARE, "button");
      await page.getByRole("button", { name: "Save a file instead" }).click();
      await expect.element(page.getByRole("dialog", { name: "Share" })).not.toBeInTheDocument();
      await expect.poll(() => files.length).toBe(1);
      const file = files[0];
      expect(file?.filename).toMatch(/\.json$/);
      const saved = JSON.parse(file?.text ?? "{}") as { name?: string; facets?: string[] };
      expect(saved.name).toBe(project.name);
      expect(saved.facets).toEqual(project.recipe.facets);
      expect(bufferedServices().log.some((l) => l.text.startsWith(`Exported ${file?.filename} · recipe `))).toBe(true);
      expect(writeText).not.toHaveBeenCalled();
    });

    test("Esc and Cancel copy nothing and save nothing", async () => {
      const files: ExportFile[] = [];
      onCleanup(setDownloader((file) => void files.push(file)));
      await renderWithStudio(<DialogHost />, { project: long() });
      await runCommand(SHARE, "button");
      await userEvent.keyboard("{Escape}");
      await expect.element(page.getByRole("dialog", { name: "Share" })).not.toBeInTheDocument();
      await runCommand(SHARE, "button");
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect.element(page.getByRole("dialog", { name: "Share" })).not.toBeInTheDocument();
      expect(writeText).not.toHaveBeenCalled();
      expect(files).toEqual([]);
    });
  });
});
