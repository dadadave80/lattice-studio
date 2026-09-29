import type { Platform } from "@lattice-studio/core";
import type { ThemeId } from "@lattice-studio/tokens";
import { useEffect, useState } from "react";
import { applyTheme } from "@/contracts";
import { FieldsGallery } from "./fields/FieldsGallery";
import { SegmentedToggle } from "./fields/SegmentedToggle";
import { FoundationGallery } from "./gallery/FoundationGallery";
import styles from "./gallery/Gallery.module.css";
import { NavGallery } from "./nav/NavGallery";
import { OverlaysGallery } from "./overlays/OverlaysGallery";
import { overridePlatform, usePlatform } from "./shared/platform";

function currentTheme(): ThemeId {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

const THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const KEY_LABELS = [
  { value: "mac", label: "macOS" },
  { value: "other", label: "Windows and Linux" },
] as const;

/**
 * The `#/__ui` gallery (dev only, contracts §5.5): every primitive in every state, in the theme and key
 * labels chosen at the top. Q3 takes its screenshot baselines from here. Load it lazily; it isn't part of
 * the app's entry chunk (the `@/ui` barrel doesn't export it).
 */
export function UiGallery() {
  const [theme, setTheme] = useState<ThemeId>(currentTheme);
  const detected = usePlatform();
  const [keys, setKeys] = useState<Platform>(detected);

  useEffect(() => overridePlatform(keys), [keys]);

  // The page's theme only: the gallery never writes the person's Settings.
  const chooseTheme = (next: ThemeId) => {
    applyTheme(next);
    setTheme(next);
  };

  return (
    <div className={styles.gallery} data-ui-gallery="">
      <header className={styles.header}>
        <h1 className={styles.title}>Primitives</h1>
        <div className={styles.row}>
          <SegmentedToggle label="Theme" value={theme} onValueChange={chooseTheme} options={THEMES} />
          <SegmentedToggle label="Key labels" value={keys} onValueChange={setKeys} options={KEY_LABELS} />
        </div>
      </header>
      <FoundationGallery />
      <FieldsGallery />
      <OverlaysGallery />
      <NavGallery />
    </div>
  );
}
