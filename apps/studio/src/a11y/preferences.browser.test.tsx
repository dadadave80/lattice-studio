import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { settings, syncTheme } from "@/contracts";
import { onCleanup, renderWithStudio } from "../../test/harness";
import {
  FORCED_COLORS_QUERY, MORE_CONTRAST_QUERY, REDUCED_MOTION_QUERY, reducedMotion, useForcedColors, useMoreContrast,
  useReducedMotion,
} from "./preferences";

/** A stand-in for the system's media queries: which match, and a way to change them. */
function fakeMedia(matching: string[]): { set(query: string, on: boolean): void } {
  const on = new Set(matching);
  const lists = new Map<string, { listeners: Set<() => void>; list: MediaQueryList }>();
  const original = window.matchMedia;
  window.matchMedia = (query: string) => {
    let entry = lists.get(query);
    if (!entry) {
      const listeners = new Set<() => void>();
      const list = {
        media: query,
        get matches() {
          return on.has(query);
        },
        onchange: null,
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
        addListener: (fn: () => void) => listeners.add(fn),
        removeListener: (fn: () => void) => listeners.delete(fn),
        dispatchEvent: () => true,
      } as unknown as MediaQueryList;
      entry = { listeners, list };
      lists.set(query, entry);
    }
    return entry.list;
  };
  onCleanup(() => {
    window.matchMedia = original;
  });
  return {
    set(query, value) {
      if (value) on.add(query);
      else on.delete(query);
      for (const fn of lists.get(query)?.listeners ?? []) fn();
    },
  };
}

function Probe() {
  const reduce = useReducedMotion();
  const forced = useForcedColors();
  const contrast = useMoreContrast();
  return <p>{`motion ${reduce ? "reduce" : "full"} · forced ${forced ? "on" : "off"} · contrast ${contrast ? "more" : "no preference"}`}</p>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reduced motion", () => {
  test("follows the system by default, and the in-app setting over it", async () => {
    const media = fakeMedia([]);
    await renderWithStudio(<Probe />);
    await expect.element(page.getByText(/^motion full/)).toBeVisible();
    expect(reducedMotion()).toBe(false);

    media.set(REDUCED_MOTION_QUERY, true);
    await expect.element(page.getByText(/^motion reduce/)).toBeVisible();
    expect(reducedMotion()).toBe(true);

    settings.set({ reduceMotion: "off" });
    await expect.element(page.getByText(/^motion full/)).toBeVisible();
    expect(reducedMotion()).toBe(false);

    media.set(REDUCED_MOTION_QUERY, false);
    settings.set({ reduceMotion: "on" });
    await expect.element(page.getByText(/^motion reduce/)).toBeVisible();
    expect(reducedMotion()).toBe(true);
  });

  test("sets data-motion=\"reduce\" on <html> with the hook, from either source", async () => {
    const media = fakeMedia([]);
    onCleanup(syncTheme());
    await renderWithStudio(<Probe />);
    expect(document.documentElement.dataset.motion).toBeUndefined();
    settings.set({ reduceMotion: "on" });
    expect(document.documentElement.dataset.motion).toBe("reduce");
    settings.set({ reduceMotion: "system" });
    expect(document.documentElement.dataset.motion).toBeUndefined();
    media.set(REDUCED_MOTION_QUERY, true);
    expect(document.documentElement.dataset.motion).toBe("reduce");
    await expect.element(page.getByText(/^motion reduce/)).toBeVisible();
  });
});

describe("forced colors and more contrast", () => {
  test("the hooks follow the system", async () => {
    const media = fakeMedia([]);
    await renderWithStudio(<Probe />);
    await expect.element(page.getByText("motion full · forced off · contrast no preference")).toBeVisible();
    media.set(FORCED_COLORS_QUERY, true);
    media.set(MORE_CONTRAST_QUERY, true);
    await expect.element(page.getByText("motion full · forced on · contrast more")).toBeVisible();
    media.set(FORCED_COLORS_QUERY, false);
    await expect.element(page.getByText("motion full · forced off · contrast more")).toBeVisible();
  });
});
