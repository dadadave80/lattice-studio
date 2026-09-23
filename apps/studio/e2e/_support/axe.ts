/**
 * axe through Playwright (spec L797): the WCAG 2.0, 2.1 and 2.2 A and AA rules, with `target-size` (2.5.8) switched
 * on; axe ships it disabled. axe misses most criteria, so a clean run is only the floor.
 *
 *   await expectNoAxeViolations(page);                                  // the whole page
 *   await expectNoAxeViolations(page, { include: region(page, "Sheet") });
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";
import type { AxeResults, Result } from "axe-core";

/** The tags spec L797 names, with the levels under them. */
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;

export type AxeOptions = {
  /** Limit the run to this element (a region, a dialog). */
  include?: Locator;
  /** Rules to switch off, each with the reason it doesn't apply (kept in the failure message). */
  disable?: Record<string, string>;
};

let scopes = 0;

async function selectorFor(locator: Locator): Promise<string> {
  // axe takes CSS selectors; mark the element for this run and point at the mark.
  scopes += 1;
  const mark = `axe-${scopes}`;
  await locator.evaluate((el, value) => el.setAttribute("data-axe-scope", value), mark);
  return `[data-axe-scope="${mark}"]`;
}

/** Runs axe with the WCAG 2.2 AA tags and `target-size` on. */
export async function runAxe(page: Page, options: AxeOptions = {}): Promise<AxeResults> {
  // `options()` replaces every option, so it goes before `withTags()` (which sets `runOnly` on top of it).
  let builder = new AxeBuilder({ page })
    .options({ rules: { "target-size": { enabled: true } } })
    .withTags([...AXE_TAGS]);
  if (options.include) builder = builder.include(await selectorFor(options.include));
  const disabled = Object.keys(options.disable ?? {});
  if (disabled.length > 0) builder = builder.disableRules(disabled);
  return builder.analyze();
}

/** One line per violation and node: "target-size (serious): #id — fix any of: …". */
export function describeViolations(violations: readonly Result[]): string {
  return violations
    .flatMap((v) => v.nodes.map((n) => `${v.id} (${v.impact ?? "unknown"}): ${n.target.join(" ")} — ${n.failureSummary ?? v.help}`))
    .join("\n");
}

/** Fails with every violation listed. */
export async function expectNoAxeViolations(page: Page, options: AxeOptions = {}): Promise<AxeResults> {
  const results = await runAxe(page, options);
  expect(results.violations, describeViolations(results.violations)).toEqual([]);
  return results;
}
