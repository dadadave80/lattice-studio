/**
 * The pin row's words (WCAG 2.5.3, spec L779): the drawn text reads as words, the accessible name contains it, and
 * axe's `label-content-name-mismatch` (experimental, so switched on here) passes on contested and seam pins.
 */
import type { Hex4 } from "@lattice-studio/core";
import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { axeViolations } from "@/ui/testing/axe";
import { fixtureCatalog, renderWithStudio } from "../../../test/harness";
import { CardSheet } from "./testing/CardSheet";
import { cardProject, GALLERY_FACETS } from "./testing/projects";

const catalog = fixtureCatalog();
const TRANSFER: Hex4 = "0xa9059cbb";
const SEND_MESSAGE: Hex4 = "0xcdfe7f5c";

function row(facet: string, selector: Hex4): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-facet="${facet}"] [data-selector="${selector}"]`);
  if (!el) throw new Error(`${facet} draws no row for ${selector}.`);
  return el;
}

async function sheet() {
  const project = cardProject(catalog, GALLERY_FACETS, { exclude: ["0x95d89b41"], expanded: ["HyperlaneGatewayAdapter"] });
  await renderWithStudio(<CardSheet />, { project });
  await expect.poll(() => document.querySelectorAll("[data-facet]").length).toBe(Object.keys(project.layout).length);
}

/** The words a row draws, as text (the `hidden` description a row carries isn't drawn). */
function drawn(el: HTMLElement): string {
  return (el.querySelector("[class*='label']")?.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("pin row words", () => {
  test("the drawn spans read as words: a space between the name and what follows it", async () => {
    await sheet();
    expect(drawn(row("ERC20", TRANSFER))).toBe("transfer Seam: stays on GovernedVault");
    expect(drawn(row("ERC20", "0x06fdde03"))).toBe("name → GovernedVault");
    expect(drawn(row("ERC20", "0xdd62ed3e"))).toBe("allowance 0xdd62ed3e");
    expect(row("ERC20", TRANSFER).textContent).toContain("transfer Seam: stays on GovernedVault");
    expect(row("ERC20", "0x06fdde03").textContent).toContain("name → GovernedVault");
  });

  test("the accessible name contains the drawn words, in order", async () => {
    await sheet();
    for (const [facet, selector] of [
      ["ERC20", TRANSFER],
      ["ERC20", "0x06fdde03"],
      ["ERC20", "0xdd62ed3e"],
      ["AxelarGatewayAdapter", SEND_MESSAGE],
    ] as const) {
      const el = row(facet, selector);
      const name = el.getAttribute("aria-label") ?? "";
      expect(name.toLowerCase()).toContain(drawn(el).toLowerCase());
    }
    await expect
      .element(page.getByRole("button", { name: "transfer Seam: stays on GovernedVault, transfer(address,uint256) 0xa9059cbb, seam: stays on GovernedVault" }).first())
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "name → GovernedVault, name() 0x06fdde03, served by GovernedVault" }))
      .toBeInTheDocument();
  });

  test("axe's label-content-name-mismatch passes on a card with contested and seam pins", async () => {
    await sheet();
    expect(row("AxelarGatewayAdapter", SEND_MESSAGE).dataset.state).toBe("contested");
    expect(row("ERC20", TRANSFER).dataset.state).toBe("seam");
    expect(row("ERC20", "0x06fdde03").dataset.state).toBe("elsewhere");
    const violations = await axeViolations(document.body, { rules: { "label-content-name-mismatch": { enabled: true } } });
    expect(violations.filter((v) => v.startsWith("label-content-name-mismatch"))).toEqual([]);
  });
});
