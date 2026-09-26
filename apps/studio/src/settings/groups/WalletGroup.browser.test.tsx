import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { settings } from "@/contracts";
import { renderWithStudio } from "../../../test/harness";
import { WalletGroup } from "./WalletGroup";

describe("WalletGroup", () => {
  test("renders WalletConnect with its description, off by default", async () => {
    await renderWithStudio(<WalletGroup />);
    const control = page.getByRole("switch", { name: "WalletConnect" });
    await expect.element(control).not.toBeChecked();
    await expect
      .element(control)
      .toHaveAccessibleDescription("Off until chosen. When it's on, its relay sees the connection, and its telemetry stays disabled.");
  });

  test("shows a settings value already on", async () => {
    await renderWithStudio(<WalletGroup />, { settings: { walletConnect: true } });
    await expect.element(page.getByRole("switch", { name: "WalletConnect" })).toBeChecked();
  });

  test("toggling it updates settings.walletConnect", async () => {
    await renderWithStudio(<WalletGroup />);
    await page.getByRole("switch", { name: "WalletConnect" }).click();
    expect(settings.get().walletConnect).toBe(true);
  });
});
