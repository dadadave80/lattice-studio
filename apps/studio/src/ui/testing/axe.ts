/**
 * axe for browser tests of the primitives (test-only; never imported by app code). axe-core comes in as
 * source through `?raw` rather than through Vite's dependency optimizer, because a first-time optimization
 * reloads the page in the middle of a run. It's the copy `@axe-core/playwright` brings in.
 */
import type AxeCore from "axe-core";
import axeSource from "axe-core/axe.min.js?raw";
import { cdp } from "vitest/browser";

export const WCAG22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function loadAxe(): typeof AxeCore {
  const holder = window as unknown as { axe?: typeof AxeCore };
  if (!holder.axe) {
    const script = document.createElement("script");
    script.textContent = axeSource;
    document.head.append(script);
    script.remove();
  }
  if (!holder.axe) throw new Error("axe-core didn't load.");
  return holder.axe;
}

/**
 * Violations under `root`, one line each, with target-size on (spec L795). With `forced`, color-contrast is
 * off: the system palette replaces ours, and axe resolves the authored text color against the forced
 * Canvas. Every other rule still runs.
 */
export async function axeViolations(
  context: AxeCore.ElementContext,
  options: { forced?: boolean; bestPractice?: boolean; rules?: AxeCore.RuleObject } = {},
): Promise<string[]> {
  const { forced = false, bestPractice = false, rules = {} } = options;
  const result = await loadAxe().run(context, {
    runOnly: { type: "tag", values: bestPractice ? [...WCAG22_AA, "best-practice"] : WCAG22_AA },
    rules: {
      "target-size": { enabled: true },
      ...(forced ? { "color-contrast": { enabled: false } } : {}),
      ...rules,
    },
    resultTypes: ["violations"],
  });
  return result.violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id}: ${n.target.join(" ")} · ${n.failureSummary?.replace(/\s+/g, " ") ?? v.help}`),
  );
}

/** Emulates `forced-colors: active` (Windows contrast themes) through the Chrome DevTools Protocol. */
export async function emulateForcedColors(active: boolean): Promise<void> {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "forced-colors", value: active ? "active" : "none" }],
  });
}
