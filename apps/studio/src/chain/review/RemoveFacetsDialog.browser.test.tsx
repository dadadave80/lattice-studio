import { describe, expect, test } from "vitest";
import { page, userEvent, type Locator } from "vitest/browser";
import { command, doc, openDialog, session, type CommandArgsOf } from "@/contracts";
import { DialogHost } from "@/ui";
import { fakeChainService, overrideCommands, renderWithStudio, type FakeChain } from "../../../test/harness";
import { account, deployableCatalog, SEPOLIA, templateProject } from "./test-support";

const TITLE = "Remove facets";

type Options = { estimate?: boolean };

/** ERC20 on Sepolia, estimated at 20M gas against the 16.8M cap, with the dialog open. */
async function open({ estimate = true }: Options = {}) {
  const chain: FakeChain = fakeChainService({
    account: account(),
    catalog: deployableCatalog(),
    state: { [SEPOLIA]: estimate ? { gasEstimate: "20000000", gasCap: "16777216" } : { gasCap: "16777216" } },
  });
  chain.install();
  await chain.probe(SEPOLIA);
  await renderWithStudio(<DialogHost />, {
    catalog: deployableCatalog(),
    project: templateProject("ERC20"),
    session: { chainId: SEPOLIA },
  });
  openDialog("remove-facets", { chainId: SEPOLIA });
  const dialog = page.getByRole("dialog", { name: TITLE });
  await expect.element(dialog).toBeVisible();
  return dialog;
}

function names(dialog: Locator): string[] {
  return dialog.getByRole("checkbox").elements().map((el) => {
    const id = el.getAttribute("aria-labelledby");
    return (id ? document.getElementById(id)?.textContent : el.textContent) ?? "";
  });
}

function isOpen(): boolean {
  return session.get().dialogs.some((d) => d.id === "remove-facets");
}

describe("Remove facets (NET-06, IR L177)", () => {
  test("lists the plan's facets by their share of the gas, focus on the checklist", async () => {
    const dialog = await open();
    await expect.poll(() => names(dialog)).toEqual(["ERC20", "DiamondLoupeFacet", "Receive", "ERC165Facet"]);
    await expect.element(dialog.getByRole("checkbox", { name: "ERC20" })).toHaveFocus();
    await expect.element(dialog.getByRole("checkbox", { name: "ERC20" })).toHaveAccessibleDescription("9 selectors · about 12M gas");
    await expect.element(dialog.getByRole("checkbox", { name: "DiamondLoupeFacet" })).toHaveAccessibleDescription(/^4 selectors · about 5.3M gas/);
    await expect.element(dialog.getByRole("checkbox", { name: "Receive" })).toHaveAccessibleDescription("1 selector · about 1.3M gas");
    await expect.element(dialog.getByRole("status")).toHaveTextContent("About 20M gas of Sepolia's 16.8M per-transaction cap. Still over the cap.");
  });

  test("locks a required facet with the reason, and it can't be ticked", async () => {
    const dialog = await open();
    const loupe = dialog.getByRole("checkbox", { name: "DiamondLoupeFacet" });
    const reason = "The loupe is incomplete: facets() is missing. Every Lattice diamond needs all four.";
    await expect.element(loupe).toHaveAttribute("aria-disabled", "true");
    await expect.element(loupe).toHaveAccessibleDescription(/The loupe is incomplete: facets\(\) is missing/);
    // Written under the row for everyone, besides the tooltip and the description.
    await expect.poll(() => dialog.getByText(reason).elements().some((el) => el.checkVisibility())).toBe(true);
    await loupe.click({ force: true });
    (loupe.element() as HTMLElement).focus();
    await userEvent.keyboard(" ");
    await expect.element(loupe).toHaveAttribute("aria-checked", "false");
    await expect.element(dialog.getByRole("button", { name: "Remove 0 facets" })).toBeVisible();
  });

  test("keeps a running total as facets are ticked", async () => {
    const dialog = await open();
    const total = dialog.getByRole("status");
    await dialog.getByRole("checkbox", { name: "Receive" }).click();
    await expect.element(total).toHaveTextContent("About 18.7M gas of Sepolia's 16.8M per-transaction cap. Still over the cap.");
    await dialog.getByRole("checkbox", { name: "ERC20" }).click();
    await expect.element(total).toHaveTextContent("About 6.7M gas of Sepolia's 16.8M per-transaction cap. Within the cap.");
    await dialog.getByRole("checkbox", { name: "Receive" }).click();
    await expect.element(total).toHaveTextContent("About 8M gas of Sepolia's 16.8M per-transaction cap. Within the cap.");
  });

  test("the primary says how many and why it waits", async () => {
    const dialog = await open();
    const idle = dialog.getByRole("button", { name: "Remove 0 facets" });
    await expect.element(idle).toHaveAttribute("aria-disabled", "true");
    await expect.element(idle).toHaveAccessibleDescription("Tick the facets to remove");
    await dialog.getByRole("checkbox", { name: "Receive" }).click();
    const one = dialog.getByRole("button", { name: "Remove 1 facet" });
    await expect.element(one).not.toHaveAttribute("aria-disabled");
    await dialog.getByRole("checkbox", { name: "ERC165Facet" }).click();
    await expect.element(dialog.getByRole("button", { name: "Remove 2 facets" })).toBeVisible();
  });

  test("Remove runs facet.remove with the ticked facets and closes", async () => {
    const calls: string[][] = [];
    const dialog = await open();
    overrideCommands([
      command<CommandArgsOf<"facet.remove">>({
        id: "facet.remove",
        title: () => "Remove",
        category: "Build",
        enabled: () => ({ ok: true }),
        run(_ctx, { facets }) {
          calls.push(facets);
        },
      }),
    ]);
    await dialog.getByRole("checkbox", { name: "ERC20" }).click();
    await dialog.getByRole("checkbox", { name: "Receive" }).click();
    await dialog.getByRole("button", { name: "Remove 2 facets" }).click();
    await expect.poll(() => calls).toEqual([["ERC20", "Receive"]]);
    await expect.poll(isOpen).toBe(false);
  });

  test("Remove takes the facets off the document", async () => {
    const dialog = await open();
    await dialog.getByRole("checkbox", { name: "ERC20" }).click();
    await dialog.getByRole("button", { name: "Remove 1 facet" }).click();
    await expect.poll(isOpen).toBe(false);
    expect(doc.get().recipe.facets).not.toContain("ERC20");
  });

  test("Cancel and Esc close it", async () => {
    const dialog = await open();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect.poll(isOpen).toBe(false);
    openDialog("remove-facets", { chainId: SEPOLIA });
    await expect.element(page.getByRole("dialog", { name: TITLE })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.poll(isOpen).toBe(false);
  });

  test("without an estimate it sorts by selectors cut and says so", async () => {
    const dialog = await open({ estimate: false });
    await expect.poll(() => names(dialog)).toEqual(["ERC20", "DiamondLoupeFacet", "Receive", "ERC165Facet"]);
    await expect.element(dialog.getByRole("checkbox", { name: "ERC20" })).toHaveAccessibleDescription("9 selectors");
    await expect.element(dialog.getByRole("status")).toHaveTextContent("No gas estimate yet: sorted by selectors cut.");
  });
});
