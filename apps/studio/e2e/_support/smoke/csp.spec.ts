/**
 * The CSP guard (spec L863-L865): every page the kit opens reports its `securitypolicyviolation` events to the
 * automatic `cspViolations` fixture, which fails the test on any left when it ends. This proves the recorder sees a
 * violation; the suites prove the app causes none.
 */
import { expect, test } from "../fixtures.ts";
import { openEmpty } from "../seed.ts";

test.describe("CSP guard @smoke", () => {
  test("records an inline script the CSP blocks", async ({ page, cspViolations }) => {
    await openEmpty(page);
    expect(cspViolations).toEqual([]);
    await page.evaluate(() => {
      const script = document.createElement("script");
      script.textContent = "window.name = 'ran';";
      document.head.append(script);
    });
    await expect.poll(() => cspViolations.length).toBe(1);
    expect(cspViolations[0]).toMatch(/^script-src(-elem)? blocked inline .* on \/$/);
    expect(await page.evaluate(() => window.name)).not.toBe("ran");
    // Provoked on purpose and asserted on: leave nothing for the fixture to fail on.
    cspViolations.length = 0;
  });

  test("records a style attribute set from markup", async ({ page, cspViolations }) => {
    await openEmpty(page);
    await page.evaluate(() => {
      const holder = document.createElement("div");
      holder.innerHTML = '<span style="color: red">styled</span>';
      document.body.append(holder);
    });
    await expect.poll(() => cspViolations.length).toBe(1);
    expect(cspViolations[0]).toMatch(/^style-src(-attr)? blocked inline/);
    cspViolations.length = 0;
  });

  test("the app's own first visit reports none", async ({ page, cspViolations }) => {
    await openEmpty(page);
    await expect(page.getByRole("region", { name: "Sheet", exact: true })).toBeVisible();
    expect(cspViolations).toEqual([]);
  });
});
