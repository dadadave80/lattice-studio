import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { session } from "@/contracts";
import { InspectorPanel } from "@/panels/inspector/InspectorPanel";
import { fakeChainService, fixtureCatalog, onCleanup, renderWithStudio } from "../../../test/harness";
import { DeployedStructure } from "./DeployedStructure";
import { createInspectionApp, setInspectionApp } from "./app";

test("tree arrows retain focus and explicit activation moves to the inspected heading", async () => {
  const target = { kind: "deployed", chainId: 11155111, address: "0x00000000000000000000000000000000000000AA" } as const;
  const catalog = fixtureCatalog();
  const facet = catalog.facets.find((item) => item.name === "ERC20")!;
  const chain = fakeChainService({ catalog, facets: { [target.address]: [{ facetAddress: facet.release.address, functionSelectors: [facet.selectors[0]!.hex] }] } });
  const app = createInspectionApp({ chains: chain.chains(), chain: async () => chain, catalogs: async () => ({ ok: true, value: [catalog] }), show: () => {} });
  onCleanup(setInspectionApp(app));
  await app.engine.ensure(target);
  await renderWithStudio(<><InspectorPanel /><DeployedStructure view={target} /></>, {
    chain, session: { panes: { ...session.get().panes, inspector: { open: true, size: 316, view: target } } },
  });
  const tree = page.getByRole("tree", { name: "On-chain structure" });
  await expect.element(tree).toBeVisible();
  tree.getByRole("treeitem", { name: "Deployed diamond", exact: true }).element().focus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.poll(() => session.get().panes.inspector.view).toEqual({ ...target, facetAddress: facet.release.address });
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  expect(tree.element().contains(document.activeElement)).toBe(true);
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("heading", { name: "ERC20", exact: true })).toHaveFocus();
});
