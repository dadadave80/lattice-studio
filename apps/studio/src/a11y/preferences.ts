/**
 * Motion and contrast preferences (spec L784-L789) for code that can't key off CSS: React Flow's viewport
 * moves, Tidy's animation, stroke widths computed in script. Styles use `html[data-motion="reduce"]`
 * (K2's `syncTheme` sets it from the Reduce motion setting, system by default) and the `forced-colors` and
 * `prefers-contrast` media queries directly.
 */
import { useSyncExternalStore } from "react";
import { resolveMotion, settings, useSettings } from "@/contracts";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export const FORCED_COLORS_QUERY = "(forced-colors: active)";
export const MORE_CONTRAST_QUERY = "(prefers-contrast: more)";

function media(query: string): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
}

/** Whether a media query matches now. */
export function mediaMatches(query: string): boolean {
  return media(query)?.matches ?? false;
}

/** Whether a media query matches, re-rendering when it changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = media(query);
      list?.addEventListener("change", onChange);
      return () => list?.removeEventListener("change", onChange);
    },
    () => mediaMatches(query),
    () => false,
  );
}

/**
 * Whether motion is reduced now, by the in-app setting or, when it follows the system, by the system. For
 * non-render code: viewport moves jump instead of gliding (`duration: reducedMotion() ? 0 : 200`).
 */
export function reducedMotion(): boolean {
  return resolveMotion(settings.get().reduceMotion, mediaMatches(REDUCED_MOTION_QUERY)) === "reduce";
}

/** `reducedMotion()` for render, re-rendering when the setting or the system preference changes. */
export function useReducedMotion(): boolean {
  const choice = useSettings((s) => s.reduceMotion);
  const system = useMediaQuery(REDUCED_MOTION_QUERY);
  return resolveMotion(choice, system) === "reduce";
}

/** Windows contrast themes and other forced-colors modes: traces use `CanvasText`, selection and focus `Highlight`. */
export function useForcedColors(): boolean {
  return useMediaQuery(FORCED_COLORS_QUERY);
}

/** `prefers-contrast: more`: 2 px strokes and stronger borders. */
export function useMoreContrast(): boolean {
  return useMediaQuery(MORE_CONTRAST_QUERY);
}
