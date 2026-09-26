/**
 * One state under every emulation: axe with the spec's tags (spec L797), scoped to the state's dialog when it has one,
 * failing on anything a filed gap (`known-gaps.ts`) doesn't explain.
 */
import type { Page } from "@playwright/test";
import { runAxe } from "../../_support/axe.ts";
import { expect, test } from "../../_support/fixtures.ts";
import { withoutKnownGaps } from "./known-gaps.ts";
import { findings } from "./report.ts";
import { EMULATIONS, type AppState } from "./states.ts";

export async function checkEveryEmulation(page: Page, state: AppState): Promise<void> {
  const found: string[] = [];
  const include = state.scope?.(page);
  for (const emulation of EMULATIONS) {
    await page.emulateMedia(emulation.media);
    // Leaving forced colors restarts the controls' color transitions; axe must measure the colors they settle on,
    // not a frame halfway between the system palette and the tokens.
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"), undefined, { timeout: 5_000 });
    const results = await runAxe(page, {
      ...(include ? { include } : {}),
      ...(emulation.disable ? { disable: emulation.disable } : {}),
    });
    for (const line of findings(results)) found.push(`${emulation.name}: ${line}`);
  }
  const unknown = withoutKnownGaps(found, test.info());
  expect(unknown, unknown.join("\n")).toEqual([]);
}
