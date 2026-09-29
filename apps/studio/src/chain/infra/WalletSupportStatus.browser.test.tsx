import { describe, expect, test, vi } from "vitest";
import type { ChainService } from "@/contracts";
import { renderWithStudio } from "../../../test/harness";
import { createChainLoader } from "./loader";
import { WalletSupportStatus } from "./WalletSupportStatus";

const service = { chains: () => [] } as unknown as ChainService;

function controlled() {
  let finish: (value: ChainService) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const loader = createChainLoader(
    () =>
      new Promise<ChainService>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
  );
  return { loader, finish: (s: ChainService) => finish(s), fail: (e: Error) => fail(e) };
}

describe("WalletSupportStatus", () => {
  test("nothing before anything asks for the chain module", async () => {
    const { loader } = controlled();
    const screen = await renderWithStudio(<WalletSupportStatus loader={loader} />);
    expect(screen.container.textContent).toBe("");
  });

  test("“Loading wallet support…” as a polite status while it loads (Light theme), then nothing", async () => {
    const { loader, finish } = controlled();
    const screen = await renderWithStudio(<WalletSupportStatus loader={loader} />, { theme: "light" });
    void loader.load();
    const status = screen.getByRole("status");
    await expect.element(status).toHaveTextContent("Loading wallet support…");
    await expect.element(status).toHaveAttribute("aria-live", "polite");
    finish(service);
    await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
  });

  test("a failed load shows nothing of its own (S11a's banner speaks) and goes to the console", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { loader, fail } = controlled();
    const screen = await renderWithStudio(<WalletSupportStatus loader={loader} />);
    loader.load().catch(() => {});
    await expect.element(screen.getByRole("status")).toBeInTheDocument();
    fail(new Error("Failed to fetch dynamically imported module"));
    await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
    expect(screen.container.textContent).toBe("");
    expect(screen.container.querySelector("button")).toBeNull();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
