/**
 * Cards placed a moment ago (a drop, a palette place, a recipe loaded in place, an undo that brings one back):
 * their traces flash into the core for `FLASH_MS`, then give way to the glyph. The timer always removes the
 * flash; with reduced motion the CSS just skips the fade.
 */
import { useEffect, useState } from "react";
import { doc } from "@/contracts";
import { FLASH_MS, placedBetween } from "./placement";

const NONE: ReadonlySet<string> = new Set();

export function useFlashing(): ReadonlySet<string> {
  const [flashing, setFlashing] = useState<ReadonlySet<string>>(NONE);
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const frames = new Set<number>();
    const stop = doc.subscribe((state, previous) => {
      const added = placedBetween(previous.project, state.project, state.lastChange?.kind);
      if (added.length === 0) return;
      setFlashing((current) => new Set([...current, ...added]));
      // The clock starts once the flash has been painted (two frames on), not at the change: on a busy machine a
      // load can hold the main thread past FLASH_MS, and a timer started earlier would end a flash nobody saw.
      const first = requestAnimationFrame(() => {
        frames.delete(first);
        const second = requestAnimationFrame(() => {
          frames.delete(second);
          const timer = setTimeout(() => {
            timers.delete(timer);
            setFlashing((current) => {
              const next = new Set(current);
              for (const name of added) next.delete(name);
              return next.size === 0 ? NONE : next;
            });
          }, FLASH_MS);
          timers.add(timer);
        });
        frames.add(second);
      });
      frames.add(first);
    });
    return () => {
      stop();
      for (const frame of frames) cancelAnimationFrame(frame);
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);
  return flashing;
}
