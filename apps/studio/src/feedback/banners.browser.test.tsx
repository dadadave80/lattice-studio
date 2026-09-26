import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { command, commandRef, hideBanner, showBanner } from "@/contracts";
import { overrideCommands, renderWithStudio } from "../../test/harness";
import { resetBanners } from "./banner-store";
import { BannerHost } from "./BannerHost";

afterEach(() => {
  resetBanners();
});

describe("the banner host (contracts §5.2, IR L199-L210)", () => {
  test("shows a banner an owner posted, with its tone's word and icon", async () => {
    await renderWithStudio(<BannerHost />);
    showBanner("offline", { text: "Offline", tone: "warning" });
    await expect.element(page.getByText("Offline")).toBeVisible();
    await expect.element(page.getByRole("img", { name: "Warning" })).toBeVisible();
  });

  test("runs an action through the command registry, titled from the command", async () => {
    const run = vi.fn();
    overrideCommands([
      command({ id: "app.reload", title: () => "Reload", category: "Session", enabled: () => ({ ok: true }), run }),
    ]);
    await renderWithStudio(<BannerHost />);
    showBanner("update", { text: "A new version of Studio is ready", tone: "info", actions: [commandRef("app.reload")] });
    await page.getByRole("button", { name: "Reload" }).click();
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("a dismissible banner's Close calls hideBanner, and hideBanner removes it however it was closed", async () => {
    await renderWithStudio(<BannerHost />);
    showBanner("share", { text: "Opened from a shared link", tone: "info", dismissible: true });
    await expect.element(page.getByText("Opened from a shared link")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(page.getByText("Opened from a shared link")).not.toBeInTheDocument();
  });

  test("several banners stack, each hidden on its own", async () => {
    await renderWithStudio(<BannerHost />);
    showBanner("a", { text: "First banner" });
    showBanner("b", { text: "Second banner" });
    await expect.element(page.getByText("First banner")).toBeVisible();
    await expect.element(page.getByText("Second banner")).toBeVisible();
    hideBanner("a");
    await expect.element(page.getByText("First banner")).not.toBeInTheDocument();
    await expect.element(page.getByText("Second banner")).toBeVisible();
  });

  test("nothing renders when there are no banners", async () => {
    const screen = await renderWithStudio(<BannerHost />);
    expect(screen.container.textContent).toBe("");
  });
});
