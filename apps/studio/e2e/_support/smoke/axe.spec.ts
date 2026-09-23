/**
 * The axe helper: the WCAG 2.2 AA tags with `target-size` switched on, on the whole shell and on one region.
 * It proves the helper runs the right rules; the Accessibility suite (Q2) asserts no violations in every state.
 */
import { AXE_TAGS, describeViolations, runAxe } from "../axe.ts";
import { expect, test } from "../fixtures.ts";
import { region } from "../keys.ts";
import { openEmpty } from "../seed.ts";

function ruleIds(results: Awaited<ReturnType<typeof runAxe>>): Set<string> {
  return new Set([...results.passes, ...results.violations, ...results.incomplete, ...results.inapplicable].map((r) => r.id));
}

test.describe("axe helper @smoke", () => {
  test("runs the wcag22aa tags with target-size on", async ({ page }) => {
    await openEmpty(page);
    const results = await runAxe(page);
    const ids = ruleIds(results);
    expect(ids.has("target-size")).toBe(true);
    expect(ids.has("color-contrast")).toBe(true);
    // Only tagged rules run: "region" is a best-practice rule outside the WCAG tags.
    expect(ids.has("region")).toBe(false);
    expect(results.toolOptions.runOnly).toEqual({ type: "tag", values: [...AXE_TAGS] });
    for (const rule of results.passes) expect(rule.tags.some((tag) => (AXE_TAGS as readonly string[]).includes(tag)), rule.id).toBe(true);
    // The run itself is the point here; list what it found so a regression is visible in the report.
    test.info().annotations.push({ type: "axe", description: describeViolations(results.violations) || "no violations" });
  });

  test("limits a run to one region", async ({ page }) => {
    await openEmpty(page);
    const whole = await runAxe(page);
    const titleBar = await runAxe(page, { include: region(page, "Title bar") });
    const nodes = (r: typeof whole) => r.passes.reduce((sum, rule) => sum + rule.nodes.length, 0);
    expect(nodes(titleBar)).toBeGreaterThan(0);
    expect(nodes(titleBar)).toBeLessThan(nodes(whole));
  });

  test("switches off a rule by name", async ({ page }) => {
    await openEmpty(page);
    const results = await runAxe(page, { disable: { "color-contrast": "checked by the token contrast tests" } });
    expect(ruleIds(results).has("color-contrast")).toBe(false);
  });
});
