import { lazy, Suspense } from "react";
import { SkipLink } from "@/a11y";
import { CommandPalette } from "@/palette";
import { Shell, shellToasts } from "@/shell";
import { LazyPart, lazyNamed } from "@/shell/LazyPart";
import { Tour } from "@/tour";
import { useDocumentTitle } from "./document-title";
import { useRoute, useRouter } from "./router";
import styles from "./App.module.css";

/** S0's primitives gallery (`#/__ui`): declared only in dev builds, so production emits no gallery chunk. */
const UiGallery = import.meta.env.DEV
  ? lazy(() => import("@/ui/UiGallery").then((m) => ({ default: m.UiGallery })))
  : null;

/**
 * The dialog stack and the toast region render nothing at first paint, so each loads in its own chunk right
 * after it (spec L822). Opening a dialog or adding a toast before then only waits for the chunk: both read
 * their state from stores that exist from the first render (the session's dialog stack, `shellToasts`).
 */
const DialogHost = lazyNamed(() => import("@/ui/overlays/DialogHost"), "DialogHost");
const ToastRegion = lazyNamed(() => import("@/ui/overlays/ToastRegion"), "ToastRegion");

/**
 * The app: "Skip to sheet" first in Tab order (spec L743), the shell, then what floats over it: the dialog
 * stack and the toast region (each in its own chunk; the toast manager exists from the first render), and the
 * palette and tour (each renders nothing until it has something to show). Banners aren't here: they show at
 * the top of the sheet region (spec L384, L389), so the shell mounts the banner host. The router applies the
 * location's route.
 */
export function App() {
  const route = useRoute();
  useRouter(route);
  useDocumentTitle();

  if (UiGallery && route.kind === "gallery") {
    return (
      <Suspense fallback={null}>
        <UiGallery />
      </Suspense>
    );
  }

  return (
    <>
      <SkipLink />
      <Shell />
      <LazyPart>
        <DialogHost />
      </LazyPart>
      <LazyPart>
        <ToastRegion manager={shellToasts.manager} />
      </LazyPart>
      <div className={styles.overlays}>
        <CommandPalette />
        <Tour />
      </div>
    </>
  );
}
