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
    const stop = doc.subscribe((state, previous) => {
      const added = placedBetween(previous.project, state.project, state.lastChange?.kind);
      if (added.length === 0) return;
      setFlashing((current) => new Set([...current, ...added]));
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
    return () => {
      stop();
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);
  return flashing;
}
