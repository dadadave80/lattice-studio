/**
 * Keeps `data-theme` on `<html>` in step with the Theme setting (contracts §5.4): Shop is the dark theme,
 * Draft the light one, and System follows `prefers-color-scheme`.
 */
import type { ThemeId } from "@lattice-studio/tokens";
import { settings, type ThemeChoice } from "./stores";

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ThemeId {
  if (choice === "system") return prefersDark ? "shop" : "draft";
  return choice;
}

function prefersDark(): boolean {
  return typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)").matches : true;
}

export function applyTheme(choice: ThemeChoice, root: HTMLElement = document.documentElement): ThemeId {
  const theme = resolveTheme(choice, prefersDark());
  root.dataset.theme = theme;
  return theme;
}

/** Applies the theme now and whenever the setting or the system preference changes. Returns a disposer. */
export function syncTheme(): () => void {
  applyTheme(settings.get().theme);
  const stopSettings = settings.subscribe((next, previous) => {
    if (next.theme !== previous.theme) applyTheme(next.theme);
  });
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const onMedia = () => applyTheme(settings.get().theme);
  media?.addEventListener("change", onMedia);
  return () => {
    stopSettings();
    media?.removeEventListener("change", onMedia);
  };
}
