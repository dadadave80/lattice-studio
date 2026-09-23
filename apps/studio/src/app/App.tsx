import { lazy, Suspense } from "react";
import { env } from "@/contracts";
import { SkipLink } from "@/a11y";
import { Toasts } from "@/feedback";
import { CommandPalette } from "@/palette";
import { Shell, shellToasts } from "@/shell";
import { Tour } from "@/tour";
import { DialogHost, ToastRegion } from "@/ui";
import { useDocumentTitle } from "./document-title";
import { useRoute, useRouter } from "./router";
import styles from "./App.module.css";

/** S0's primitives gallery, in its own chunk and only in dev builds (`#/__ui`). */
const UiGallery = lazy(() => import("@/ui/UiGallery").then((m) => ({ default: m.UiGallery })));

/**
 * The app: "Skip to sheet" first in Tab order (spec L743), the shell, then what floats over it: the dialog
 * stack, the toast region with its manager from the first render, and the palette, tour and banner host
 * (each renders nothing until it has something to show). The router applies the location's route.
 */
export function App() {
  const route = useRoute();
  useRouter(route);
  useDocumentTitle();

  if (env.dev && route.kind === "gallery") {
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
      <DialogHost />
      <ToastRegion manager={shellToasts.manager} />
      <div className={styles.overlays}>
        <CommandPalette />
        <Tour />
        <Toasts />
      </div>
    </>
  );
}
