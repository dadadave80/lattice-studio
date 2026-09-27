import { describe, expect, test } from "vitest";
import { App } from "@/app";
import { onCleanup, renderWithStudio } from "../../test/harness";

/** Animations that are playing now (a finished one, or one that never started, doesn't move). */
function running(): Animation[] {
  return document.getAnimations().filter((animation) => animation.playState === "running");
}

/** Waits for the browser to style and paint twice, so animations have started or finished. */
async function frames(): Promise<void> {
  for (let i = 0; i < 2; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
}

/** An element that pulses forever, like the catalog's loading rows, in a stylesheet of its own. */
function pulse(): HTMLElement {
  const style = document.createElement("style");
  style.textContent = "@keyframes fx43-pulse { 50% { opacity: 0.5; } } .fx43-pulse { animation: fx43-pulse 1s infinite; }";
  const el = document.createElement("div");
  el.className = "fx43-pulse";
  document.head.append(style);
  document.body.append(el);
  onCleanup(() => {
    style.remove();
    el.remove();
  });
  return el;
}

describe("reduced motion (spec L784)", () => {
  test("with motion on, the catalog's loading rows pulse (the control for the test below)", async () => {
    await renderWithStudio(<App />, { catalog: null, settings: { reduceMotion: "off" } });
    pulse();
    const names = () => running().map((a) => (a as CSSAnimation).animationName);
    await expect.poll(() => names().some((name) => name.includes("catalog-pulse")), { timeout: 10_000 }).toBe(true);
    expect(names()).toContain("fx43-pulse");
  });

  test("nothing pulses under data-motion=reduce: no animation is running, the catalog's loading rows included", async () => {
    await renderWithStudio(<App />, { catalog: null, settings: { reduceMotion: "on" } });
    expect(document.documentElement.dataset.motion).toBe("reduce");
    pulse();
    // The loading rows are what pulse while the catalog loads; wait until they're there.
    await expect
      .poll(() => document.querySelectorAll("[class*='placeholderRow']").length, { timeout: 10_000 })
      .toBeGreaterThan(0);
    await frames();
    expect(running().map((a) => (a as CSSAnimation).animationName ?? a.id)).toEqual([]);
  });
});
