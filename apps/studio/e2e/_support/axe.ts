/**
 * axe through Playwright (spec L797): the WCAG 2.0, 2.1 and 2.2 A and AA rules, with `target-size` (2.5.8) and
 * `label-content-name-mismatch` (2.5.3, spec L779: every visible label is part of its control's accessible name)
 * switched on; axe ships the first disabled and the second as experimental. axe misses most criteria, so a clean run
 * is only the floor.
 *
 *   await expectNoAxeViolations(page);                                  // the whole page
 *   await expectNoAxeViolations(page, { include: region(page, "Sheet") });
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";
import type { AxeResults, Result } from "axe-core";

/** The tags spec L797 names, with the levels under them. */
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;

/**
 * Rules under those tags that axe leaves off unless asked: `target-size` (2.5.8) is disabled by default, and
 * `label-content-name-mismatch` (2.5.3, spec L779) is tagged experimental.
 */
export const AXE_EXTRA_RULES = ["target-size", "label-content-name-mismatch"] as const;

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

/** Runs axe with the WCAG 2.2 AA tags and `AXE_EXTRA_RULES` on. */
export async function runAxe(page: Page, options: AxeOptions = {}): Promise<AxeResults> {
  // `options()` replaces every option, so it goes before `withTags()` (which sets `runOnly` on top of it).
  const rules = Object.fromEntries(AXE_EXTRA_RULES.map((id) => [id, { enabled: true }]));
  let builder = new AxeBuilder({ page }).options({ rules }).withTags([...AXE_TAGS]);
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
