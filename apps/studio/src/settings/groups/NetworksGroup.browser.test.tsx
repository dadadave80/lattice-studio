import { describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { settings } from "@/contracts";
import { createChainLoader } from "@/chain/infra";
import { fakeChainService, renderWithStudio } from "../../../test/harness";
import { NetworksGroup } from "./NetworksGroup";

describe("NetworksGroup (spec D13: Settings never loads the chain runtime by itself)", () => {
  test("lists the static picker chains with a Check action, and never loads the runtime on its own", async () => {
    const load = vi.fn();
    const loader = createChainLoader(load);
    await renderWithStudio(<NetworksGroup loader={loader} />);
    await expect.element(page.getByText("Sepolia RPC override")).toBeVisible();
    await expect.element(page.getByText("Base Sepolia RPC override")).toBeVisible();
    await expect.element(page.getByText("HSKChain Testnet RPC override")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Check HSKChain Testnet" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Check Sepolia" })).toBeVisible();
    await expect.element(page.getByText("Ready")).not.toBeInTheDocument();
    await expect.element(page.getByText("Custom chains arrive in v1.1.")).toBeVisible();
    expect(load).not.toHaveBeenCalled();
  });

  test("Check loads the runtime on request and probes just that chain", async () => {
    const chain = fakeChainService();
    const loader = createChainLoader(() => Promise.resolve(chain));
    await renderWithStudio(<NetworksGroup loader={loader} />);
    await page.getByRole("button", { name: "Check Sepolia" }).click();
    // The runtime is up now: readiness shows for every row, but only Sepolia was ever probed.
    await expect.element(page.getByText("Ready", { exact: true }).first()).toBeVisible();
    expect(chain.calls.filter((c) => c.method === "probe").map((c) => c.args[0])).toEqual([11155111]);
  });

  test("when the runtime is already up (loaded for some other reason), readiness shows without a Check click", async () => {
    const chain = fakeChainService();
    const loader = createChainLoader(() => Promise.resolve(chain));
    await loader.load(); // as if Deploy or a chain pick loaded it earlier in the session
    await renderWithStudio(<NetworksGroup loader={loader} />);
    await expect.element(page.getByRole("button", { name: "Check Sepolia" })).not.toBeInTheDocument();
    await expect.element(page.getByText("Not checked yet.").first()).toBeVisible();
  });

  test("a valid override writes to settings.rpc; an invalid one stays local and shows the hint", async () => {
    const loader = createChainLoader(() => Promise.resolve(fakeChainService()));
    await renderWithStudio(<NetworksGroup loader={loader} />);
    const field = page.getByRole("textbox", { name: "Sepolia RPC override" });

    await field.fill("not a url");
    await expect.element(page.getByText("This won't be used: it needs a valid http(s) URL.")).toBeVisible();
    expect(settings.get().rpc[11155111]).toBeUndefined();

    await field.fill("https://sepolia.example/rpc");
    await expect.element(page.getByText("This won't be used: it needs a valid http(s) URL.")).not.toBeInTheDocument();
    expect(settings.get().rpc[11155111]).toBe("https://sepolia.example/rpc");
  });
});
