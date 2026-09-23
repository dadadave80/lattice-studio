import { useEffect, useState } from "react";
import { announce, log } from "@/contracts";
import { closePalette, loadedPalette, loadPalette, usePaletteState, whenIdle, type PaletteModule } from "./palette-state";

export type CommandPaletteProps = {
  /** When to start loading the palette's chunk ahead of the first ⌘K. Default: when the browser is idle. */
  preload?: (task: () => void) => () => void;
};

export const LOAD_FAILED = "The command palette didn't load. Check the connection and open it again.";

/**
 * The ⌘K palette's host (IR L162-L168), mounted once by the app. It renders nothing until the palette first
 * opens; its chunk loads when the app is idle, or on the first ⌘K, whichever comes first (spec L822).
 */
export function CommandPalette({ preload = whenIdle }: CommandPaletteProps) {
  const { open } = usePaletteState();
  const [module, setModule] = useState<PaletteModule | null>(loadedPalette);

  useEffect(
    () =>
      preload(() => {
        // A failed preload is retried on open, which reports it.
        loadPalette().then(setModule, () => undefined);
      }),
    [preload],
  );

  useEffect(() => {
    if (!open || module) return;
    let live = true;
    loadPalette().then(
      (loaded) => {
        if (live) setModule(loaded);
      },
      () => {
        if (!live) return;
        log({ tag: "Error", text: LOAD_FAILED });
        announce(LOAD_FAILED, { politeness: "assertive" });
        closePalette();
      },
    );
    return () => {
      live = false;
    };
  }, [open, module]);

  if (!module) return null;
  const { PalettePopup } = module;
  return <PalettePopup />;
}
