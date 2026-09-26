/**
 * Settings → Wallet's switch as the chain module follows it (spec L635), in a real browser with wagmi: Off ends a
 * WalletConnect session and drops its connector; On loads it; On without a project id goes back off and says why.
 * WalletConnect's SDK never runs: a wagmi `mock` connector that calls itself WalletConnect stands in for it.
 */
import { mock, getConnectors, type CreateConnectorFn } from "@wagmi/core";
import { custom } from "viem";
import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { settings } from "@/contracts";
import { recordedLog } from "@/contracts/kernel";
import { WalletGroup } from "@/settings/groups/WalletGroup";
import { onCleanup, renderWithStudio } from "../../../test/harness";
import { WALLETCONNECT_NOT_SET_UP } from "./copy";
import { followWalletConnectSetting, walletChains, walletConnectLoader } from "./runtime";
import { createWallet, WALLETCONNECT_ID, WALLETCONNECT_NAME, type Wallet } from "./wallet";

const ME = "0x3333333333333333333333333333333333333333";

/** wagmi's mock connector, registered as WalletConnect's would be. */
const standIn: CreateConnectorFn = (config) =>
  ({ ...mock({ accounts: [ME] })(config), id: WALLETCONNECT_ID, name: "WalletConnect", type: "walletConnect" }) as unknown as ReturnType<CreateConnectorFn>;

function setup(projectId: string | undefined): { wallet: Wallet; loads: () => number } {
  let loads = 0;
  const wallet = createWallet({
    chains: walletChains(false, {}),
    transport: () => custom({ request: () => Promise.reject(new Error("No reads in these tests.")) }),
    discovery: false,
    legacyInjected: () => false,
    storage: null,
    walletConnect: walletConnectLoader(projectId, async () => {
      loads += 1;
      return { walletConnectConnector: () => standIn };
    }),
  });
  onCleanup(followWalletConnectSetting(wallet));
  return { wallet, loads: () => loads };
}

const registered = (wallet: Wallet) => getConnectors(wallet.config).filter((c) => c.type === "walletConnect").length;
const control = () => page.getByRole("switch", { name: "WalletConnect" });

describe("Settings → Wallet, followed by the chain module", () => {
  test("choosing Other wallets (QR) turns it on; Off ends the session and drops the connector; the row stays", async () => {
    await renderWithStudio(<WalletGroup />);
    const { wallet } = setup("studio-test-project");
    await expect.element(control()).not.toBeChecked();

    expect(await wallet.connect(WALLETCONNECT_ID)).toMatchObject({ ok: true, value: { connector: WALLETCONNECT_ID } });
    await expect.element(control()).toBeChecked();
    expect(registered(wallet)).toBe(1);

    await control().click();
    await expect.element(control()).not.toBeChecked();
    await expect.poll(() => wallet.state()).toBeNull();
    await expect.poll(() => registered(wallet)).toBe(0);
    expect(wallet.connectors().at(-1)).toEqual({ id: WALLETCONNECT_ID, name: WALLETCONNECT_NAME, kind: "walletconnect" });
  });

  test("On (keyboard) loads WalletConnect's connector without connecting anything", async () => {
    await renderWithStudio(<WalletGroup />);
    const { wallet, loads } = setup("studio-test-project");
    expect(registered(wallet)).toBe(0);

    (await control().element() as HTMLElement).focus();
    await userEvent.keyboard(" ");
    await expect.element(control()).toBeChecked();
    await expect.poll(() => registered(wallet)).toBe(1);
    expect(loads()).toBe(1);
    expect(wallet.state()).toBeNull();
    await expect.element(control()).toBeChecked();
  });

  test("On in a build without a project id goes back off, and the console says why", async () => {
    await renderWithStudio(<WalletGroup />);
    const { wallet, loads } = setup(undefined);
    const before = recordedLog().length;

    await control().click();
    await expect.element(control()).not.toBeChecked();
    expect(settings.get().walletConnect).toBe(false);
    expect(recordedLog().slice(before).map((line) => [line.tag, line.text])).toEqual([["Note", WALLETCONNECT_NOT_SET_UP]]);
    expect(loads()).toBe(0);
    expect(registered(wallet)).toBe(0);
  });
});
