/**
 * The mock-connector helper: the build carries wagmi's mock connector, chain 31337 points at this worker's node,
 * and, once the console (S5e) and the palette (S6) have landed, the helper connects Anvil's account 0 on Anvil.
 */
import { skipUnlessBuilt } from "../built.ts";
import { expect, test } from "../fixtures.ts";
import { openEmpty } from "../seed.ts";
import { MOCK_ACCOUNT, MOCK_CONNECTOR_NAME, connectMockWallet, shortAddress } from "../wallet.ts";

test.describe("mock wallet @smoke", () => {
  test("the e2e chunk carries the mock connector", async ({ page }) => {
    await openEmpty(page);
    const html = await (await page.request.get("/")).text();
    const chunk = /assets\/e2e-[\w-]+\.js/.exec(html)?.[0];
    expect(chunk, "the import map lists the e2e chunk").toBeDefined();
    const code = await (await page.request.get(`/${chunk}`)).text();
    expect(code).toContain(MOCK_ACCOUNT);
  });

  test("connects Anvil's account 0 on Anvil", async ({ page, anvil }) => {
    await openEmpty(page);
    await skipUnlessBuilt(page, "S5e", "S6");
    await connectMockWallet(page);
    const log = page.getByRole("log");
    await expect(log).toContainText(`${shortAddress(MOCK_ACCOUNT)} through ${MOCK_CONNECTOR_NAME}`);
    expect(await anvil.client.getChainId()).toBe(31337);
  });

  test("shortens addresses as the console does", () => {
    expect(shortAddress(MOCK_ACCOUNT)).toBe("0xf39F…2266");
  });
});
