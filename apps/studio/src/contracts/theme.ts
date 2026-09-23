/**
 * Keeps `<html>` in step with the Appearance settings (contracts §5.4, spec L631): `data-theme` (Shop is the
 * dark theme, Draft the light one, System follows `prefers-color-scheme`) and `data-motion="reduce"` (Reduce
 * motion: Follow system, On or Off). Styles key off the attributes, never the media queries, so the in-app
 * choice wins over the system's.
 */
import type { ThemeId } from "@lattice-studio/tokens";
import { settings, type SettingsState, type ThemeChoice } from "./stores";

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ThemeId {
  if (choice === "system") return prefersDark ? "shop" : "draft";
  return choice;
}

export function resolveMotion(choice: SettingsState["reduceMotion"], prefersReduced: boolean): "reduce" | "full" {
  if (choice === "system") return prefersReduced ? "reduce" : "full";
  return choice === "on" ? "reduce" : "full";
}

function media(query: string): MediaQueryList | null {
  return typeof matchMedia === "function" ? matchMedia(query) : null;
}

const DARK = "(prefers-color-scheme: dark)";
const REDUCED = "(prefers-reduced-motion: reduce)";

export function applyTheme(choice: ThemeChoice, root: HTMLElement = document.documentElement): ThemeId {
  const theme = resolveTheme(choice, media(DARK)?.matches ?? true);
  root.dataset.theme = theme;
  return theme;
}

export function applyMotion(choice: SettingsState["reduceMotion"], root: HTMLElement = document.documentElement): "reduce" | "full" {
  const motion = resolveMotion(choice, media(REDUCED)?.matches ?? false);
  if (motion === "reduce") root.dataset.motion = "reduce";
  else delete root.dataset.motion;
  return motion;
}

/** Applies theme and motion now and whenever the settings or the system preferences change. Returns a disposer. */
export function syncTheme(): () => void {
  const apply = () => {
    applyTheme(settings.get().theme);
    applyMotion(settings.get().reduceMotion);
  };
  apply();
  const stopSettings = settings.subscribe((next, previous) => {
    if (next.theme !== previous.theme || next.reduceMotion !== previous.reduceMotion) apply();
  });
  const queries = [media(DARK), media(REDUCED)];
  for (const q of queries) q?.addEventListener("change", apply);
  return () => {
    stopSettings();
    for (const q of queries) q?.removeEventListener("change", apply);
  };
}
