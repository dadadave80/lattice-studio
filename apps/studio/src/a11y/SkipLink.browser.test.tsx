import { makeProject } from "@lattice-studio/core/testing";
import { afterEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithStudio } from "../../test/harness";
import { resetAnnouncer } from "./announcer";
import { SkipLink } from "./SkipLink";
import { RegionFrame } from "./testing/RegionFrame";

afterEach(() => {
  resetAnnouncer();
});

function App() {
  return (
    <>
      <SkipLink />
      <RegionFrame />
    </>
  );
}

describe("Skip to sheet", () => {
  for (const theme of ["shop", "draft"] as const) {
    test(`is the first Tab stop, hidden until focused (${theme})`, async () => {
      await renderWithStudio(<App />, { theme });
      const link = page.getByRole("link", { name: "Skip to sheet" });
      const hidden = link.element().getBoundingClientRect();
      expect(hidden.bottom).toBeLessThanOrEqual(0);
      await userEvent.tab();
      await expect.element(link).toHaveFocus();
      await expect.element(link).toBeVisible();
      const shown = link.element().getBoundingClientRect();
      expect(shown.top).toBeGreaterThanOrEqual(0);
      expect(getComputedStyle(link.element()).outlineStyle).toBe("solid");
    });
  }

  test("Enter moves focus into the sheet without touching the address", async () => {
    await renderWithStudio(<App />);
    const before = location.hash;
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("region", { name: "Sheet", exact: true })).toHaveFocus();
    expect(location.hash).toBe(before);
  });

  test("lands on the sheet's first Tab stop when it has one", async () => {
    await renderWithStudio(<App />, { project: makeProject({ layout: { ERC20: { x: 0, y: 0, pins: "right" } } }) });
    // S4b's roving focus makes the focused card the card grid's one Tab stop.
    document.querySelector<HTMLElement>('[data-id="ERC20"]')?.setAttribute("tabindex", "0");
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("group", { name: "ERC20" })).toHaveFocus();
  });
});
