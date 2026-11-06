import { exportProjectFile, importFile, planUpgrade, recipeHash, reconstructUpgrade, type Hex4 } from "@lattice-studio/core";
import { makeRecipe } from "@lattice-studio/core/testing";
import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { command, commandRef, commandState, createProject, doc, emptyAnalysis, getCatalog, layoutMetrics, provideAnalysis, runCommand, session } from "@/contracts";
import { installShortcuts } from "@/commands/keys/dispatcher";
import { InspectorPanel } from "@/panels/inspector/InspectorPanel";
import { StructurePanel } from "@/panels/structure/StructurePanel";
import { CatalogPanel } from "@/panels/catalog/CatalogPanel";
import { testPersistence } from "@/persist/testing";
import { openStoredProject } from "@/projects/actions";
import { CardSheet } from "@/sheet/card/testing/CardSheet";
import { TitleBlockContent } from "@/sheet/chrome/TitleBlock";
import { StartBlock } from "@/sheet/chrome/StartBlock";
import { shapeKey, shapeOf } from "@/sheet/core/CoreTraces";
import { DeployButton } from "@/shell/DeployButton";
import { overridePlatform } from "@/ui/shared/platform";
import { axeViolations } from "@/ui/testing/axe";
import { fixtureCatalog, onCleanup, overrideCommands, renderWithStudio } from "../../../../test/harness";
import { FOREIGN_ID, FOREIGN_INSTANCE, KNOWN_ID, KNOWN_INSTANCE, SELF_ID, UPGRADE_DIAMOND, upgradeFixture } from "./test-support";

const catalog = fixtureCatalog();
const token = catalog.facets.find((facet) => facet.name === "ERC20")!;
const options = () => ({ project: upgradeFixture(catalog), chain: true as const, session: { chainId: 11155111 } });
function inspect(facet: string) { session.set((state) => ({ panes: { ...state.panes, inspector: { ...state.panes.inspector, view: { kind: "facet", facet } } } })); }

afterEach(async () => { await page.viewport(1440, 900); });

test("known, foreign and immutable self cards render actual instances with honest raw metadata", async () => {
  const base = getCatalog();
  await renderWithStudio(<CardSheet />, options());
  await expect.element(page.getByRole("group", { name: new RegExp(`^ERC20 at ${KNOWN_INSTANCE}`, "i") })).toBeVisible();
  await expect.element(page.getByRole("group", { name: new RegExp(`^Foreign facet at ${FOREIGN_INSTANCE}`, "i") })).toBeVisible();
  await expect.element(page.getByRole("group", { name: new RegExp(`^Diamond itself at ${UPGRADE_DIAMOND}`, "i") })).toBeVisible();
  expect(document.querySelector('[data-facet="' + KNOWN_ID + '"]')?.textContent).not.toContain("Not in this catalog");
  expect(document.querySelector('[data-facet="' + FOREIGN_ID + '"]')?.textContent).toContain("0x12345678");
  expect(getCatalog()).toBe(catalog);
  if (base) expect(base.facets.some((facet) => facet.name.startsWith("onchain:"))).toBe(false);
});

test("raw expansion reserves its actual height and colon-containing ids survive layout shapes", async () => {
  const base = upgradeFixture(catalog);
  const selectors = Array.from({ length: 8 }, (_, index) => `0x${(0xa0000000 + index).toString(16)}` as Hex4);
  const origin = { ...base.upgrade!, facets: base.upgrade!.facets.map((facet) => facet.facetAddress === FOREIGN_INSTANCE ? { ...facet, functionSelectors: selectors } : facet) };
  const rebuilt = reconstructUpgrade(origin, catalog);
  if (!rebuilt.ok) throw new Error(rebuilt.error);
  const project = { ...base, recipe: rebuilt.value, upgrade: origin, layout: { ...base.layout, [FOREIGN_ID]: { x: 48, y: 48, pins: "left" as const }, [KNOWN_ID]: { x: 48, y: 400, pins: "right" as const } } };
  await renderWithStudio(<CardSheet />, { ...options(), project });
  const card = page.getByRole("group", { name: new RegExp(`^Foreign facet at ${FOREIGN_INSTANCE}`, "i") });
  await card.getByRole("button", { name: "+ 5 more", exact: true }).click();
  await expect.poll(() => doc.get().layout[FOREIGN_ID]?.expanded).toBe(true);
  expect(doc.get().layout[KNOWN_ID]?.y).toBe(400 + Math.ceil(5 * layoutMetrics.rowHeight / layoutMetrics.snap) * layoutMetrics.snap);
  const shape = shapeOf(shapeKey(doc.get().layout));
  expect(shape[FOREIGN_ID]).toEqual({ x: 0, y: 0, pins: "left", expanded: true });
  expect(shape[KNOWN_ID]?.pins).toBe("right");
  await runCommand(commandRef("history.undo"), "keys");
  expect(doc.get().layout[KNOWN_ID]?.y).toBe(400);
});

test("an empty upgrade plan does not offer the fresh diamond starting flow", async () => {
  const base = upgradeFixture(catalog);
  await renderWithStudio(<StartBlock />, { ...options(), project: { ...base, recipe: { ...base.recipe, facets: [] }, layout: {} } });
  expect(page.getByRole("heading", { name: "Start a diamond", exact: true }).elements()).toHaveLength(0);
});

test("known alias selector edits use real commands while raw/self selector edits are refused", async () => {
  await renderWithStudio(<InspectorPanel />, options());
  inspect(KNOWN_ID);
  await expect.element(page.getByRole("heading", { name: "ERC20", exact: true })).toBeVisible();
  await expect.element(page.getByRole("region", { name: "Raw selectors" }).getByText("0xdeadbeef", { exact: true })).toBeVisible();
  const missing = token.selectors[1]!.hex;
  expect(commandState(commandRef("selector.include", { selector: missing, facet: KNOWN_ID })).ok).toBe(true);
  await runCommand(commandRef("selector.include", { selector: missing, facet: KNOWN_ID }), "button");
  expect(doc.get().recipe.exclude).not.toContain(missing);
  const plan = planUpgrade(doc.get().recipe, catalog, doc.get().upgrade!);
  expect(plan.ok && plan.value.cuts.some((cut) => cut.action === 0 && cut.facetAddress.toLowerCase() === KNOWN_INSTANCE && cut.functionSelectors.includes(missing))).toBe(true);
  const before = doc.get();
  expect((await runCommand(commandRef("selector.exclude", { selector: "0xdeadbeef" }), "api")).ok).toBe(false);
  expect((await runCommand(commandRef("selector.exclude", { selector: "0xffffffff" }), "api")).ok).toBe(false);
  expect(doc.get()).toBe(before);
});

test("catalog core releases are ordinary editable cards in upgrade plans, surviving add, remove, undo and reload", async () => {
  await renderWithStudio(<><CatalogPanel /><InspectorPanel /></>, options());
  expect(doc.get().recipe.facets).not.toContain("ERC165Facet");
  expect(commandState(commandRef("facet.place", { facet: "ERC165Facet" })).ok).toBe(true);
  await page.getByRole("textbox", { name: "Search", exact: true }).fill("ERC165Facet");
  const releaseRow = page.getByRole("tree", { name: "Catalog", exact: true }).getByRole("treeitem", { name: /^ERC165Facet/ });
  await expect.element(releaseRow).not.toHaveAttribute("aria-disabled", "true");
  await releaseRow.dblClick();
  await expect.poll(() => doc.get().recipe.facets.includes("ERC165Facet")).toBe(true);
  expect(doc.get().recipe.facets).toContain("ERC165Facet");
  expect(doc.get().layout.ERC165Facet).toBeDefined();
  expect(session.get().selection).toEqual(["ERC165Facet"]);
  await runCommand(commandRef("inspector.show", { facet: "ERC165Facet" }), "button");
  await expect.element(page.getByRole("heading", { name: "ERC165Facet", exact: true })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
  const added = doc.get();
  await runCommand(commandRef("layout.tidy"), "button");
  expect(doc.get().layout.ERC165Facet).toBeDefined();
  await runCommand(commandRef("facet.remove", { facets: ["ERC165Facet"] }), "keys");
  expect(doc.get().recipe.facets).not.toContain("ERC165Facet");
  expect(session.get().selection).not.toContain("ERC165Facet");
  await runCommand(commandRef("history.undo"), "keys");
  expect(doc.get().recipe.facets).toContain("ERC165Facet");
  doc.load(doc.get());
  expect(doc.get().layout.ERC165Facet).toBeDefined();
  const diff = planUpgrade(doc.get().recipe, catalog, doc.get().upgrade!);
  const release = catalog.facets.find((facet) => facet.name === "ERC165Facet")!;
  expect(diff.ok && diff.value.cuts.some((cut) => cut.action === 0 && cut.facetAddress.toLowerCase() === release.release.address.toLowerCase())).toBe(true);
  expect(added.upgrade).toEqual(doc.get().upgrade);
  await runCommand(commandRef("console.find", { query: "ERC165Facet" }), "console");
  expect(session.get().selection).toEqual(["ERC165Facet"]);
});

test("whole foreign-facet removal is undoable and survives storage reopen and full-file round trip", async () => {
  await renderWithStudio(<InspectorPanel />, options());
  testPersistence();
  const fixture = upgradeFixture(catalog);
  const created = await createProject(fixture.recipe, fixture.name, { upgrade: fixture.upgrade!, layout: fixture.layout });
  if (!created.ok) throw new Error(created.error);
  inspect(FOREIGN_ID);
  await expect.element(page.getByRole("heading", { name: "Foreign facet", exact: true })).toBeVisible();
  const beforeHash = recipeHash(doc.get().recipe);
  await page.getByRole("button", { name: "Remove whole facet", exact: true }).click();
  await expect.poll(() => doc.get().recipe.facets.includes(FOREIGN_ID)).toBe(false);
  await runCommand(commandRef("history.undo"), "keys");
  expect(recipeHash(doc.get().recipe)).toBe(beforeHash);
  const file = exportProjectFile(doc.get(), []);
  const parsed = importFile(file.text, file.filename, [catalog]);
  expect(parsed.ok && parsed.value.kind === "project" && parsed.value.project.recipe.facetInstances?.[FOREIGN_ID]?.kind).toBe("foreign");
  const other = await createProject(makeRecipe({}, catalog), "Other project");
  if (!other.ok) throw new Error(other.error);
  await openStoredProject(created.value.id);
  expect(recipeHash(doc.get().recipe)).toBe(beforeHash);
  expect(doc.get().upgrade?.address.toLowerCase()).toBe(UPGRADE_DIAMOND);
});

test("self remains immutable and read-only mode blocks ordinary alias edits", async () => {
  await renderWithStudio(<InspectorPanel />, options());
  inspect(SELF_ID);
  await expect.element(page.getByRole("heading", { name: "Diamond itself", exact: true })).toBeVisible();
  expect(page.getByRole("button", { name: "Remove whole facet", exact: true }).elements()).toHaveLength(0);
  expect((await runCommand(commandRef("facet.remove", { facets: [SELF_ID] }), "keys")).ok).toBe(false);
  session.set({ readOnly: "Another tab is editing this project." });
  expect(commandState(commandRef("selector.include", { selector: token.selectors[1]!.hex, facet: KNOWN_ID }))).toMatchObject({ ok: false, reason: "Another tab is editing this project." });
});

test("upgrade plan, title block and Mod+Enter target Upgrade without factory prediction", async () => {
  const releaseCatalog = { ...catalog, lattice: { ...catalog.lattice, tag: "v1.0.0" } };
  await renderWithStudio(<><InspectorPanel /><TitleBlockContent form="full" /><DeployButton again /></>, { ...options(), catalog: releaseCatalog });
  await expect.element(page.getByRole("heading", { name: "Existing diamond upgrade", exact: true })).toBeVisible();
  await expect.element(page.getByText("No selector changes.", { exact: true }).first()).toBeVisible();
  expect(document.body.textContent).not.toContain("Predicted");
  expect(document.body.textContent).not.toContain("LatticeFactory · deterministic");
  const upgrade = vi.fn();
  overrideCommands([command({ id: "deploy.upgrade", title: () => "Upgrade…", category: "Deploy", enabled: () => ({ ok: true }), run: upgrade })]);
  const analysis = { ...emptyAnalysis(), recipeHash: recipeHash(doc.get().recipe) };
  onCleanup(provideAnalysis({ getAnalysis: () => analysis, subscribe: () => () => {} }));
  onCleanup(overridePlatform("other"));
  onCleanup(installShortcuts());
  const button = page.getByRole("button", { name: "Upgrade…", exact: true }).first();
  button.element().focus();
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  await expect.poll(() => upgrade.mock.calls.length).toBe(1);
  expect(commandState(commandRef("deploy.open", { chainId: 84532 }))).toMatchObject({ ok: false, reason: "Upgrade uses the stored target's chain." });
});

test("an upgrade starts without replayed initialization and adds only an explicitly selected new step", async () => {
  await renderWithStudio(<InspectorPanel />, options());
  await expect.element(page.getByRole("heading", { name: "Existing diamond upgrade", exact: true })).toBeVisible();
  expect(doc.get().recipe.init.kind).toBe("none");
  await expect.element(page.getByText("No initializer requested.", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Choose a new initializer" }).click();
  await page.getByRole("option", { name: "ERC20Init", exact: true }).click();
  expect(doc.get().recipe.init.kind).toBe("none");
  await page.getByRole("button", { name: "Add new step", exact: true }).click();
  await expect.poll(() => doc.get().recipe.init).toEqual({ kind: "steps", steps: [{ spec: "ERC20Init", args: {} }] });
  await expect.element(page.getByRole("button", { name: "Edit initializer", exact: true })).toBeVisible();
  await runCommand(commandRef("history.undo"), "keys");
  expect(doc.get().recipe.init.kind).toBe("none");
});

test("selection and dependency comparison use known-instance names and actual addresses", async () => {
  await renderWithStudio(<InspectorPanel />, options());
  session.set((state) => ({ selection: [KNOWN_ID, FOREIGN_ID], panes: { ...state.panes, inspector: { ...state.panes.inspector, view: { kind: "selection" } } } }));
  await expect.element(page.getByRole("heading", { name: "2 facets selected", exact: true })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Open ERC20", exact: true })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Open Foreign facet", exact: true })).toBeVisible();
  await expect.element(page.getByText(KNOWN_INSTANCE, { exact: true })).toBeVisible();
  expect(commandState(commandRef("dependency.compare", { options: [KNOWN_ID, "ERC4626"] })).ok).toBe(true);
  await runCommand(commandRef("dependency.compare", { options: [KNOWN_ID, "ERC4626"] }), "button");
  await expect.element(page.getByRole("heading", { name: "Compare options", exact: true })).toBeVisible();
  await expect.element(page.getByRole("region", { name: "ERC20", exact: true }).getByText(KNOWN_INSTANCE, { exact: true })).toBeVisible();
  expect(commandState(commandRef("dependency.compare", { options: [FOREIGN_ID, "ERC4626"] })).ok).toBe(false);
});

test("raw Structure rows expand but cannot acquire selector editing actions", async () => {
  await renderWithStudio(<StructurePanel />, options());
  const tree = page.getByRole("tree", { name: "Structure", exact: true });
  const foreign = tree.getByRole("treeitem", { name: new RegExp(`^Foreign facet at ${FOREIGN_INSTANCE}`, "i") });
  await foreign.click();
  await userEvent.keyboard("{ArrowRight}");
  const selector = tree.getByRole("treeitem", { name: "0x12345678, locked raw selector", exact: true });
  await expect.element(selector).toBeVisible();
  selector.element().focus();
  const before = doc.get();
  await userEvent.keyboard("{Delete}");
  expect(doc.get()).toBe(before);
});

test("phone raw Inspector fits 320 px and passes axe", async () => {
  await page.viewport(320, 740);
  await renderWithStudio(<main style={{ width: "100%", height: 740 }}><InspectorPanel /></main>, options());
  inspect(FOREIGN_ID);
  await expect.element(page.getByRole("heading", { name: "Foreign facet", exact: true })).toBeVisible();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  expect(await axeViolations(document.querySelector("main")!)).toEqual([]);
});
