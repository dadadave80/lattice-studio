import type { Recipe } from "@lattice-studio/core";
import { encodeShareLink, recipeHash } from "@lattice-studio/core";
import { createElement, Suspense } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import {
  commandRef, commandState, doc, getAnalysis, inspectorViewComponent, openShareLink as routeShareLink, runCommand, session,
  useSession,
} from "@/contracts";
import { BannerHost } from "@/feedback/BannerHost";
import { DialogHost } from "@/ui/overlays/DialogHost";
import { bufferedServices, fakeChainService, fixtureCatalog, renderWithStudio } from "../../test/harness";
import { UNBUNDLED } from "./copy";
import { openShareLink, sharedName } from "./open-link";
import { ADMIN, linkedRecipe, loadWithManifest, resetFlows, SAFE, template } from "./test-support";

afterEach(() => {
  resetFlows();
});

/** What S5c's inspector frame does: render whatever is registered for the session's view. */
function InspectorHost() {
  const view = useSession((s) => s.panes.inspector.view);
  const registered = view ? inspectorViewComponent(view.kind) : null;
  if (!view || !registered) return <p>Nothing shown</p>;
  return <Suspense fallback={<p>Loading…</p>}>{createElement(registered, { view: view as never })}</Suspense>;
}

function Studio() {
  return (
    <>
      <BannerHost />
      <InspectorHost />
      <DialogHost />
    </>
  );
}

function linkOf(recipe: Recipe): string {
  return encodeShareLink(recipe).fragment;
}

/** A link as a newer Studio might write it: another format version, or a recipe of another schema version. */
function rawLink(recipe: Recipe, version = 1): string {
  return linkOf(recipe).replace(/^#s=1\./, `#s=${version}.`);
}

const logged = (text: string) => bufferedServices().log.some((line) => line.text === text);
const short = (hash: string) => `${hash.slice(0, 6)}…${hash.slice(-4)}`;

describe("opening a shared link (Flow 10 step 7)", () => {
  test("a new project named after the recipe, tidied, From link, with the banner and the console line", async () => {
    await renderWithStudio(<Studio />);
    const recipe = { ...linkedRecipe(), name: "Treasury" };
    const hash = recipeHash(recipe);
    const opened = await openShareLink(`https://studio.example/${linkOf(recipe)}`);
    expect(opened.ok).toBe(true);
    const project = doc.get();
    expect(project.name).toBe("Treasury (shared)");
    expect(recipeHash(project.recipe)).toBe(hash);
    // Tidied on open: every card has a place, though the link carries no layout (spec L291).
    expect(Object.keys(project.layout).sort()).toEqual([...project.recipe.facets].sort());
    expect(project.provenance["steps[0].admin"]).toBe("link");
    expect(project.provenance["steps[0].safe"]).toBe("link");
    expect(logged(`Opened a shared link · recipe ${short(hash)} · 2 addresses to confirm.`)).toBe(true);
    await expect
      .element(page.getByText(`Opened from a shared link · recipe ${short(hash)}. Nothing runs until you choose to deploy.`))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Confirm addresses…" })).toBeVisible();
  });

  test("the name falls back to the template's, and a shared copy isn't named twice", () => {
    const recipe = template("GovernedVault");
    expect(sharedName({ ...recipe, name: undefined } as unknown as Recipe)).toBe("GovernedVault (shared)");
    expect(sharedName({ ...recipe, name: "Vault (shared)" })).toBe("Vault (shared)");
  });

  test("LINK-01 blocks until each address is confirmed, one at a time and in full", async () => {
    const chain = fakeChainService({ ens: { "ops.eth": SAFE } });
    await renderWithStudio(<Studio />, { session: { chainId: 11155111 }, chain });
    await openShareLink(linkOf(linkedRecipe()));
    const blockers = () => getAnalysis().problems.filter((p) => p.code === "LINK-01" && p.severity === "blocker");
    await expect.poll(() => blockers().length).toBe(2);

    await page.getByRole("button", { name: "Confirm addresses…" }).click();
    const view = page.getByRole("region", { name: "Confirm addresses" });
    await expect.element(view).toHaveFocus();
    await expect.element(view.getByText("Address 1 of 2")).toBeVisible();
    await expect.element(view.getByText(ADMIN, { exact: true })).toBeVisible();
    await expect.element(view.getByText("No ENS name.")).toBeVisible();
    await view.getByRole("button", { name: "Confirm address", exact: true }).click();
    await expect.poll(() => doc.get().provenance["steps[0].admin"]).toBe("confirmed");
    await expect.poll(() => blockers().length).toBe(1);
    expect(bufferedServices().log.some((l) => l.tag === "Init" && l.text.startsWith("Confirmed ") && l.text.endsWith(`: ${ADMIN}.`))).toBe(true);

    await expect.element(view.getByText("Address 1 of 1")).toBeVisible();
    await expect.element(view.getByText(SAFE, { exact: true })).toBeVisible();
    await expect.element(view.getByText("ENS name: ops.eth")).toBeVisible();
    await view.getByRole("button", { name: "Confirm address", exact: true }).click();
    await expect.poll(() => blockers().length).toBe(0);
    await expect.element(view.getByText("Every address that came from a link or a file is confirmed.")).toBeVisible();
    expect(commandState(commandRef("link.confirmAddresses"))).toMatchObject({ ok: false, reason: "No address is waiting to be confirmed" });
  });

  test("Next address steps through them without confirming", async () => {
    await renderWithStudio(<Studio />);
    await openShareLink(linkOf(linkedRecipe()));
    await runCommand(commandRef("link.confirmAddresses"), "palette");
    const view = page.getByRole("region", { name: "Confirm addresses" });
    await expect.element(view.getByText(ADMIN, { exact: true })).toBeVisible();
    await view.getByRole("button", { name: "Next address" }).click();
    await expect.element(view.getByText("Address 2 of 2")).toBeVisible();
    await expect.element(view.getByText(SAFE, { exact: true })).toBeVisible();
    await view.getByRole("button", { name: "Next address" }).click();
    await expect.element(view.getByText("Address 1 of 2")).toBeVisible();
    expect(doc.get().provenance["steps[0].admin"]).toBe("link");
  });

  test("the banner closes, and goes when another project opens", async () => {
    await renderWithStudio(<Studio />);
    await openShareLink(linkOf(template("ERC20")));
    const banner = page.getByText("Opened from a shared link", { exact: false });
    await expect.element(banner).toBeVisible();
    // No address to confirm: only Close.
    expect(page.getByRole("button", { name: "Confirm addresses…" }).elements()).toHaveLength(0);
    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(banner).not.toBeInTheDocument();

    await openShareLink(linkOf(template("ERC20")));
    await expect.element(banner).toBeVisible();
    doc.load({ ...doc.get(), id: "another-project" });
    await expect.element(banner).not.toBeInTheDocument();
  });

  test("the router's link reaches it: the placeholder no longer answers", async () => {
    await renderWithStudio(<Studio />);
    routeShareLink(linkOf(template("ERC20")));
    await expect.poll(() => doc.get().name).toBe("ERC20 (shared)");
    expect(logged("Opening a shared link: Not built yet · WP-S13")).toBe(false);
  });

  test("the fragment leaves the address once the project exists, so a reload opens that project", async () => {
    await renderWithStudio(<Studio />);
    const link = linkOf(template("ERC20"));
    history.replaceState(null, "", `${location.pathname}${location.search}${link}`);
    try {
      await openShareLink(location.href);
      expect(location.hash).toBe("");
    } finally {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
  });

  test("a link on another bundled catalog opens against that catalog, editable", async () => {
    await renderWithStudio(<Studio />);
    loadWithManifest(fixtureCatalog("fixture"));
    const next = fixtureCatalog("fixture-next");
    const loads: string[] = [];
    const opened = await openShareLink(linkOf(template("ERC20", next)), {
      loadCatalog: async (entry) => {
        loads.push(entry.id);
        return { ok: true, value: next };
      },
    });
    expect(opened.ok).toBe(true);
    expect(loads).toEqual(["fixture-next"]);
    expect(doc.get().recipe.catalog.hash).toBe(next.hash);
    expect(session.get().readOnly).toBeNull();
  });

  test("a link opened while the catalog loads waits for it", async () => {
    await renderWithStudio(<Studio />, { catalog: null });
    const opening = openShareLink(linkOf(template("ERC20")));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(doc.get().name).not.toBe("ERC20 (shared)");
    loadWithManifest(fixtureCatalog());
    expect((await opening).ok).toBe(true);
    expect(doc.get().name).toBe("ERC20 (shared)");
  });
});

describe("links Studio refuses", () => {
  test("a newer share format names the version it needs", async () => {
    await renderWithStudio(<Studio />);
    const before = doc.get();
    const opened = await openShareLink(rawLink(template("ERC20"), 2));
    expect(opened.ok).toBe(false);
    expect(doc.get()).toBe(before);
    expect(bufferedServices().toast.at(-1)).toEqual({
      text: "This link couldn't be opened: This link needs Studio share format v2. This Studio reads v1. Open it in the latest Studio.",
      kind: "error",
    });
  });

  test("a newer recipe schema names the version it needs", async () => {
    await renderWithStudio(<Studio />);
    const opened = await openShareLink(rawLink({ ...template("ERC20"), schemaVersion: 2 as 1 }));
    expect(opened.ok).toBe(false);
    const text = bufferedServices().toast.at(-1)?.text ?? "";
    expect(text.startsWith("This link couldn't be opened: ")).toBe(true);
    expect(text).toContain("schema v2");
    expect(text).toContain("reads v1");
  });

  test("a damaged link says what's wrong and opens nothing", async () => {
    await renderWithStudio(<Studio />);
    const before = doc.get();
    const opened = await openShareLink("#s=1.abc");
    expect(opened.ok).toBe(false);
    expect(doc.get()).toBe(before);
    expect(bufferedServices().toast.at(-1)?.kind).toBe("error");
  });
});

describe("a link naming a catalog this build doesn't bundle (spec L290, L504)", () => {
  const retired = (): Recipe => ({ ...template("ERC20"), catalog: { tag: "v0.3.0", hash: `0x${"ab".repeat(32)}` } });

  test("opens read-only with Migrate, and the review opens once", async () => {
    await renderWithStudio(<Studio />);
    loadWithManifest(fixtureCatalog());
    await openShareLink(linkOf(retired()));
    await expect.poll(() => session.get().readOnly).toBe(UNBUNDLED);
    await expect.element(page.getByText(UNBUNDLED)).toBeVisible();
    await expect.element(page.getByRole("dialog", { name: "Migrate" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Keep read-only" })).toBeVisible();
    // Every document command is disabled with the reason; the document store refuses edits anyway.
    expect(commandState(commandRef("facet.place", { facet: "Pausable" }))).toMatchObject({ ok: false, reason: UNBUNDLED });
    expect(doc.apply("Rename", (p) => ({ project: { ...p, name: "x" }, changed: true, summary: "Renamed" })).changed).toBe(false);
    await page.getByRole("button", { name: "Keep read-only" }).click();
    await expect.element(page.getByRole("dialog", { name: "Migrate" })).not.toBeInTheDocument();
    expect(session.get().readOnly).toBe(UNBUNDLED);
    // The banner's Migrate to fixture… reopens it.
    await page.getByRole("button", { name: "Migrate to fixture…" }).click();
    await expect.element(page.getByRole("dialog", { name: "Migrate" })).toBeVisible();
  });

  test("Migrate moves it to the build's catalog: editable, and history starts over", async () => {
    await renderWithStudio(<Studio />);
    loadWithManifest(fixtureCatalog());
    await openShareLink(linkOf(retired()));
    const dialog = page.getByRole("dialog", { name: "Migrate" });
    await expect.element(dialog.getByText("Studio doesn't have catalog 0.3.0 any more", { exact: false })).toBeVisible();
    await expect.element(dialog.getByText("Code changes can't be listed without catalog 0.3.0.")).toBeVisible();
    await dialog.getByRole("button", { name: "Migrate to fixture" }).click();
    await expect.poll(() => doc.get().recipe.catalog.hash).toBe(fixtureCatalog().hash);
    await expect.poll(() => session.get().readOnly).toBeNull();
    await expect.element(page.getByText(UNBUNDLED)).not.toBeInTheDocument();
    expect(logged("Migrated to catalog fixture. Undo history starts here.")).toBe(true);
    expect(doc.get().recipe.catalog.tag).toBe("fixture");
    const place = commandState(commandRef("facet.place", { facet: "Pausable" }));
    expect(place.ok ? null : place.reason).not.toBe(UNBUNDLED);
  });
});
