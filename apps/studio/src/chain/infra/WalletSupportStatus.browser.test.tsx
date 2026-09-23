import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import type { ChainService } from "@/contracts";
import { renderWithStudio } from "../../../test/harness";
import { createChainLoader } from "./loader";
import { WalletSupportStatus } from "./WalletSupportStatus";

const service = { chains: () => [] } as unknown as ChainService;

function controlled() {
  let finish: (value: ChainService) => void = () => {};
  let fail: (error: Error) => void = () => {};
  let attempts = 0;
  const loader = createChainLoader(() => {
    attempts += 1;
    return new Promise<ChainService>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
  });
  return { loader, finish: (s: ChainService) => finish(s), fail: (e: Error) => fail(e), attempts: () => attempts };
}

describe("WalletSupportStatus", () => {
  test("nothing before anything asks for the chain module", async () => {
    const { loader } = controlled();
    const screen = await renderWithStudio(<WalletSupportStatus loader={loader} />);
    expect(screen.container.textContent).toBe("");
  });

  test("“Loading wallet support…” as a polite status while it loads, then nothing", async () => {
    const { loader, finish } = controlled();
    const screen = await renderWithStudio(<WalletSupportStatus loader={loader} />, { theme: "draft" });
    void loader.load();
    const status = screen.getByRole("status");
    await expect.element(status).toHaveTextContent("Loading wallet support…");
    await expect.element(status).toHaveAttribute("aria-live", "polite");
    finish(service);
    await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
  });

  test("a failed load says why, and Retry (by keyboard) loads again", async () => {
    const { loader, fail, finish, attempts } = controlled();
    const screen = await renderWithStudio(<WalletSupportStatus loader={loader} />);
    loader.load().catch(() => {});
    fail(new Error("Failed to fetch dynamically imported module"));
    const alert = screen.getByRole("alert");
    await expect.element(alert).toHaveTextContent("Couldn't load wallet support. Failed to fetch dynamically imported module");
    const retry = screen.getByRole("button", { name: "Retry" });
    await userEvent.tab();
    await expect.element(retry).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(attempts()).toBe(2);
    await expect.element(screen.getByRole("status")).toHaveTextContent("Loading wallet support…");
    finish(service);
    await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  });
});
