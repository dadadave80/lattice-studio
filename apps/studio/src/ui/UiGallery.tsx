import type { Platform } from "@lattice-studio/core";
import type { ThemeId } from "@lattice-studio/tokens";
import { useEffect, useState } from "react";
import { applyTheme, settings } from "@/contracts";
import { FoundationGallery } from "./gallery/FoundationGallery";
import styles from "./gallery/Gallery.module.css";
import { overridePlatform, usePlatform } from "./shared/platform";

function currentTheme(): ThemeId {
  return document.documentElement.dataset.theme === "draft" ? "draft" : "shop";
}

/**
 * The `#/__ui` gallery (dev only, contracts §5.5): every primitive in every state, in the theme and key
 * labels chosen at the top. Q3 takes its screenshot baselines from here. Load it lazily; it isn't part of
 * the app's entry chunk.
 */
export function UiGallery() {
  const [theme, setTheme] = useState<ThemeId>(currentTheme);
  const detected = usePlatform();
  const [keys, setKeys] = useState<Platform>(detected);

  useEffect(() => overridePlatform(keys), [keys]);

  const chooseTheme = (next: ThemeId) => {
    settings.set({ theme: next });
    applyTheme(next);
    setTheme(next);
  };

  return (
    <div className={styles.gallery} data-ui-gallery="">
      <header className={styles.header}>
        <h1 className={styles.title}>Primitives</h1>
        <div className={styles.row}>
          <div role="group" aria-label="Theme" className={styles.row}>
            {(["shop", "draft"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={theme === t} className={styles.choice} onClick={() => chooseTheme(t)}>
                {t === "shop" ? "Shop" : "Draft"}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Key labels" className={styles.row}>
            {(["mac", "other"] as const).map((p) => (
              <button key={p} type="button" aria-pressed={keys === p} className={styles.choice} onClick={() => setKeys(p)}>
                {p === "mac" ? "macOS" : "Windows and Linux"}
              </button>
            ))}
          </div>
        </div>
      </header>
      <FoundationGallery />
    </div>
  );
}
