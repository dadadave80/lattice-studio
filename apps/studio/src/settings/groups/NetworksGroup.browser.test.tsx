import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { settings } from "@/contracts";
import { fakeChainService, renderWithStudio } from "../../../test/harness";
import { NetworksGroup } from "./NetworksGroup";

describe("NetworksGroup", () => {
  test("shows the S8a not-built-yet state when the chain module hasn't landed", async () => {
    await renderWithStudio(<NetworksGroup />);
    await expect.element(page.getByText("Not built yet · WP-S8a")).toBeVisible();
    await expect.element(page.getByText("Custom chains arrive in v1.1.")).toBeVisible();
  });

  test("lists chains with readiness and lets an override be typed", async () => {
    const chain = fakeChainService();
    await renderWithStudio(<NetworksGroup />, { chain });
    await expect.element(page.getByText("Sepolia RPC override")).toBeVisible();
    await expect.element(page.getByText("Base Sepolia RPC override")).toBeVisible();
    await expect.poll(() => page.getByText("Ready").elements().length).toBeGreaterThan(0);

    await page.getByRole("textbox", { name: "Sepolia RPC override" }).fill("https://sepolia.example/rpc");
    expect(settings.get().rpc[11155111]).toBe("https://sepolia.example/rpc");
  });

  test("an invalid override shows the won't-be-used hint", async () => {
    const chain = fakeChainService();
    await renderWithStudio(<NetworksGroup />, { chain });
    const field = page.getByRole("textbox", { name: "Sepolia RPC override" });
    await field.fill("not a url");
    await expect.element(page.getByText("This won't be used: it needs an http(s) or ws(s) URL.")).toBeVisible();
  });
});
